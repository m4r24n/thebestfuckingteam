import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectFile, ProjectFileSpace } from "@/lib/types";

const BUCKET = "tbft-files";

function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "file").slice(0, 180);
}

function storagePath(input: {
  workspaceId: string;
  projectId: string;
  taskId?: string;
  fileName: string;
}): string {
  const scope = input.taskId ? `tasks/${input.taskId}` : "project";
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${input.workspaceId}/projects/${input.projectId}/${scope}/${unique}-${safeFileName(input.fileName)}`;
}

function mapSpace(row: Record<string, unknown>): ProjectFileSpace {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    projectId: row.project_id as string,
    taskId: (row.task_id as string | null) ?? undefined,
    kind: row.kind as ProjectFileSpace["kind"],
    label: row.label as string,
    provider: row.provider as ProjectFileSpace["provider"],
    externalFolderId: (row.external_folder_id as string | null) ?? undefined,
    externalFolderUrl: (row.external_folder_url as string | null) ?? undefined,
    createdAt: row.created_at as string,
  };
}

function mapFile(row: Record<string, unknown>): ProjectFile {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    projectId: row.project_id as string,
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

export async function listProjectFileSpaces(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectFileSpace[]> {
  const { data, error } = await supabase
    .from("project_file_spaces")
    .select("id, workspace_id, project_id, task_id, kind, label, provider, external_folder_id, external_folder_url, created_at")
    .eq("project_id", projectId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSpace(row as Record<string, unknown>));
}

export async function listProjectFiles(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select("id, workspace_id, project_id, task_id, file_space_id, provider, storage_path, external_file_id, external_file_url, original_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapFile(row as Record<string, unknown>));
}

export async function uploadProjectFile(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    projectId: string;
    taskId?: string;
    userId: string;
    file: File;
  },
): Promise<ProjectFile> {
  const spaceQuery = supabase
    .from("project_file_spaces")
    .select("id")
    .eq("project_id", input.projectId);

  const scopedQuery = input.taskId
    ? spaceQuery.eq("task_id", input.taskId)
    : spaceQuery.is("task_id", null);

  const { data: space, error: spaceError } = await scopedQuery.maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) throw new Error("This project workspace is not initialized yet. Run the TBFT project-workspaces migration first.");

  const path = storagePath({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    fileName: input.file.name,
  });

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
    cacheControl: "3600",
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data: inserted, error: metadataError } = await supabase
    .from("project_files")
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      task_id: input.taskId ?? null,
      file_space_id: space.id,
      provider: "supabase",
      storage_path: path,
      original_name: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      uploaded_by: input.userId,
    })
    .select("id, workspace_id, project_id, task_id, file_space_id, provider, storage_path, external_file_id, external_file_url, original_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at")
    .single();

  if (metadataError || !inserted) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(metadataError?.message ?? "File metadata could not be saved.");
  }

  await supabase.from("activity_log").insert({
    workspace_id: input.workspaceId,
    actor_id: input.userId,
    entity_type: "project_file",
    entity_id: inserted.id,
    action: "uploaded",
    summary: `uploaded “${input.file.name}”.`,
    metadata: {
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      sizeBytes: input.file.size,
      mimeType: input.file.type || null,
    },
  });

  return mapFile(inserted as Record<string, unknown>);
}

export async function createProjectFileUrl(
  supabase: SupabaseClient,
  file: ProjectFile,
  expiresInSeconds = 300,
): Promise<string> {
  if (file.provider !== "supabase") {
    if (file.externalFileUrl) return file.externalFileUrl;
    throw new Error("This external file does not have an openable URL yet.");
  }
  if (!file.storagePath) throw new Error("File storage path is missing.");

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not open this file.");
  return data.signedUrl;
}

export async function deleteProjectFile(
  supabase: SupabaseClient,
  file: ProjectFile,
  userId: string,
): Promise<void> {
  if (file.provider === "supabase" && file.storagePath) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([file.storagePath]);
    if (removeError) throw new Error(removeError.message);
  }

  const { error } = await supabase
    .from("project_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", file.id);
  if (error) throw new Error(error.message);

  await supabase.from("activity_log").insert({
    workspace_id: file.workspaceId,
    actor_id: userId,
    entity_type: "project_file",
    entity_id: file.id,
    action: "deleted",
    summary: `removed “${file.originalName}”.`,
    metadata: { projectId: file.projectId, taskId: file.taskId ?? null },
  });
}
