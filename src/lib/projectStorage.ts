import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectFile, ProjectFileSpace, StorageProvider } from "@/lib/types";
import { getStorageProvider } from "@/lib/storageProviders";

function mapSpace(row: Record<string, unknown>): ProjectFileSpace {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    projectId: (row.project_id as string | null) ?? undefined,
    taskId: (row.task_id as string | null) ?? undefined,
    parentSpaceId: (row.parent_space_id as string | null) ?? undefined,
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

const FILE_SPACE_SELECT = "id, workspace_id, project_id, task_id, parent_space_id, kind, label, provider, external_folder_id, external_folder_url, created_at";
const FILE_SELECT = "id, workspace_id, project_id, task_id, file_space_id, provider, storage_path, external_file_id, external_file_url, original_name, mime_type, size_bytes, uploaded_by, created_at, deleted_at";

export async function listProjectFileSpaces(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectFileSpace[]> {
  const { data, error } = await supabase
    .from("project_file_spaces")
    .select(FILE_SPACE_SELECT)
    .eq("project_id", projectId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSpace(row as Record<string, unknown>));
}

export async function listLonelyTaskFileSpaces(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ProjectFileSpace[]> {
  const { data, error } = await supabase
    .from("project_file_spaces")
    .select(FILE_SPACE_SELECT)
    .eq("workspace_id", workspaceId)
    .is("project_id", null)
    .in("kind", ["lonely_root", "task"])
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSpace(row as Record<string, unknown>));
}

export async function getTaskFileSpace(
  supabase: SupabaseClient,
  taskId: string,
): Promise<ProjectFileSpace | null> {
  const { data, error } = await supabase
    .from("project_file_spaces")
    .select(FILE_SPACE_SELECT)
    .eq("task_id", taskId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapSpace(data as Record<string, unknown>) : null;
}

export async function listProjectFiles(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select(FILE_SELECT)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapFile(row as Record<string, unknown>));
}

export async function listTaskFiles(
  supabase: SupabaseClient,
  taskId: string,
): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from("project_files")
    .select(FILE_SELECT)
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapFile(row as Record<string, unknown>));
}

async function resolveProvider(
  supabase: SupabaseClient,
  workspaceId: string,
  requested: StorageProvider,
): Promise<StorageProvider> {
  if (requested !== "supabase") return requested;
  const { data } = await supabase.rpc("storage_connection_status", { target_workspace: workspaceId });
  if (Array.isArray(data) && data.some((row) => row.provider === "google_drive")) return "google_drive";
  return requested;
}

export async function uploadProjectFile(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    projectId?: string;
    taskId?: string;
    userId: string;
    file: File;
    provider?: StorageProvider;
  },
): Promise<ProjectFile> {
  if (!input.projectId && !input.taskId) {
    throw new Error("Choose a project or task folder before uploading a file.");
  }

  let spaceQuery = supabase
    .from("project_file_spaces")
    .select("id, provider, project_id, task_id, kind");

  if (input.taskId) {
    spaceQuery = spaceQuery.eq("task_id", input.taskId);
  } else {
    spaceQuery = spaceQuery
      .eq("project_id", input.projectId as string)
      .eq("kind", "project")
      .is("task_id", null);
  }

  const { data: space, error: spaceError } = await spaceQuery.maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) throw new Error("This file workspace is not initialized yet. Run the latest TBFT file-space migration first.");

  const resolvedProjectId = (space.project_id as string | null) ?? undefined;
  const resolvedTaskId = (space.task_id as string | null) ?? input.taskId;
  const provider = await resolveProvider(
    supabase,
    input.workspaceId,
    input.provider ?? (space.provider as StorageProvider) ?? "supabase",
  );
  const adapter = getStorageProvider(supabase, provider);

  const stored = await adapter.upload({
    workspaceId: input.workspaceId,
    fileSpaceId: space.id as string,
    file: input.file,
  });

  const { data: inserted, error: metadataError } = await supabase
    .from("project_files")
    .insert({
      workspace_id: input.workspaceId,
      project_id: resolvedProjectId ?? null,
      task_id: resolvedTaskId ?? null,
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
    .select(FILE_SELECT)
    .single();

  if (metadataError || !inserted) {
    await adapter.remove({
      id: "pending",
      workspaceId: input.workspaceId,
      projectId: resolvedProjectId,
      taskId: resolvedTaskId,
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
      projectId: resolvedProjectId ?? null,
      taskId: resolvedTaskId ?? null,
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
    metadata: { projectId: file.projectId ?? null, taskId: file.taskId ?? null, provider: file.provider },
  });
}
