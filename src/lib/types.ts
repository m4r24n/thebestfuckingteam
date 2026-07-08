export type WorkspaceType = "solo" | "couple";
export type WorkspaceRole = "owner" | "partner";

export type UserProfile = {
  id: string;
  name: string;
  initials: string;
  accent: string;
};

export type TaskMessage = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type TaskAppearance = {
  taskId: string;
  boardDate: string;
  type: "original" | "carried";
};

export type ProjectNode = {
  id: string;
  title: string;
  position: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  ownerId: string | "joint";
  targetDate?: string;
  view: "flow" | "folders" | "terminal";
  nodes: ProjectNode[];
  createdAt: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  ownerId: string;
  creatorId: string;
  originalDate: string;
  deadline?: string;
  priority: "low" | "normal" | "high";
  projectId?: string;
  projectNodeId?: string;
  completedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  actorId: string;
  text: string;
  createdAt: string;
};

export type AppSettings = {
  timezone: string;
  rolloverHour: number;
  discreetMode: boolean;
  workspaceName: string;
  uiDensity: "compact" | "comfortable" | "large";
  accentColor: string;
};

export type AppData = {
  workspaceId: string;
  workspaceType: WorkspaceType;
  currentUserRole: WorkspaceRole;
  users: UserProfile[];
  tasks: Task[];
  taskAppearances: TaskAppearance[];
  messages: TaskMessage[];
  projects: Project[];
  activities: Activity[];
  settings: AppSettings;
};
