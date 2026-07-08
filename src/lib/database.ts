import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Activity,
  AppData,
  Project,
  ProjectNode,
  Task,
  TaskAppearance,
  TaskMessage,
  UserProfile,
  WorkspaceRole,
  WorkspaceType,
} from "@/lib/types";

export class DatabaseNotReadyError extends Error {
  constructor(message = "The Supabase database has not been initialized for TBFT.") {
    super(message);
    this.name = "DatabaseNotReadyError";
  }
}

function throwIfError(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || error.message.includes("does not exist")) {
    throw new DatabaseNotReadyError();
  }
  throw new Error(error.message);
}

function normalizeTime(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 5);
}

export async function findWorkspaceMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ workspaceId: string; role: WorkspaceRole; position: number } | null> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, position")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  throwIfError(error);
  if (!data) return null;

  return {
    workspaceId: data.workspace_id as string,
    role: data.role as WorkspaceRole,
    position: data.position as number,
  };
}

export async function loadWorkspaceData(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppData | null> {
  const membership = await findWorkspaceMembership(supabase, userId);
  if (!membership) return null;

  const workspaceId = membership.workspaceId;
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, type, timezone, rollover_hour, discreet_mode, ui_density, accent_color")
    .eq("id", workspaceId)
    .single();
  throwIfError(workspaceError);
  if (!workspace) throw new Error("Workspace not found.");

  const { data: memberRows, error: memberError } = await supabase
    .from("workspace_members")
    .select("user_id, role, position")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });
  throwIfError(memberError);

  const memberIds = (memberRows ?? []).map((row) => row.user_id as string);
  let profileRows: Array<Record<string, unknown>> = [];
  if (memberIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, initials, accent")
      .in("id", memberIds);
    throwIfError(profileError);
    profileRows = (profiles ?? []) as Array<Record<string, unknown>>;
  }

  const profileById = new Map(profileRows.map((row) => [row.id as string, row]));
  const users: UserProfile[] = (memberRows ?? []).map((member) => {
    const profile = profileById.get(member.user_id as string);
    const name = (profile?.display_name as string | undefined) ?? "Partner";
    return {
      id: member.user_id as string,
      name,
      initials: (profile?.initials as string | undefined) || name.slice(0, 2).toUpperCase(),
      accent: (profile?.accent as string | undefined) || "#7c9caa",
    };
  });

  const [projectsResult, tasksResult, activitiesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, owner_user_id, is_joint, target_date, preferred_view, created_at, deleted_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, title, description, owner_user_id, created_by, original_date, deadline, priority, project_id, project_node_id, completed_at, deleted_at, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("activity_log")
      .select("id, actor_id, summary, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(250),
  ]);

  throwIfError(projectsResult.error);
  throwIfError(tasksResult.error);
  throwIfError(activitiesResult.error);

  const rawProjects = projectsResult.data ?? [];
  const projectIds = rawProjects.map((row) => row.id as string);
  let rawNodes: Array<Record<string, unknown>> = [];
  if (projectIds.length) {
    const { data: nodes, error: nodesError } = await supabase
      .from("project_nodes")
      .select("id, project_id, title, position")
      .in("project_id", projectIds)
      .order("position", { ascending: true });
    throwIfError(nodesError);
    rawNodes = (nodes ?? []) as Array<Record<string, unknown>>;
  }

  const nodesByProject = new Map<string, ProjectNode[]>();
  for (const row of rawNodes) {
    const projectId = row.project_id as string;
    const current = nodesByProject.get(projectId) ?? [];
    current.push({
      id: row.id as string,
      title: row.title as string,
      position: row.position as number,
    });
    nodesByProject.set(projectId, current);
  }

  const projects: Project[] = rawProjects.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    ownerId: row.is_joint ? "joint" : ((row.owner_user_id as string | null) ?? "joint"),
    targetDate: (row.target_date as string | null) ?? undefined,
    view: row.preferred_view as Project["view"],
    nodes: nodesByProject.get(row.id as string) ?? [],
    createdAt: row.created_at as string,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
  }));

  const rawTasks = tasksResult.data ?? [];
  const tasks: Task[] = rawTasks.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) || undefined,
    ownerId: row.owner_user_id as string,
    creatorId: row.created_by as string,
    originalDate: row.original_date as string,
    deadline: normalizeTime(row.deadline as string | null),
    priority: row.priority as Task["priority"],
    projectId: (row.project_id as string | null) ?? undefined,
    projectNodeId: (row.project_node_id as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
    deletedAt: (row.deleted_at as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  const taskIds = tasks.map((task) => task.id);
  let messages: TaskMessage[] = [];
  let taskAppearances: TaskAppearance[] = [];
  if (taskIds.length) {
    const [messageResult, appearanceResult] = await Promise.all([
      supabase
        .from("task_messages")
        .select("id, task_id, author_id, body, created_at")
        .in("task_id", taskIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("task_day_appearances")
        .select("task_id, board_date, appearance_type")
        .in("task_id", taskIds),
    ]);
    throwIfError(messageResult.error);
    throwIfError(appearanceResult.error);

    messages = (messageResult.data ?? []).map((row) => ({
      id: row.id as string,
      taskId: row.task_id as string,
      authorId: row.author_id as string,
      body: row.body as string,
      createdAt: row.created_at as string,
    }));

    taskAppearances = (appearanceResult.data ?? []).map((row) => ({
      taskId: row.task_id as string,
      boardDate: row.board_date as string,
      type: row.appearance_type as TaskAppearance["type"],
    }));
  }

  const activities: Activity[] = (activitiesResult.data ?? []).map((row) => ({
    id: row.id as string,
    actorId: (row.actor_id as string | null) ?? users[0]?.id ?? userId,
    text: row.summary as string,
    createdAt: row.created_at as string,
  }));

  return {
    workspaceId,
    workspaceType: workspace.type as WorkspaceType,
    currentUserRole: membership.role,
    users,
    tasks,
    taskAppearances,
    messages,
    projects,
    activities,
    settings: {
      timezone: workspace.timezone as string,
      rolloverHour: workspace.rollover_hour as number,
      discreetMode: workspace.discreet_mode as boolean,
      workspaceName: workspace.name as string,
      uiDensity: workspace.ui_density as AppData["settings"]["uiDensity"],
      accentColor: workspace.accent_color as string,
    },
  };
}

export async function recordActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  actorId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  summary: string,
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    workspace_id: workspaceId,
    actor_id: actorId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    summary,
  });
  throwIfError(error);
}

export async function createWorkspace(
  supabase: SupabaseClient,
  input: {
    name: string;
    type: WorkspaceType;
    timezone: string;
    displayName: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_workspace_with_owner", {
    workspace_name: input.name,
    workspace_type_value: input.type,
    workspace_timezone: input.timezone,
    display_name_value: input.displayName,
  });
  throwIfError(error);
  return data as string;
}

export async function createPartnerInvite(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_partner_invite", {
    target_workspace: workspaceId,
  });
  throwIfError(error);
  return data as string;
}

export async function acceptPartnerInvite(
  supabase: SupabaseClient,
  inviteCode: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("accept_partner_invite", {
    invite_code: inviteCode.trim(),
  });
  throwIfError(error);
  return data as string;
}

export async function repairRollovers(
  supabase: SupabaseClient,
  workspaceId: string,
  boardDate: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("repair_workspace_rollovers", {
    target_workspace: workspaceId,
    target_board_date: boardDate,
  });
  throwIfError(error);
  return Number(data ?? 0);
}
