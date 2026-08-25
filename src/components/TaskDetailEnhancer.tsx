"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getBoardDate } from "@/lib/date";
import { getSupabaseClient } from "@/lib/supabase";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  owner_user_id: string;
  created_by: string;
  original_date: string;
  deadline: string | null;
  priority: "low" | "medium" | "high";
  project_id: string | null;
  project_node_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskDetail = {
  task: TaskRow;
  ownerName: string;
  creatorName: string;
  projectName?: string;
  nodeName?: string;
};

type ProfileRow = { id: string; display_name: string | null };
type ProjectRow = { id: string; name: string };
type NodeRow = { id: string; title: string };

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function TaskDetailEnhancer() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    setLoading(false);
    setError("");
    setDetail(null);
  }, []);

  const openCard = useCallback(async (card: HTMLElement) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const title = text(card.querySelector<HTMLElement>(".task-copy h4")?.textContent);
    if (!title) return;

    setOpen(true);
    setLoading(true);
    setError("");
    setDetail(null);

    try {
      const description = text(card.querySelector<HTMLElement>(".task-copy p")?.textContent);
      const ownerNameFromCard = text(card.closest(".notepad-column")?.querySelector<HTMLElement>(".partner-title h3")?.textContent);
      const status = text(card.querySelector<HTMLElement>(".status-pill")?.textContent);
      const meta = Array.from(card.querySelectorAll<HTMLElement>(".task-meta span")).map((item) => text(item.textContent)).filter(Boolean);
      const deadlineFromCard = meta.find((item) => /^\d{1,2}:\d{2}$/.test(item));
      const projectPathFromCard = meta.find((item) => !/^\d{1,2}:\d{2}$/.test(item) && !item.startsWith("Added by ") && !item.startsWith("Completed "));

      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Your TBFT session expired.");

      const { data: membership, error: membershipError } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("Workspace not found.");

      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces")
        .select("timezone, rollover_hour")
        .eq("id", membership.workspace_id)
        .single();
      if (workspaceError) throw workspaceError;
      const boardDate = getBoardDate(workspace.timezone, workspace.rollover_hour);

      const { data: taskRows, error: taskError } = await supabase
        .from("tasks")
        .select("id,title,description,owner_user_id,created_by,original_date,deadline,priority,project_id,project_node_id,completed_at,created_at,updated_at")
        .eq("workspace_id", membership.workspace_id)
        .eq("title", title)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (taskError) throw taskError;

      let candidates = (taskRows ?? []) as TaskRow[];
      if (!candidates.length) throw new Error("This task could not be found.");

      const peopleIds = Array.from(new Set(candidates.flatMap((row) => [row.owner_user_id, row.created_by])));
      const { data: profiles, error: profilesError } = peopleIds.length
        ? await supabase.from("profiles").select("id,display_name").in("id", peopleIds)
        : { data: [] as ProfileRow[], error: null };
      if (profilesError) throw profilesError;
      const profileMap = new Map(((profiles ?? []) as ProfileRow[]).map((row) => [row.id, row.display_name || "Partner"]));

      const exactDescription = candidates.filter((row) => text(row.description) === description);
      if (exactDescription.length) candidates = exactDescription;

      if (ownerNameFromCard) {
        const ownerMatches = candidates.filter((row) => profileMap.get(row.owner_user_id) === ownerNameFromCard);
        if (ownerMatches.length) candidates = ownerMatches;
      }

      if (deadlineFromCard) {
        const deadlineMatches = candidates.filter((row) => text(row.deadline).slice(0, 5) === deadlineFromCard);
        if (deadlineMatches.length) candidates = deadlineMatches;
      }

      const stateMatches = candidates.filter((row) => {
        if (status.startsWith("Completed")) return Boolean(row.completed_at);
        if (status.startsWith("Carried")) return !row.completed_at && row.original_date < boardDate;
        if (status.startsWith("Scheduled")) return !row.completed_at && row.original_date > boardDate;
        if (status.startsWith("Pending")) return !row.completed_at && row.original_date === boardDate;
        return true;
      });
      if (stateMatches.length) candidates = stateMatches;

      const projectIds = Array.from(new Set(candidates.map((row) => row.project_id).filter((id): id is string => Boolean(id))));
      const nodeIds = Array.from(new Set(candidates.map((row) => row.project_node_id).filter((id): id is string => Boolean(id))));
      const [{ data: projects, error: projectsError }, { data: nodes, error: nodesError }] = await Promise.all([
        projectIds.length ? supabase.from("projects").select("id,name").in("id", projectIds) : Promise.resolve({ data: [] as ProjectRow[], error: null }),
        nodeIds.length ? supabase.from("project_nodes").select("id,title").in("id", nodeIds) : Promise.resolve({ data: [] as NodeRow[], error: null }),
      ]);
      if (projectsError) throw projectsError;
      if (nodesError) throw nodesError;

      const projectMap = new Map(((projects ?? []) as ProjectRow[]).map((row) => [row.id, row.name]));
      const nodeMap = new Map(((nodes ?? []) as NodeRow[]).map((row) => [row.id, row.title]));

      if (projectPathFromCard) {
        const projectMatches = candidates.filter((row) => {
          if (!row.project_id) return false;
          const projectName = projectMap.get(row.project_id);
          if (!projectName) return false;
          const nodeName = row.project_node_id ? nodeMap.get(row.project_node_id) : undefined;
          return `${projectName}${nodeName ? ` / ${nodeName}` : ""}` === projectPathFromCard;
        });
        if (projectMatches.length) candidates = projectMatches;
      }

      const task = candidates[0];
      if (!task) throw new Error("This task could not be resolved.");

      setDetail({
        task,
        ownerName: profileMap.get(task.owner_user_id) || "Partner",
        creatorName: profileMap.get(task.created_by) || "Partner",
        projectName: task.project_id ? projectMap.get(task.project_id) : undefined,
        nodeName: task.project_node_id ? nodeMap.get(task.project_node_id) : undefined,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const card = target.closest<HTMLElement>(".split-board .task-card");
      if (!card) return;
      if (target.closest("button,a,input,textarea,select,label,summary,details")) return;
      void openCard(card);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openCard]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [close, open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="tbft-task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="tbft-task-detail-card" role="dialog" aria-modal="true" aria-labelledby="tbft-task-detail-title">
        <header className="tbft-task-detail-header">
          <h3 id="tbft-task-detail-title">{detail?.task.title || "Task details"}</h3>
          <button type="button" className="tbft-task-detail-close" onClick={close} aria-label="Close task details" autoFocus>×</button>
        </header>

        {loading ? (
          <div className="tbft-task-detail-loading">Opening task…</div>
        ) : error ? (
          <div className="tbft-task-detail-error">{error}</div>
        ) : detail ? (
          <div className="tbft-task-detail-body">
            <p className="tbft-task-detail-description">{text(detail.task.description) || "No details added."}</p>
            <div className="tbft-task-detail-meta">
              <p>{detail.ownerName} · {detail.task.completed_at ? "Completed" : "Open"}</p>
              <p>{formatDate(detail.task.original_date)}{detail.task.deadline ? ` · ${detail.task.deadline.slice(0, 5)}` : ""}</p>
              <p>{detail.task.priority.charAt(0).toUpperCase() + detail.task.priority.slice(1)} priority{detail.projectName ? ` · ${detail.projectName}${detail.nodeName ? ` / ${detail.nodeName}` : ""}` : ""}</p>
              {detail.creatorName !== detail.ownerName && <p>Added by {detail.creatorName}</p>}
              {detail.task.completed_at && <p>Completed {formatDateTime(detail.task.completed_at)}</p>}
            </div>
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
