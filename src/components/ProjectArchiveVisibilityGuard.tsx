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
        const activeRows = rows.filter((row) => !row.deleted_at);
        const activeByName = new Map<string, ProjectRow[]>();
        for (const row of activeRows) {
          const group = activeByName.get(row.name) ?? [];
          group.push(row);
          activeByName.set(row.name, group);
        }

        // React normally renders only active projects. During an archive refresh it can
        // temporarily contain one stale extra button, so anything beyond the active DB
        // count for that name is hidden immediately.
        const seenByName = new Map<string, number>();
        const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>(".project-list-item"));
        for (const button of buttons) {
          const name = button.querySelector("strong")?.textContent?.trim() ?? "";
          const occurrence = seenByName.get(name) ?? 0;
          seenByName.set(name, occurrence + 1);
          const row = activeByName.get(name)?.[occurrence];
          const active = Boolean(row);
          button.hidden = !active;
          button.setAttribute("aria-hidden", active ? "false" : "true");
          if (row) button.dataset.projectId = row.id;
          else delete button.dataset.projectId;
        }

        const workspace = document.querySelector<HTMLElement>(".project-workspace");
        if (workspace) {
          const visibleName = workspace.querySelector<HTMLElement>(".project-identity h3")?.textContent?.trim() ?? "";
          const visibleDescription = workspace.querySelector<HTMLElement>(".project-identity p")?.textContent?.trim() ?? "";
          const normalizedDescription = visibleDescription === "No description yet." ? "" : visibleDescription;
          const candidates = activeByName.get(visibleName) ?? [];
          const matchingActive = candidates.find((row) => (row.description ?? "").trim() === normalizedDescription.trim())
            ?? candidates[0];

          const workspaceIsArchived = !matchingActive;
          workspace.hidden = workspaceIsArchived;

          if (workspaceIsArchived) {
            const next = buttons.find((button) => !button.hidden);
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
