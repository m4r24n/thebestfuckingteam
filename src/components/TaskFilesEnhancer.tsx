"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createProjectFileUrl,
  deleteProjectFile,
  getTaskFileSpace,
  listTaskFiles,
  uploadProjectFile,
} from "@/lib/projectStorage";
import { saveTaskCompletionPdf } from "@/lib/taskCompletionPdf";
import type { ProjectFile, ProjectFileSpace } from "@/lib/types";

type ResolvedTask = {
  id: string;
  workspaceId: string;
  projectId?: string;
  completedAt?: string;
};

type NoteState = "idle" | "saving" | "saved" | "error";

function labelControl<T extends HTMLInputElement | HTMLSelectElement>(form: HTMLFormElement, labelText: string): T | null {
  const label = Array.from(form.querySelectorAll("label")).find((item) => item.childNodes[0]?.textContent?.trim() === labelText || item.textContent?.trim().startsWith(labelText));
  return (label?.querySelector("input,select") as T | null) ?? null;
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not connected.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your TBFT session expired.");
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export default function TaskFilesEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [task, setTask] = useState<ResolvedTask | null>(null);
  const [space, setSpace] = useState<ProjectFileSpace | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<NoteState>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const currentForm = useRef<HTMLFormElement | null>(null);
  const lastSavedNote = useRef("");

  const load = useCallback(async (resolved: ResolvedTask) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let nextSpace = await getTaskFileSpace(supabase, resolved.id);
    if (!nextSpace) {
      try {
        await fetch("/api/google-drive/sync", {
          method: "POST",
          headers: await authHeader(),
          body: JSON.stringify({ workspaceId: resolved.workspaceId }),
        });
        nextSpace = await getTaskFileSpace(supabase, resolved.id);
      } catch {
        // Notes remain available even if Drive folder sync is temporarily unavailable.
      }
    }
    setSpace(nextSpace);
    setFiles(await listTaskFiles(supabase, resolved.id));
  }, []);

  const persistNote = useCallback(async (resolved: ResolvedTask, value: string) => {
    if (resolved.completedAt || value === lastSavedNote.current) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setNoteState("saving");
    const { error } = await supabase.from("tasks").update({ completion_note: value }).eq("id", resolved.id);
    if (error) {
      setNoteState("error");
      setMessage(error.message);
      return;
    }
    lastSavedNote.current = value;
    setNoteState("saved");
  }, []);

  useEffect(() => {
    const inspect = () => {
      const form = document.querySelector<HTMLFormElement>("form.task-editor");
      if (form === currentForm.current) return;
      currentForm.current = form;
      setTask(null);
      setSpace(null);
      setFiles([]);
      setNote("");
      setNoteState("idle");
      lastSavedNote.current = "";
      setMessage("");
      setMount(null);
      document.querySelectorAll(".tbft-task-files-mount").forEach((item) => item.remove());

      if (!form || form.querySelector(".modal-header h3")?.textContent?.trim() !== "Edit task") return;
      const actions = form.querySelector<HTMLElement>(".modal-actions");
      if (!actions?.parentElement) return;
      const target = document.createElement("div");
      target.className = "tbft-task-files-mount";
      actions.parentElement.insertBefore(target, actions);
      setMount(target);

      void (async () => {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const title = form.querySelector<HTMLInputElement>("label.full-field input")?.value.trim() ?? "";
        const date = form.querySelector<HTMLInputElement>('input[type="date"]')?.value ?? "";
        const owner = labelControl<HTMLSelectElement>(form, "Owner")?.value ?? "";
        const projectId = labelControl<HTMLSelectElement>(form, "Project")?.value ?? "";
        if (!title || !date || !owner) return;

        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;
        const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
        if (!membership) return;

        let query = supabase
          .from("tasks")
          .select("id, workspace_id, project_id, recurrence_type, recurrence_source_id, completion_note, completed_at, updated_at")
          .eq("workspace_id", membership.workspace_id)
          .eq("title", title)
          .eq("original_date", date)
          .eq("owner_user_id", owner)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(5);
        query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);
        const { data: rows, error } = await query;
        if (error || !rows?.length) return;
        const row = rows[0];
        if ((row.recurrence_type && row.recurrence_type !== "none") || row.recurrence_source_id) return;
        const resolved: ResolvedTask = {
          id: row.id,
          workspaceId: row.workspace_id,
          projectId: row.project_id ?? undefined,
          completedAt: row.completed_at ?? undefined,
        };
        const loadedNote = String(row.completion_note ?? "");
        lastSavedNote.current = loadedNote;
        setNote(loadedNote);
        setNoteState("saved");
        setTask(resolved);
        await load(resolved);
      })();
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [load]);

  useEffect(() => {
    if (!task || task.completedAt || note === lastSavedNote.current) return;
    const timer = window.setTimeout(() => void persistNote(task, note), 650);
    return () => window.clearTimeout(timer);
  }, [note, persistNote, task]);

  const upload = async (picked: FileList | null) => {
    const pickedFiles = Array.from(picked ?? []);
    if (!task || !space || !pickedFiles.length || busy) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    setBusy(true);
    setMessage("");
    try {
      for (const file of pickedFiles) {
        await uploadProjectFile(supabase, {
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          userId,
          file,
          provider: space.provider,
        });
      }
      await load(task);
      setMessage(`${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const savePdfNow = async () => {
    if (!task?.completedAt || !note.trim() || busy) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    setBusy(true);
    setMessage("");
    try {
      const filename = await saveTaskCompletionPdf(supabase, task.id, task.completedAt, userId);
      await load(task);
      setMessage(filename ? `${filename} saved in this task folder.` : "There are no completion notes to save yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const open = async (file: ProjectFile) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const url = await createProjectFileUrl(supabase, file);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (file: ProjectFile) => {
    if (!task || !window.confirm(`Remove “${file.originalName}”?`)) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    setBusy(true);
    try {
      await deleteProjectFile(supabase, file, userId);
      await load(task);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!mount || !task) return null;

  const noteStatus = task.completedAt
    ? "Locked at completion"
    : noteState === "saving"
      ? "Saving…"
      : noteState === "error"
        ? "Save needs attention"
        : "Saved automatically";

  return createPortal(
    <section className="task-files-panel">
      <div className="task-files-heading">
        <div><span className="eyebrow">FILES</span><strong>{space?.label ?? "Task files"}</strong></div>
        {space && <label className={busy ? "task-file-upload disabled" : "task-file-upload"}>{busy ? "Working…" : "+ Add files"}<input type="file" multiple disabled={busy} onChange={(event) => { const picked = event.currentTarget.files; void upload(picked); event.currentTarget.value = ""; }} /></label>}
      </div>

      <div className="task-note-editor">
        <div className="task-note-heading">
          <div><span className="eyebrow">COMPLETION NOTES</span><strong>Task notebook</strong></div>
          <span className={`task-note-status state-${noteState}`}>{noteStatus}</span>
        </div>
        <textarea
          value={note}
          disabled={Boolean(task.completedAt)}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void persistNote(task, note)}
          placeholder="Keep adding notes here while you work. TBFT will turn them into a structured PDF when you complete the task."
          rows={7}
        />
        <div className="task-note-footer">
          <span>The PDF includes task details plus a footer with workspace, creator, owner, project, task date, completion time, priority, and task ID.</span>
          {task.completedAt && note.trim() && <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void savePdfNow()}>Save PDF now</button>}
        </div>
      </div>

      {!space ? <p className="task-files-empty">This task does not have a file folder yet. Notes still save to TBFT; sync Google Drive before completion so the PDF can be stored in the task folder.</p> : files.length ? (
        <div className="task-files-list">
          {files.map((file) => <div className="task-file-row" key={file.id}><button type="button" className="task-file-name" onClick={() => void open(file)}>{file.originalName}</button><button type="button" className="task-file-remove" disabled={busy} onClick={() => void remove(file)}>Remove</button></div>)}
        </div>
      ) : <p className="task-files-empty">No files yet.</p>}
      {message && <p className="task-files-message">{message}</p>}
    </section>,
    mount,
  );
}
