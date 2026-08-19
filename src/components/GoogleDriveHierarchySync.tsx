"use client";

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase";

export default function GoogleDriveHierarchySync() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let cleanupChannel: (() => void) | null = null;

    const start = async () => {
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

      const sync = async () => {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token || cancelled) return;
        await fetch("/api/google-drive/sync", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        }).catch(() => undefined);
      };

      const schedule = () => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => void sync(), 700);
      };

      void sync();
      const channel = supabase
        .channel(`tbft-drive-spaces-${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "project_file_spaces", filter: `workspace_id=eq.${workspaceId}` },
          schedule,
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
      if (timer) window.clearTimeout(timer);
      cleanupChannel?.();
    };
  }, []);

  return null;
}
