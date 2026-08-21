"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";
import { createProjectFileUrl } from "@/lib/projectStorage";
import type { ProjectFile } from "@/lib/types";

type ProjectRow = { id: string; description: string | null };

function mapFile(row: Record<string, unknown>): ProjectFile {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    projectId: (row.project_id as string | null) ?? undefined,
    taskId: (row.task_id as string | null) ?? undefined,
    fileSpaceId: (row.file_space_id as string | null) ?? undefined,
    provider: row.provider as ProjectFile["provider"],
    storagePath: (row.storage_path as string | null) ?? undefined,
    externalFileId: (row.external_file_id as string | null) ?? undefined,
    externalFileUrl: (row.external_file_url as string | null) ?? undefined,
    originalName: row.original_name as string,
    mimeType: (row.mime_type as string | null) ?? undefined,
    sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
    uploadedBy: row.uploaded_by as string,
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  };
}

const FILE_SELECT = "id, workspace_id, project_id, task_id, file_space_id, provider, storage_path, external_file_id, external_file_url, original_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at";

export default function ProjectFileRecoveryEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [missing, setMissing] = useState<ProjectFile[]>([]);
  const [message, setMessage] = useState("");
  const currentDocs = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const recover = async (docs: HTMLElement) => {
      const supabase = getSupabaseClient();
      if (!supabase || !document.body.contains(docs)) return;
      const workspace = docs.closest<HTMLElement>(".project-workspace");
      const name = workspace?.querySelector<HTMLElement>(".project-identity h3")?.textContent?.trim() ?? "";
      const description = workspace?.querySelector<HTMLElement>(".project-identity p")?.textContent?.trim() ?? "";
      if (!name) return;

      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return;
      const { data: membership } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
      if (!membership) return;

      // Google Drive uploads carry tbftWorkspaceId + tbftSpaceId appProperties. If the
      // browser upload finished but the project_files insert was interrupted, rebuild
      // the missing metadata before querying the project library.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (accessToken) {
          const response = await fetch("/api/google-drive/reconcile-files", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ workspaceId: membership.workspace_id }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({})) as { error?: string };
            if (payload.error) setMessage(payload.error);
          }
        }
      } catch {
        // Recovery below can still surface already-indexed metadata if Drive reconciliation fails.
      }

      const { data: candidateRows } = await supabase
        .from("projects")
        .select("id, description")
        .eq("workspace_id", membership.workspace_id)
        .eq("name", name)
        .is("deleted_at", null);
      const candidates = (candidateRows ?? []) as ProjectRow[];
      if (!candidates.length) return;

      const exact = candidates.filter((candidate) => {
        const dbDescription = String(candidate.description ?? "").trim();
        return dbDescription === description || (!dbDescription && description === "No description yet.");
      });
      const pool = exact.length ? exact : candidates;
      const projectIds = pool.map((candidate) => candidate.id);

      const { data: spaceRows } = await supabase
        .from("project_file_spaces")
        .select("id")
        .in("project_id", projectIds);
      const spaceIds = (spaceRows ?? []).map((row) => row.id as string);

      const [byProject, bySpace] = await Promise.all([
        supabase.from("project_files").select(FILE_SELECT).in("project_id", projectIds).is("deleted_at", null).order("created_at", { ascending: false }),
        spaceIds.length ? supabase.from("project_files").select(FILE_SELECT).in("file_space_id", spaceIds).is("deleted_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ]);
      if (byProject.error) {
        setMessage(byProject.error.message);
        return;
      }
      if (bySpace.error) {
        setMessage(bySpace.error.message);
        return;
      }

      const merged = new Map<string, ProjectFile>();
      [...(byProject.data ?? []), ...(bySpace.data ?? [])].forEach((row) => merged.set(row.id as string, mapFile(row as Record<string, unknown>)));

      // Give the primary Documents component a moment to finish painting, then surface
      // metadata-backed files that it did not render itself.
      window.setTimeout(() => {
        if (!document.body.contains(docs)) return;
        const renderedNames = new Set(
          Array.from(docs.querySelectorAll<HTMLElement>(".project-file-list article strong"))
            .map((item) => item.textContent?.trim())
            .filter(Boolean),
        );
        setMissing([...merged.values()].filter((file) => !renderedNames.has(file.originalName)));
      }, 220);
    };

    const inspect = () => {
      const docs = document.querySelector<HTMLElement>(".project-documents-workspace");
      if (docs === currentDocs.current) return;
      currentDocs.current = docs;
      setMissing([]);
      setMessage("");
      setMount(null);
      document.querySelectorAll(".tbft-project-recovery-mount").forEach((item) => item.remove());
      if (!docs) return;

      const browser = docs.querySelector<HTMLElement>(".project-file-browser");
      if (!browser) return;
      const target = document.createElement("div");
      target.className = "tbft-project-recovery-mount";
      browser.append(target);
      setMount(target);

      window.setTimeout(() => void recover(docs), 80);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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

  if (!mount || (!missing.length && !message)) return null;
  return createPortal(
    <div className="project-recovered-files">
      {missing.length > 0 && (
        <>
          <div className="project-recovered-heading">
            <span className="eyebrow">RECOVERED FILES</span>
            <span>{missing.length} Drive-backed file{missing.length === 1 ? "" : "s"}</span>
          </div>
          <div className="project-recovered-list">
            {missing.map((file) => (
              <button key={file.id} type="button" onClick={() => void open(file)}>
                <strong>{file.originalName}</strong>
                <span>Open from {file.provider === "google_drive" ? "Google Drive" : "storage"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {message && <p>{message}</p>}
    </div>,
    mount,
  );
}
