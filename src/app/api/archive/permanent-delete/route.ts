import { NextResponse } from "next/server";
import {
  adminSupabase,
  removeGoogleDriveFile,
  requireWorkspaceMembership,
  syncGoogleDriveHierarchy,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

type ProjectFileRow = {
  id: string;
  provider: string;
  storage_path: string | null;
  external_file_id: string | null;
};

async function removeStoredFiles(workspaceId: string, files: ProjectFileRow[]) {
  const admin = adminSupabase();
  const googleFiles = files.filter((file) => file.provider === "google_drive" && file.external_file_id);
  for (const file of googleFiles) {
    await removeGoogleDriveFile(workspaceId, file.external_file_id as string);
  }

  const supabasePaths = files
    .filter((file) => file.provider === "supabase" && file.storage_path)
    .map((file) => file.storage_path as string);
  if (supabasePaths.length) {
    const { error } = await admin.storage.from("tbft-files").remove(supabasePaths);
    if (error) throw new Error(error.message);
  }
}

async function deleteTask(request: Request, taskId: string) {
  const admin = adminSupabase();
  const { data: root, error } = await admin
    .from("tasks")
    .select("id, workspace_id, owner_user_id, recurrence_type, recurrence_source_id, deleted_at")
    .eq("id", taskId)
    .maybeSingle();
  if (error || !root) throw new Error("Task not found.");
  if (!root.deleted_at) throw new Error("Only archived tasks can be permanently deleted.");

  const member = await requireWorkspaceMembership(request, root.workspace_id);
  if (root.owner_user_id !== member.userId) throw new Error("Only the task owner can permanently delete it.");

  let ids = [root.id as string];
  if (!root.recurrence_source_id && root.recurrence_type !== "none") {
    const { data: generated } = await admin
      .from("tasks")
      .select("id")
      .eq("recurrence_source_id", root.id);
    ids = [...ids, ...(generated ?? []).map((row) => row.id as string)];
  }

  const { data: files } = await admin
    .from("project_files")
    .select("id, provider, storage_path, external_file_id")
    .in("task_id", ids);

  const { data: spaces } = await admin
    .from("project_file_spaces")
    .select("external_folder_id, provider")
    .in("task_id", ids);

  const hasGoogleArtifacts = (files ?? []).some((file) => file.provider === "google_drive" && file.external_file_id)
    || (spaces ?? []).some((space) => space.provider === "google_drive" && space.external_folder_id);
  if (hasGoogleArtifacts) {
    await removeStoredFiles(root.workspace_id, (files ?? []) as ProjectFileRow[]);
    for (const space of spaces ?? []) {
      if (space.provider === "google_drive" && space.external_folder_id) {
        await removeGoogleDriveFile(root.workspace_id, space.external_folder_id);
      }
    }
  } else {
    await removeStoredFiles(root.workspace_id, (files ?? []) as ProjectFileRow[]);
  }

  await admin.from("project_files").delete().in("task_id", ids);
  await admin.from("activity_log").delete().eq("entity_type", "task").in("entity_id", ids);

  if (!root.recurrence_source_id && root.recurrence_type !== "none") {
    await admin.from("tasks").delete().eq("recurrence_source_id", root.id);
  }
  const { error: deleteError } = await admin.from("tasks").delete().eq("id", root.id);
  if (deleteError) throw new Error(deleteError.message);
}

async function deleteProject(request: Request, projectId: string) {
  const admin = adminSupabase();
  const { data: project, error } = await admin
    .from("projects")
    .select("id, workspace_id, created_by, deleted_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) throw new Error("Project not found.");
  if (!project.deleted_at) throw new Error("Only archived projects can be permanently deleted.");

  const member = await requireWorkspaceMembership(request, project.workspace_id);
  if (project.created_by !== member.userId && member.role !== "owner") {
    throw new Error("Only the project creator or workspace owner can permanently delete it.");
  }

  const { data: rootSpace } = await admin
    .from("project_file_spaces")
    .select("id, provider, external_folder_id")
    .eq("project_id", project.id)
    .eq("kind", "project")
    .maybeSingle();

  const { data: taskRows } = await admin
    .from("tasks")
    .select("id")
    .eq("project_id", project.id);
  const taskIds = (taskRows ?? []).map((row) => row.id as string);

  const { data: projectFiles } = await admin
    .from("project_files")
    .select("id, provider, storage_path, external_file_id")
    .eq("project_id", project.id)
    .is("task_id", null);

  const hasGoogleRoot = rootSpace?.provider === "google_drive" && Boolean(rootSpace.external_folder_id);
  const hasGoogleRootFiles = (projectFiles ?? []).some((file) => file.provider === "google_drive" && file.external_file_id);

  // Surviving tasks become standalone first. Their logical file spaces move beneath
  // Fucking Lonely Tasks via the existing task-space trigger.
  if (taskIds.length) {
    const { error: moveError } = await admin
      .from("tasks")
      .update({ project_id: null, project_node_id: null })
      .in("id", taskIds);
    if (moveError) throw new Error(moveError.message);
  }

  if (hasGoogleRoot || hasGoogleRootFiles) {
    // Physically move surviving task folders out of the project folder before deleting it.
    await syncGoogleDriveHierarchy(project.workspace_id);
  }

  await removeStoredFiles(project.workspace_id, (projectFiles ?? []) as ProjectFileRow[]);
  await admin.from("project_files").delete().eq("project_id", project.id).is("task_id", null);

  if (hasGoogleRoot && rootSpace?.external_folder_id) {
    await removeGoogleDriveFile(project.workspace_id, rootSpace.external_folder_id);
  }

  const { data: nodes } = await admin.from("project_nodes").select("id").eq("project_id", project.id);
  const nodeIds = (nodes ?? []).map((row) => row.id as string);
  await admin.from("activity_log").delete().eq("entity_type", "project").eq("entity_id", project.id);
  if (nodeIds.length) await admin.from("activity_log").delete().eq("entity_type", "project_node").in("entity_id", nodeIds);

  const { error: deleteError } = await admin.from("projects").delete().eq("id", project.id);
  if (deleteError) throw new Error(deleteError.message);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { kind?: "task" | "project"; id?: string };
    if (!body.kind || !body.id) return NextResponse.json({ error: "kind and id are required." }, { status: 400 });
    if (body.kind === "task") await deleteTask(request, body.id);
    else await deleteProject(request, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Permanent deletion failed." }, { status: 400 });
  }
}
