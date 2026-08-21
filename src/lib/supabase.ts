import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let cloudFailureUntil = 0;
let onlineGuardInstalled = false;

const CLOUD_REQUEST_TIMEOUT_MS = 8_000;
const CLOUD_FAILURE_WINDOW_MS = 5_000;

function installOnlineFallbackSignal() {
  if (typeof window === "undefined" || onlineGuardInstalled) return;
  onlineGuardInstalled = true;

  const navigatorObject = window.navigator;
  const prototype = Object.getPrototypeOf(navigatorObject) as object | null;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "onLine") : undefined;
  const nativeGetter = descriptor?.get;
  if (!nativeGetter) return;

  try {
    Object.defineProperty(navigatorObject, "onLine", {
      configurable: true,
      get() {
        if (Date.now() < cloudFailureUntil) return false;
        return Boolean(nativeGetter.call(navigatorObject));
      },
    });
  } catch {
    // Some browsers do not allow an own onLine property. The request timeout still applies.
  }
}

function reportCloudTimeout(input: RequestInfo | URL) {
  if (typeof window === "undefined") return;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, window.location.origin);
    const payload = JSON.stringify({
      path: `${url.pathname}${url.search}`.slice(0, 1200),
      at: new Date().toISOString(),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/diagnostics/cloud-timeout", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/diagnostics/cloud-timeout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Diagnostics must never interfere with the app.
  }
}

function markCloudTemporarilyUnavailable() {
  if (typeof window === "undefined") return;
  cloudFailureUntil = Date.now() + CLOUD_FAILURE_WINDOW_MS;
  window.dispatchEvent(new Event("offline"));
  window.setTimeout(() => window.dispatchEvent(new Event("online")), CLOUD_FAILURE_WINDOW_MS + 50);
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  let upstreamAbort: (() => void) | null = null;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else {
      upstreamAbort = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener("abort", upstreamAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => controller.abort("TBFT cloud request timed out"), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      reportCloudTimeout(input);
      markCloudTemporarilyUnavailable();
      throw new Error("TBFT cloud request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (upstreamSignal && upstreamAbort) upstreamSignal.removeEventListener("abort", upstreamAbort);
  }
}

function installAuthEventGuard(target: SupabaseClient) {
  const original = target.auth.onAuthStateChange.bind(target.auth);
  let lastUserId: string | null = null;

  target.auth.onAuthStateChange = ((callback) => original((event, session) => {
    const nextUserId = session?.user?.id ?? null;

    if (event === "SIGNED_IN" && nextUserId) {
      // Supabase can deliver SIGNED_IN after getSession() has already restored the
      // current user. TBFT's app state used to interpret that late event as a new
      // login and wipe an already-loaded workspace. Treat the first sign-in for a
      // listener as session establishment instead. A genuinely different user is
      // still delivered as SIGNED_IN so the app can reset safely.
      if (lastUserId === nextUserId) return;
      if (lastUserId === null) {
        lastUserId = nextUserId;
        callback("INITIAL_SESSION", session);
        return;
      }
      lastUserId = nextUserId;
      callback(event, session);
      return;
    }

    if (event === "INITIAL_SESSION" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
      lastUserId = nextUserId;
    } else if (event === "SIGNED_OUT") {
      lastUserId = null;
    }

    callback(event, session);
  })) as typeof target.auth.onAuthStateChange;
}

export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  if (!client) {
    installOnlineFallbackSignal();
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: resilientFetch,
      },
    });
    installAuthEventGuard(client);
  }

  return client;
}

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);
