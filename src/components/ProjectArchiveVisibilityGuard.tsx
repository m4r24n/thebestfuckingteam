"use client";

import { useEffect, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  deleted_at: string | null;
  created_at: string;
};

/**
 * The main app already filters archived projects from its data model, but an archive
 * mutation can briefly leave stale React state on screen while the workspace refreshes.
 * This guard verifies the visible Projects DOM against the current database rows so an
 * archived project can never remain visible in Projects at the same time as Archive.
 */
export default function ProjectArchiveVisibilityGuard() {
  const busy = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const reconcile = async () => {
      if (busy.current) {
        queued.current = true;
        return;
      }

      const panel = document.querySelector<HTMLElement>(".project-list-panel");
      if (!panel) return;

      busy.current = true;
      try {
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

        const { data, error } = await supabase
          .from("projects")
          .select("id, name, description, deleted_at, created_at")
          .eq("workspace_id", membership.workspace_id)
          .order("created_at", { ascending: true });
        if (error || cancelled) return;

        const rows = (data ?? []) as ProjectRow[];
        const rowsByName = new Map<string, ProjectRow[]>();
        for (const row of rows) {
          const group = rowsByName.get(row.name) ?? [];
          group.push(row);
          rowsByName.set(row.name, group);
        }

        // Project buttons are rendered in the same creation order as the project query.
        // Matching same-name occurrences by ordinal keeps duplicate project names safe.
        const seenByName = new Map<string, number>();
        const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>(".project-list-item"));
        for (const button of buttons) {
          const name = button.querySelector("strong")?.textContent?.trim() ?? "";
          const occurrence = seenByName.get(name) ?? 0;
          seenByName.set(name, occurrence + 1);
          const row = rowsByName.get(name)?.[occurrence];
          const active = Boolean(row && !row.deleted_at);
          button.hidden = !active;
          button.setAttribute("aria-hidden", active ? "false" : "true");
          if (row) button.dataset.projectId = row.id;
        }

        const workspace = document.querySelector<HTMLElement>(".project-workspace");
        if (workspace) {
          const visibleName = workspace.querySelector<HTMLElement>(".project-identity h3")?.textContent?.trim() ?? "";
          const visibleDescription = workspace.querySelector<HTMLElement>(".project-identity p")?.textContent?.trim() ?? "";
          const candidates = rowsByName.get(visibleName) ?? [];
          const normalizedDescription = visibleDescription === "No description yet." ? "" : visibleDescription;
          const matching = candidates.find((row) => (row.description ?? "").trim() === normalizedDescription.trim())
            ?? candidates.find((row) => !row.deleted_at);

          const workspaceIsArchived = Boolean(matching?.deleted_at);
          workspace.hidden = workspaceIsArchived;

          if (workspaceIsArchived) {
            const next = buttons.find((button) => !button.hidden && !button.classList.contains("active"));
            next?.click();
          }
        }
      } finally {
        busy.current = false;
        if (queued.current && !cancelled) {
          queued.current = false;
          window.setTimeout(() => void reconcile(), 0);
        }
      }
    };

    const observer = new MutationObserver(() => void reconcile());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    void reconcile();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
