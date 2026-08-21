import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let cloudFailureUntil = 0;

const CLOUD_REQUEST_TIMEOUT_MS = 8_000;
const CLOUD_FAILURE_WINDOW_MS = 5_000;

function installOnlineFallbackSignal() {
  if (typeof window === "undefined") return;
  const navigatorObject = window.navigator;
  if (navigatorObject.dataset?.tbftOnlineGuard === "1") return;

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

    if (event === "SIGNED_IN" && nextUserId && nextUserId === lastUserId) return;
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
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
