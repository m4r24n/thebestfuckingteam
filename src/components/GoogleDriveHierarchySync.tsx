"use client";

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase";

export default function GoogleDriveHierarchySync() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let cleanupChannel: (() => void) | null = null;
    let cleanupWait: (() => void) | null = null;
    let syncing = false;
    let rerunRequested = false;

    const waitForDashboard = () => new Promise<boolean>((resolve) => {
      if (document.querySelector(".app-shell")) {
        resolve(true);
        return;
      }

      const observer = new MutationObserver(() => {
        if (!document.querySelector(".app-shell")) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        cleanupWait = null;
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timeout = window.setTimeout(() => {
        observer.disconnect();
        cleanupWait = null;
        resolve(false);
      }, 20_000);

      cleanupWait = () => {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(false);
      };
    });

    const start = async () => {
      const dashboardReady = await waitForDashboard();
      if (!dashboardReady || cancelled) return;

      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId || cancelled) return;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!membership || cancelled) return;
      const workspaceId = membership.workspace_id as string;

      const { data: status } = await supabase.rpc("storage_connection_status", { target_workspace: workspaceId });
      const connected = Array.isArray(status) && status.some((item) => item.provider === "google_drive");
      if (!connected || cancelled) return;

      const schedule = (delay = 700) => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => void sync(), delay);
      };

      const sync = async () => {
        if (cancelled) return;
        if (syncing) {
          rerunRequested = true;
          return;
        }

        syncing = true;
        try {
          const { data: session } = await supabase.auth.getSession();
          const token = session.session?.access_token;
          if (!token || cancelled) return;
          const response = await fetch("/api/google-drive/sync", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ workspaceId, mode: "incremental" }),
          }).catch(() => null);
          if (response?.ok) {
            const body = await response.json().catch(() => ({})) as { hasMore?: boolean };
            if (body.hasMore && !cancelled) schedule(1_200);
          }
        } finally {
          syncing = false;
          if (rerunRequested && !cancelled) {
            rerunRequested = false;
            schedule();
          }
        }
      };

      void sync();
      const channel = supabase
        .channel(`tbft-drive-hierarchy-${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspaceId}` },
          () => schedule(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "projects", filter: `workspace_id=eq.${workspaceId}` },
          () => schedule(),
        )
        .subscribe();
      cleanupChannel = () => { void supabase.removeChannel(channel); };

      const onVisibility = () => {
        if (document.visibilityState === "visible") schedule();
      };
      document.addEventListener("visibilitychange", onVisibility);
      const previousCleanup = cleanupChannel;
      cleanupChannel = () => {
        previousCleanup?.();
        document.removeEventListener("visibilitychange", onVisibility);
      };
    };

    void start();
    return () => {
      cancelled = true;
      cleanupWait?.();
      if (timer) window.clearTimeout(timer);
      cleanupChannel?.();
    };
  }, []);

  return null;
}
