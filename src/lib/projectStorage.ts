import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectFile, ProjectFileSpace, StorageProvider } from "@/lib/types";
import { getStorageProvider } from "@/lib/storageProviders";

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
    provider?: StorageProvider;
  },
): Promise<ProjectFile> {
  const spaceQuery = supabase
    .from("project_file_spaces")
    .select("id, provider")
    .eq("project_id", input.projectId);

  const scopedQuery = input.taskId
    ? spaceQuery.eq("task_id", input.taskId)
    : spaceQuery.is("task_id", null);

  const { data: space, error: spaceError } = await scopedQuery.maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) throw new Error("This project workspace is not initialized yet. Run the TBFT project-workspaces migration first.");

  const provider = input.provider ?? (space.provider as StorageProvider) ?? "supabase";
  const adapter = getStorageProvider(supabase, provider);
  const proposedPath = storagePath({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    fileName: input.file.name,
  });

  const stored = await adapter.upload({ path: proposedPath, file: input.file });

  const { data: inserted, error: metadataError } = await supabase
    .from("project_files")
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      task_id: input.taskId ?? null,
      file_space_id: space.id,
      provider,
      storage_path: stored.storagePath ?? null,
      external_file_id: stored.externalFileId ?? null,
      external_file_url: stored.externalFileUrl ?? null,
      original_name: input.file.name,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      uploaded_by: input.userId,
    })
    .select("id, workspace_id, project_id, task_id, file_space_id, provider, storage_path, external_file_id, external_file_url, original_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at")
    .single();

  if (metadataError || !inserted) {
    await adapter.remove({
      id: "pending",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      fileSpaceId: space.id as string,
      provider,
      storagePath: stored.storagePath,
      externalFileId: stored.externalFileId,
      externalFileUrl: stored.externalFileUrl,
      originalName: input.file.name,
      mimeType: input.file.type || undefined,
      sizeBytes: input.file.size,
      uploadedBy: input.userId,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
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
      provider,
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
  return getStorageProvider(supabase, file.provider).createOpenUrl(file, expiresInSeconds);
}

export async function deleteProjectFile(
  supabase: SupabaseClient,
  file: ProjectFile,
  userId: string,
): Promise<void> {
  await getStorageProvider(supabase, file.provider).remove(file);

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
    metadata: { projectId: file.projectId, taskId: file.taskId ?? null, provider: file.provider },
  });
}
