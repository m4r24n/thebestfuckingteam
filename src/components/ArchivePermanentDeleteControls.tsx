"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";

type ArchivedProject = {
  id: string;
  name: string;
  created_by: string;
  deleted_at: string;
};

type ArchivedTask = {
  id: string;
  title: string;
  owner_user_id: string;
  recurrence_type: string;
  recurrence_source_id: string | null;
  deleted_at: string;
};

type DeleteTarget =
  | { kind: "project"; item: ArchivedProject }
  | { kind: "task"; item: ArchivedTask };

export default function ArchivePermanentDeleteControls() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [userId, setUserId] = useState("");
  const [workspaceRole, setWorkspaceRole] = useState("");
  const [projects, setProjects] = useState<ArchivedProject[]>([]);
  const [tasks, setTasks] = useState<ArchivedTask[]>([]);
  const [confirming, setConfirming] = useState<DeleteTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const inspect = () => setTarget(document.querySelector<HTMLElement>(".archive-grid"));
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const loadArchived = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    setUserId(uid);

    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();
    if (!membership) return;

    setWorkspaceRole(String(membership.role ?? ""));

    const [projectResult, taskResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name, created_by, deleted_at")
        .eq("workspace_id", membership.workspace_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title, owner_user_id, recurrence_type, recurrence_source_id, deleted_at")
        .eq("workspace_id", membership.workspace_id)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false }),
    ]);

    if (projectResult.error || taskResult.error) {
      setError(projectResult.error?.message ?? taskResult.error?.message ?? "Could not load archived items.");
      return;
    }

    setProjects((projectResult.data ?? []) as ArchivedProject[]);
    setTasks((taskResult.data ?? []) as ArchivedTask[]);
    setError("");
  };

  useEffect(() => {
    if (!target) return;
    void loadArchived();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const permanentlyDelete = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !confirming || busy) return;

    setBusy(true);
    setError("");
    const rpcName = confirming.kind === "task"
      ? "permanently_delete_archived_task"
      : "permanently_delete_archived_project";
    const args = confirming.kind === "task"
      ? { target_task: confirming.item.id }
      : { target_project: confirming.item.id };

    const { error: deleteError } = await supabase.rpc(rpcName, args);
    if (deleteError) {
      setError(deleteError.message);
      setBusy(false);
      return;
    }

    setConfirming(null);
    setBusy(false);
    await loadArchived();
  };

  if (!target) return null;

  const visibleProjects = projects.filter((project) => project.created_by === userId || workspaceRole === "owner");
  const archivedRootIds = new Set(
    tasks
      .filter((task) => task.recurrence_source_id === null)
      .map((task) => task.id),
  );
  const visibleTasks = tasks.filter((task) =>
    task.owner_user_id === userId
    && (task.recurrence_source_id === null || !archivedRootIds.has(task.recurrence_source_id)),
  );

  const panel = (
    <details className="archive-purge-panel">
      <summary>
        <span>Permanent deletion</span>
        <small>Irreversible cleanup</small>
      </summary>
      <div className="archive-purge-body">
        <p className="archive-purge-warning">Items here are already archived. Permanent deletion cannot be undone.</p>
        {error && <p className="archive-purge-error">{error}</p>}

        <div className="archive-purge-columns">
          <section>
            <h4>Projects</h4>
            {visibleProjects.length ? visibleProjects.map((project) => (
              <div className="archive-purge-row" key={project.id}>
                <span>{project.name}</span>
                <button type="button" onClick={() => setConfirming({ kind: "project", item: project })}>Delete permanently</button>
              </div>
            )) : <p className="archive-purge-empty">No archived projects you can permanently delete.</p>}
          </section>

          <section>
            <h4>Tasks</h4>
            {visibleTasks.length ? visibleTasks.map((task) => (
              <div className="archive-purge-row" key={task.id}>
                <span>
                  {task.title}
                  {task.recurrence_source_id === null && task.recurrence_type !== "none" ? <small>Recurring series</small> : null}
                </span>
                <button type="button" onClick={() => setConfirming({ kind: "task", item: task })}>Delete permanently</button>
              </div>
            )) : <p className="archive-purge-empty">No archived tasks you can permanently delete.</p>}
          </section>
        </div>
      </div>
    </details>
  );

  const confirmModal = confirming ? createPortal(
    <div className="archive-delete-backdrop" onMouseDown={() => !busy && setConfirming(null)}>
      <section className="archive-delete-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <span className="eyebrow">PERMANENT DELETE</span>
        <h3>Delete “{confirming.kind === "task" ? confirming.item.title : confirming.item.name}” forever?</h3>
        <p>
          {confirming.kind === "task"
            ? confirming.item.recurrence_source_id === null && confirming.item.recurrence_type !== "none"
              ? "This removes the archived recurring series, its generated occurrences, notes, history, and stored task files. This cannot be undone."
              : "This removes the task, its notes, history, and stored task files. This cannot be undone."
            : "This removes the archived project structure and project files. Connected tasks are kept and become unassigned from the deleted project. This cannot be undone."}
        </p>
        {error && <p className="archive-purge-error">{error}</p>}
        <div className="archive-delete-actions">
          <button type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void permanentlyDelete()}>
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {createPortal(panel, target)}
      {confirmModal}
    </>
  );
}
