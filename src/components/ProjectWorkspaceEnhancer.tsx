"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createProjectFileUrl,
  deleteProjectFile,
  listProjectFiles,
  listProjectFileSpaces,
  uploadProjectFile,
} from "@/lib/projectStorage";
import { storageProviderLabel } from "@/lib/storageProviders";
import type { ProjectFile, ProjectFileSpace } from "@/lib/types";

type ActiveProject = {
  id: string;
  workspaceId: string;
  name: string;
};

type TimelineItem = {
  id: string;
  actorId?: string;
  actorName: string;
  summary: string;
  action: string;
  entityType: string;
  createdAt: string;
};

function formatBytes(value?: number): string {
  if (value == null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileKind(file: ProjectFile): string {
  const mime = file.mimeType ?? "";
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "SHEET";
  if (mime.includes("word") || mime.includes("document") || mime.startsWith("text/")) return "DOC";
  return "FILE";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ProjectWorkspaceEnhancer() {
  const [filesMount, setFilesMount] = useState<HTMLElement | null>(null);
  const [activityMount, setActivityMount] = useState<HTMLElement | null>(null);
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [spaces, setSpaces] = useState<ProjectFileSpace[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [docsUnavailable, setDocsUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const currentProjectId = useRef("");

  useEffect(() => {
    const inspect = () => {
      const workspace = document.querySelector<HTMLElement>(".project-workspace-redesign");
      const projectId = workspace?.dataset.projectId ?? "";
      const workspaceId = workspace?.dataset.workspaceId ?? "";
      const name = workspace?.dataset.projectName ?? "";
      const nextFilesMount = workspace?.querySelector<HTMLElement>(".project-files-mount") ?? null;
      const nextActivityMount = workspace?.querySelector<HTMLElement>(".project-activity-mount") ?? null;

      if (!workspace || !projectId || !workspaceId || !name) {
        if (!currentProjectId.current) return;
        currentProjectId.current = "";
        setProject(null);
        setFilesMount(null);
        setActivityMount(null);
        return;
      }

      setFilesMount((current) => current === nextFilesMount ? current : nextFilesMount);
      setActivityMount((current) => current === nextActivityMount ? current : nextActivityMount);
      if (currentProjectId.current === projectId) return;

      currentProjectId.current = projectId;
      setProject({ id: projectId, workspaceId, name });
      setSpaces([]);
      setFiles([]);
      setTimeline([]);
      setSelectedSpaceId("all");
      setQuery("");
      setMessage("");
      setDocsUnavailable(false);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!project) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setFilesLoading(true);
    try {
      const [nextSpaces, nextFiles] = await Promise.all([
        listProjectFileSpaces(supabase, project.id),
        listProjectFiles(supabase, project.id),
      ]);
      setSpaces(nextSpaces);
      setFiles(nextFiles);
      setDocsUnavailable(false);
      setSelectedSpaceId((current) => current !== "all" && !nextSpaces.some((space) => space.id === current) ? "all" : current);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setDocsUnavailable(text.includes("project_file_spaces") || text.includes("project_files") || text.includes("schema cache"));
      setMessage(text);
    } finally {
      setFilesLoading(false);
    }
  }, [project]);

  const loadTimeline = useCallback(async () => {
    if (!project) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setActivityLoading(true);
    try {
      const [taskResult, nodeResult, fileResult] = await Promise.all([
        supabase.from("tasks").select("id").eq("project_id", project.id),
        supabase.from("project_nodes").select("id").eq("project_id", project.id),
        supabase.from("project_files").select("id").eq("project_id", project.id),
      ]);

      const entityIds = new Set<string>([project.id]);
      (taskResult.data ?? []).forEach((item) => entityIds.add(item.id));
      (nodeResult.data ?? []).forEach((item) => entityIds.add(item.id));
      (fileResult.data ?? []).forEach((item) => entityIds.add(item.id));

      const { data: activityRows, error } = await supabase
        .from("activity_log")
        .select("id, actor_id, entity_type, entity_id, action, summary, metadata, created_at")
        .eq("workspace_id", project.workspaceId)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw new Error(error.message);

      const relevant = (activityRows ?? []).filter((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        return entityIds.has(String(row.entity_id ?? "")) || metadata.projectId === project.id;
      });

      const actorIds = [...new Set(relevant.map((row) => row.actor_id).filter(Boolean))] as string[];
      const actorNames = new Map<string, string>();
      if (actorIds.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds);
        (profiles ?? []).forEach((profile) => actorNames.set(profile.id, profile.display_name));
      }

      setTimeline(relevant.map((row) => ({
        id: row.id,
        actorId: row.actor_id ?? undefined,
        actorName: row.actor_id ? actorNames.get(row.actor_id) ?? "Team member" : "TBFT",
        summary: row.summary,
        action: row.action,
        entityType: row.entity_type,
        createdAt: row.created_at,
      })));
      setMessage("");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      // project_files may not exist until the document-workspace migration is run.
      if (text.includes("project_files") || text.includes("schema cache")) {
        try {
          const { data: activityRows } = await supabase
            .from("activity_log")
            .select("id, actor_id, entity_type, entity_id, action, summary, created_at")
            .eq("workspace_id", project.workspaceId)
            .eq("entity_id", project.id)
            .order("created_at", { ascending: false })
            .limit(100);
          setTimeline((activityRows ?? []).map((row) => ({
            id: row.id,
            actorId: row.actor_id ?? undefined,
            actorName: "Team member",
            summary: row.summary,
            action: row.action,
            entityType: row.entity_type,
            createdAt: row.created_at,
          })));
        } catch {
          setMessage(text);
        }
      } else {
        setMessage(text);
      }
    } finally {
      setActivityLoading(false);
    }
  }, [project]);

  useEffect(() => {
    const handleTabChange = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; tab?: string }>).detail;
      if (!project || detail?.projectId !== project.id) return;
      if (detail.tab === "files") void loadDocuments();
      if (detail.tab === "activity") void loadTimeline();
    };
    window.addEventListener("tbft:project-workspace-tab", handleTabChange);
    return () => window.removeEventListener("tbft:project-workspace-tab", handleTabChange);
  }, [loadDocuments, loadTimeline, project]);

  const rootSpace = spaces.find((space) => space.kind === "project");
  const taskSpaces = spaces.filter((space) => space.kind === "task");
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId);
  const filteredFiles = useMemo(() => {
    const search = query.trim().toLowerCase();
    return files.filter((file) => {
      if (selectedSpaceId !== "all" && file.fileSpaceId !== selectedSpaceId) return false;
      return !search || file.originalName.toLowerCase().includes(search);
    });
  }, [files, query, selectedSpaceId]);

  const uploadFiles = async (picked: FileList | null) => {
    const pickedFiles = Array.from(picked ?? []);
    if (!pickedFiles.length || !project || busy) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const targetSpace = selectedSpaceId === "all" ? rootSpace : selectedSpace;
    if (!targetSpace) {
      setMessage("Choose a project or task folder before uploading.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      for (const file of pickedFiles) {
        await uploadProjectFile(supabase, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          taskId: targetSpace.taskId,
          userId,
          file,
          provider: targetSpace.provider,
        });
      }
      await loadDocuments();
      setMessage(`${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: ProjectFile) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const url = await createProjectFileUrl(supabase, file);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const removeFile = async (file: ProjectFile) => {
    if (!window.confirm(`Remove “${file.originalName}” from this project?`)) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    setBusy(true);
    try {
      await deleteProjectFile(supabase, file, userId);
      await loadDocuments();
      setMessage("File removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!project || !filesMount || !activityMount) return null;

  const documents = (
    <section className="project-documents-workspace">
      <div className="project-workspace-section-heading">
        <div>
          <span className="eyebrow">PROJECT LIBRARY</span>
          <h4>Files</h4>
          <p>Project files and automatic task folders in one place.</p>
        </div>
        {!docsUnavailable && (
          <label className={busy ? "project-upload-button disabled" : "project-upload-button"}>
            {busy ? "Uploading…" : "+ Add files"}
            <input type="file" multiple disabled={busy} onChange={(event) => { void uploadFiles(event.target.files); event.currentTarget.value = ""; }} />
          </label>
        )}
      </div>

      {docsUnavailable ? (
        <div className="project-workspace-setup">
          <strong>Document workspace needs its one-time database setup.</strong>
          <span>Run <code>supabase/project-workspaces-v1.sql</code> in the Supabase SQL Editor, then reopen this tab.</span>
        </div>
      ) : (
        <div className="project-documents-layout">
          <aside className="project-folder-list">
            <button className={selectedSpaceId === "all" ? "active" : ""} onClick={() => setSelectedSpaceId("all")}>
              <span>All files</span><strong>{files.length}</strong>
            </button>
            {rootSpace && (
              <button className={selectedSpaceId === rootSpace.id ? "active" : ""} onClick={() => setSelectedSpaceId(rootSpace.id)}>
                <span>Project root</span><strong>{files.filter((file) => file.fileSpaceId === rootSpace.id).length}</strong>
              </button>
            )}
            {taskSpaces.length > 0 && <small>Task folders</small>}
            {taskSpaces.map((space) => (
              <button key={space.id} className={selectedSpaceId === space.id ? "active" : ""} onClick={() => setSelectedSpaceId(space.id)}>
                <span>{space.label}</span><strong>{files.filter((file) => file.fileSpaceId === space.id).length}</strong>
              </button>
            ))}
          </aside>

          <div className="project-file-browser">
            <div className="project-file-browser-toolbar">
              <div>
                <strong>{selectedSpaceId === "all" ? "All files" : selectedSpace?.label ?? "Project files"}</strong>
                {selectedSpace && <span>{storageProviderLabel(selectedSpace.provider)}</span>}
              </div>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files…" />
            </div>

            {filesLoading ? (
              <div className="project-workspace-empty">Loading files…</div>
            ) : filteredFiles.length ? (
              <div className="project-file-list">
                {filteredFiles.map((file) => {
                  const folder = spaces.find((space) => space.id === file.fileSpaceId);
                  return (
                    <article key={file.id}>
                      <span className="project-file-kind">{fileKind(file)}</span>
                      <div>
                        <strong>{file.originalName}</strong>
                        <span>{folder?.label ?? "Project"} · {formatBytes(file.sizeBytes)} · {dateTime(file.createdAt)}</span>
                      </div>
                      <div className="project-file-actions">
                        <button type="button" onClick={() => void openFile(file)}>Open</button>
                        <button type="button" disabled={busy} onClick={() => void removeFile(file)}>Remove</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="project-workspace-empty">
                <strong>No files here yet.</strong>
                <span>Select a folder and add the documents or final results worth keeping.</span>
              </div>
            )}
          </div>
        </div>
      )}
      {message && <p className="project-workspace-message">{message}</p>}
    </section>
  );

  const activityView = (
    <section className="project-timeline-workspace">
      <div className="project-workspace-section-heading">
        <div>
          <span className="eyebrow">PROJECT MEMORY</span>
          <h4>Activity</h4>
          <p>A chronological record of tasks, project changes, notes and files.</p>
        </div>
        <button type="button" className="secondary-button compact" onClick={() => void loadTimeline()}>Refresh</button>
      </div>

      {activityLoading ? (
        <div className="project-workspace-empty">Loading project history…</div>
      ) : timeline.length ? (
        <div className="project-timeline-list">
          {timeline.map((item) => (
            <article key={item.id}>
              <span className="project-timeline-dot" />
              <div>
                <p><strong>{item.actorName}</strong> {item.summary}</p>
                <span>{dateTime(item.createdAt)} · {item.entityType.replaceAll("_", " ")}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="project-workspace-empty">
          <strong>No project activity yet.</strong>
          <span>Task changes and uploaded files will build the project history automatically.</span>
        </div>
      )}
      {message && <p className="project-workspace-message">{message}</p>}
    </section>
  );

  return (
    <>
      {createPortal(documents, filesMount)}
      {createPortal(activityView, activityMount)}
    </>
  );
}
