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

type WorkspaceTab = "overview" | "documents" | "timeline";

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
  const [workspaceEl, setWorkspaceEl] = useState<HTMLElement | null>(null);
  const [tabsMount, setTabsMount] = useState<HTMLElement | null>(null);
  const [contentMount, setContentMount] = useState<HTMLElement | null>(null);
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [spaces, setSpaces] = useState<ProjectFileSpace[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docsUnavailable, setDocsUnavailable] = useState(false);
  const [message, setMessage] = useState("");
  const currentWorkspace = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const inspect = () => {
      const next = document.querySelector<HTMLElement>(".project-workspace");
      if (next === currentWorkspace.current) return;

      currentWorkspace.current = next;
      setWorkspaceEl(next);
      setTabsMount(null);
      setContentMount(null);

      document.querySelectorAll(".tbft-workspace-v2-mount").forEach((item) => item.remove());
      if (!next) return;

      const anchor = next.querySelector<HTMLElement>(".large-progress")
        ?? next.querySelector<HTMLElement>(".project-toolbar");
      if (!anchor) return;

      const tabs = document.createElement("div");
      tabs.className = "tbft-workspace-v2-mount tbft-workspace-v2-tabs-mount";
      const content = document.createElement("div");
      content.className = "tbft-workspace-v2-mount tbft-workspace-v2-content-mount";
      anchor.parentElement?.insertBefore(tabs, anchor);
      anchor.parentElement?.insertBefore(content, anchor);
      setTabsMount(tabs);
      setContentMount(content);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!workspaceEl) {
      setProject(null);
      return;
    }

    let cancelled = false;
    const resolve = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const activeName = workspaceEl.querySelector<HTMLElement>(".project-identity h3")?.textContent?.trim();
      const description = workspaceEl.querySelector<HTMLElement>(".project-identity p")?.textContent?.trim() ?? "";
      if (!activeName) return;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", uid)
        .limit(1)
        .maybeSingle();
      if (!membership) return;

      const { data: projects } = await supabase
        .from("projects")
        .select("id, workspace_id, name, description, created_at")
        .eq("workspace_id", membership.workspace_id)
        .eq("name", activeName)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      const candidates = projects ?? [];
      const exactDescription = candidates.find((item) => {
        const dbDescription = String(item.description ?? "").trim();
        return dbDescription === description || (!dbDescription && description === "No description yet.");
      });
      const match = exactDescription ?? candidates[0];
      if (!cancelled && match) {
        setProject({ id: match.id, workspaceId: match.workspace_id, name: match.name });
        setTab("overview");
        setSelectedSpaceId("all");
        setQuery("");
        setMessage("");
      }
    };

    void resolve();
    return () => { cancelled = true; };
  }, [workspaceEl]);

  useEffect(() => {
    if (!workspaceEl) return;
    workspaceEl.dataset.workspaceTab = tab;
    workspaceEl.classList.toggle("workspace-v2-focused", tab !== "overview");
    return () => {
      delete workspaceEl.dataset.workspaceTab;
      workspaceEl.classList.remove("workspace-v2-focused");
    };
  }, [tab, workspaceEl]);

  const loadDocuments = useCallback(async () => {
    if (!project) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    try {
      const [nextSpaces, nextFiles] = await Promise.all([
        listProjectFileSpaces(supabase, project.id),
        listProjectFiles(supabase, project.id),
      ]);
      setSpaces(nextSpaces);
      setFiles(nextFiles);
      setDocsUnavailable(false);
      if (selectedSpaceId !== "all" && !nextSpaces.some((space) => space.id === selectedSpaceId)) {
        setSelectedSpaceId("all");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setDocsUnavailable(text.includes("project_file_spaces") || text.includes("project_files") || text.includes("schema cache"));
      setMessage(text);
    } finally {
      setLoading(false);
    }
  }, [project, selectedSpaceId]);

  const loadTimeline = useCallback(async () => {
    if (!project) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
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
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    if (tab === "documents") void loadDocuments();
    if (tab === "timeline") void loadTimeline();
  }, [tab, loadDocuments, loadTimeline]);

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
    if (!picked?.length || !project || busy) return;
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
      for (const file of Array.from(picked)) {
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
      setMessage(`${picked.length} file${picked.length === 1 ? "" : "s"} added.`);
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

  if (!project || !tabsMount || !contentMount) return null;

  const tabs = (
    <nav className="project-workspace-tabs" aria-label={`${project.name} workspace`}>
      {(["overview", "documents", "timeline"] as WorkspaceTab[]).map((item) => (
        <button
          key={item}
          type="button"
          className={tab === item ? "active" : ""}
          onClick={() => { setTab(item); setMessage(""); }}
        >
          {item === "overview" ? "Overview" : item === "documents" ? "Documents" : "Timeline"}
        </button>
      ))}
    </nav>
  );

  const documents = (
    <section className="project-documents-workspace">
      <div className="project-workspace-section-heading">
        <div>
          <span className="eyebrow">PROJECT LIBRARY</span>
          <h4>Documents</h4>
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

            {loading ? (
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

  const timelineView = (
    <section className="project-timeline-workspace">
      <div className="project-workspace-section-heading">
        <div>
          <span className="eyebrow">PROJECT MEMORY</span>
          <h4>Timeline</h4>
          <p>A chronological record of tasks, project changes, notes and files.</p>
        </div>
        <button type="button" className="secondary-button compact" onClick={() => void loadTimeline()}>Refresh</button>
      </div>

      {loading ? (
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
      {createPortal(tabs, tabsMount)}
      {createPortal(tab === "documents" ? documents : tab === "timeline" ? timelineView : null, contentMount)}
    </>
  );
}
