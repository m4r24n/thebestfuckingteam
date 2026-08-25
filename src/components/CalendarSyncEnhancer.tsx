"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not connected.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your TBFT session expired.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

export default function CalendarSyncEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const currentPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const inspect = () => {
      const panel = document.querySelector<HTMLElement>(".calendar-panel");
      if (panel === currentPanel.current) return;
      currentPanel.current = panel;
      document.querySelectorAll(".tbft-calendar-sync-mount").forEach((item) => item.remove());
      setMount(null);
      setMessage("");
      if (!panel?.parentElement) return;

      const target = document.createElement("div");
      target.className = "tbft-calendar-sync-mount";
      panel.parentElement.insertBefore(target, panel);
      setMount(target);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const ensureFeed = useCallback(async (): Promise<string> => {
    if (feedUrl) return feedUrl;
    const response = await fetch("/api/calendar/subscription", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({}),
    });
    const body = await response.json() as { feedUrl?: string; error?: string };
    if (!response.ok || !body.feedUrl) throw new Error(body.error ?? "Calendar sync could not be created.");
    setFeedUrl(body.feedUrl);
    return body.feedUrl;
  }, [feedUrl]);

  const copyFeed = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
  }, []);

  const openGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await ensureFeed();
      let copied = false;
      try {
        await copyFeed(url);
        copied = true;
      } catch {
        // A separate Copy link action remains available if clipboard permission is blocked.
      }
      window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener,noreferrer");
      setMessage(copied ? "Sync link copied — paste it into Calendar URL." : "Google Calendar opened — use Copy sync link, then paste it into Calendar URL.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openApple = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await ensureFeed();
      setMessage("Opening Apple Calendar…");
      window.location.href = url.replace(/^https:/, "webcal:");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const downloadIcs = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await ensureFeed();
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tbft-tasks.ics";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setMessage("Calendar export downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const url = await ensureFeed();
      await copyFeed(url);
      setMessage("Private sync link copied.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!mount) return null;

  return createPortal(
    <section className="calendar-sync-strip" aria-label="Calendar sync">
      <div className="calendar-sync-copy">
        <strong>Calendar sync</strong>
        <span>Today + future one-off tasks only · recurring tasks stay in TBFT.</span>
      </div>
      <div className="calendar-sync-actions">
        <button type="button" disabled={busy} onClick={() => void openGoogle()}>Google Calendar</button>
        <button type="button" disabled={busy} onClick={() => void openApple()}>Apple Calendar</button>
        <button type="button" disabled={busy} onClick={() => void downloadIcs()}>Export .ics</button>
        <button type="button" className="calendar-sync-link" disabled={busy} onClick={() => void copyLink()}>Copy sync link</button>
      </div>
      {message && <p className="calendar-sync-message">{message}</p>}
    </section>,
    mount,
  );
}
