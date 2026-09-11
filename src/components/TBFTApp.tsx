"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  addDays,
  dateCompare,
  daysBetween,
  formatClock,
  formatLongDate,
  formatShortDate,
  getBoardDate,
  getCalendarDate,
  getZonedParts,
  isGracePeriod,
} from "@/lib/date";
import {
  acceptPartnerInvite,
  createPartnerInvite,
  createWorkspace,
  DatabaseNotReadyError,
  loadWorkspaceData,
  recordActivity as writeActivity,
  repairRollovers,
} from "@/lib/database";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type {
  AppData,
  AppSettings,
  Project,
  Task,
  UserProfile,
  WorkspaceType,
} from "@/lib/types";

const DEFAULT_TIMEZONE = "Europe/Berlin";

type Section = "today" | "projects" | "calendar" | "activity" | "archive" | "settings";
type TaskVisualState = "pending" | "completed" | "overdue" | "carried" | "future";
type SyncState = "loading" | "saving" | "saved" | "offline" | "error";

type TaskFormState = {
  title: string;
  description: string;
  ownerId: string;
  originalDate: string;
  deadline: string;
  priority: Task["priority"];
  projectId: string;
  projectNodeId: string;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function userById(data: AppData, id: string): UserProfile {
  return data.users.find((user) => user.id === id) ?? data.users[0];
}

function taskAppearsOnDate(task: Task, date: string, data: AppData, now: Date): boolean {
  if (task.deletedAt || dateCompare(date, task.originalDate) < 0) return false;

  if (data.taskAppearances.some((appearance) => appearance.taskId === task.id && appearance.boardDate === date)) {
    return true;
  }

  // Safe fallback while a newly-created appearance is still travelling through Realtime.
  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  if (dateCompare(date, boardDate) > 0) return task.originalDate === date;
  const endDate = task.completedAt
    ? getBoardDate(data.settings.timezone, data.settings.rolloverHour, new Date(task.completedAt))
    : boardDate;
  return dateCompare(date, endDate) <= 0;
}

function getTaskState(task: Task, viewingDate: string, data: AppData, now: Date): TaskVisualState {
  if (task.completedAt) return "completed";

  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const calendarDate = getCalendarDate(data.settings.timezone, now);

  if (dateCompare(task.originalDate, boardDate) > 0 || dateCompare(viewingDate, boardDate) > 0) {
    return "future";
  }

  if (
    viewingDate === boardDate &&
    calendarDate !== boardDate &&
    isGracePeriod(data.settings.timezone, data.settings.rolloverHour, now)
  ) {
    return "overdue";
  }

  if (dateCompare(viewingDate, task.originalDate) > 0) return "carried";
  if (dateCompare(viewingDate, boardDate) < 0) return "overdue";
  return "pending";
}

function stateLabel(state: TaskVisualState): string {
  return {
    pending: "Pending",
    completed: "Completed",
    overdue: "Overdue · grace/history",
    carried: "Carried task",
    future: "Scheduled",
  }[state];
}

function syncLabel(state: SyncState): string {
  return {
    loading: "Loading cloud data",
    saving: "Saving…",
    saved: "Saved to cloud",
    offline: "Offline",
    error: "Sync needs attention",
  }[state];
}

export default function TBFTApp() {
  const supabase = getSupabaseClient();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [workspaceResolved, setWorkspaceResolved] = useState(false);
  const [databaseNotReady, setDatabaseNotReady] = useState(false);
  const [data, setData] = useState<AppData | null>(null);
  const [section, setSection] = useState<Section>("today");
  const [now, setNow] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState("");
  const [taskModal, setTaskModal] = useState<{ task?: Task; ownerId: string; date: string; projectId?: string; projectNodeId?: string } | null>(null);
  const [threadTaskId, setThreadTaskId] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState<{ project?: Project } | null>(null);
  const [phaseProjectId, setPhaseProjectId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const realtimeRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return;
      setAuthUser(sessionData.session?.user ?? null);
      setAuthReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setAuthUser(session?.user ?? null);
      setAuthReady(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setWorkspaceResolved(false);
        setData(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const refreshWorkspace = useCallback(async (withRolloverRepair = true) => {
    if (!supabase || !authUser) return;
    setSyncState((current) => current === "saving" ? current : "loading");
    setDatabaseNotReady(false);

    try {
      let loaded = await loadWorkspaceData(supabase, authUser.id);
      if (loaded && withRolloverRepair) {
        const currentBoardDate = getBoardDate(
          loaded.settings.timezone,
          loaded.settings.rolloverHour,
        );
        const inserted = await repairRollovers(supabase, loaded.workspaceId, currentBoardDate);
        if (inserted > 0) loaded = await loadWorkspaceData(supabase, authUser.id);
      }

      setData(loaded);
      setWorkspaceResolved(true);
      if (loaded) {
        window.localStorage.setItem(`tbft-cloud-cache-v1-${authUser.id}`, JSON.stringify(loaded));
        const currentBoardDate = getBoardDate(loaded.settings.timezone, loaded.settings.rolloverHour);
        setSelectedDate((current) => current || currentBoardDate);
        const activeProjects = loaded.projects.filter((project) => !project.deletedAt);
        setSelectedProjectId((current) => current && activeProjects.some((project) => project.id === current)
          ? current
          : null);
      }
      setSyncState("saved");
    } catch (error) {
      if (error instanceof DatabaseNotReadyError) {
        setDatabaseNotReady(true);
        setWorkspaceResolved(true);
      } else {
        const online = navigator.onLine;
        if (!online) {
          const cached = window.localStorage.getItem(`tbft-cloud-cache-v1-${authUser.id}`);
          if (cached) {
            try {
              const parsed = JSON.parse(cached) as AppData;
              setData(parsed);
              setWorkspaceResolved(true);
              setSelectedDate((current) => current || getBoardDate(parsed.settings.timezone, parsed.settings.rolloverHour));
            } catch {
              window.localStorage.removeItem(`tbft-cloud-cache-v1-${authUser.id}`);
            }
          }
        }
        setSyncState(online ? "error" : "offline");
        setToast(online ? errorMessage(error) : "Offline — showing the last cloud-synced copy where available");
      }
    }
  }, [authUser, supabase]);

  useEffect(() => {
    if (!authUser || !supabase) return;
    void refreshWorkspace(true);
  }, [authUser, supabase, refreshWorkspace]);

  useEffect(() => {
    if (!supabase || !data?.workspaceId) return;

    const scheduleRefresh = () => {
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => {
        void refreshWorkspace(false);
      }, 220);
    };

    const channel = supabase
      .channel(`tbft-workspace-${data.workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${data.workspaceId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members", filter: `workspace_id=eq.${data.workspaceId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${data.workspaceId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `workspace_id=eq.${data.workspaceId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `workspace_id=eq.${data.workspaceId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_nodes" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_messages" }, scheduleRefresh)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncState("error");
      });

    return () => {
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [data?.workspaceId, refreshWorkspace, supabase]);

  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.tbftDensity = data.settings.uiDensity;
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setSyncState("loading");
      void refreshWorkspace(true);
    };
    const onOffline = () => setSyncState("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!isSupabaseConfigured || !supabase) {
    return <ConfigurationScreen />;
  }

  if (!authReady) {
    return <div className="loading-screen">Opening your secure workspace…</div>;
  }

  if (!authUser) {
    return <AuthScreen />;
  }

  if (recoveryMode) {
    return <PasswordRecoveryScreen onDone={() => setRecoveryMode(false)} />;
  }

  if (databaseNotReady) {
    return <DatabaseSetupScreen onRetry={() => void refreshWorkspace(true)} />;
  }

  if (!workspaceResolved) {
    return <div className="loading-screen">Loading your cloud notebook…</div>;
  }

  if (!data) {
    return <OnboardingScreen user={authUser} onReady={() => void refreshWorkspace(true)} />;
  }

  if (!selectedDate) {
    return <div className="loading-screen">Preparing today’s page…</div>;
  }

  const activeUserId = authUser.id;
  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const activeUser = userById(data, activeUserId);
  const title = data.settings.discreetMode ? "TBFT" : data.settings.workspaceName;

  const safeActivity = async (
    entityType: string,
    entityId: string | null,
    action: string,
    summary: string,
  ) => {
    try {
      await writeActivity(supabase, data.workspaceId, activeUserId, entityType, entityId, action, summary);
    } catch {
      // Activity history must never prevent the user's primary change from being saved.
    }
  };

  const mutate = async (
    operation: () => Promise<void>,
    successMessage?: string,
  ): Promise<boolean> => {
    setSyncState("saving");
    try {
      await operation();
      await refreshWorkspace(false);
      setSyncState("saved");
      if (successMessage) setToast(successMessage);
      return true;
    } catch (error) {
      setSyncState(navigator.onLine ? "error" : "offline");
      setToast(errorMessage(error));
      return false;
    }
  };

  const saveTask = async (form: TaskFormState, existingTask?: Task) => {
    const titleValue = form.title.trim();
    const owner = userById(data, form.ownerId);

    const success = await mutate(async () => {
      if (existingTask) {
        const { error } = await supabase
          .from("tasks")
          .update({
            title: titleValue,
            description: form.description.trim(),
            owner_user_id: form.ownerId,
            original_date: form.originalDate,
            deadline: form.deadline || null,
            priority: form.priority,
            project_id: form.projectId || null,
            project_node_id: form.projectNodeId || null,
          })
          .eq("id", existingTask.id);
        if (error) throw error;
        await safeActivity("task", existingTask.id, "updated", `edited “${titleValue}”.`);
      } else {
        const { data: inserted, error } = await supabase
          .from("tasks")
          .insert({
            workspace_id: data.workspaceId,
            title: titleValue,
            description: form.description.trim(),
            owner_user_id: form.ownerId,
            created_by: activeUserId,
            original_date: form.originalDate,
            deadline: form.deadline || null,
            priority: form.priority,
            project_id: form.projectId || null,
            project_node_id: form.projectNodeId || null,
          })
          .select("id")
          .single();
        if (error) throw error;
        await safeActivity("task", inserted.id, "created", `created “${titleValue}” for ${owner.name}.`);
      }
    }, existingTask ? "Task updated" : `Task added for ${owner.name}`);

    if (success) setTaskModal(null);
  };

  const toggleTaskCompletion = async (task: Task, viewingDate: string) => {
    if (task.ownerId !== activeUserId) {
      setToast("Only the task owner can change completion");
      return;
    }
    if (!task.completedAt && dateCompare(viewingDate, boardDate) > 0) {
      setToast("A future task cannot be completed early");
      return;
    }

    const completing = !task.completedAt;
    await mutate(async () => {
      const { error } = await supabase
        .from("tasks")
        .update({ completed_at: completing ? new Date().toISOString() : null })
        .eq("id", task.id);
      if (error) throw error;
      const lateDays = Math.max(0, daysBetween(task.originalDate, boardDate));
      await safeActivity(
        "task",
        task.id,
        completing ? "completed" : "reopened",
        completing
          ? `completed “${task.title}”${lateDays ? ` ${lateDays} day${lateDays === 1 ? "" : "s"} late` : ""}.`
          : `marked “${task.title}” incomplete.`,
      );
      if (!completing) await repairRollovers(supabase, data.workspaceId, boardDate);
    }, completing ? "Task completed" : "Task returned to the list");
  };

  const deleteTask = (task: Task) => {
    if (task.ownerId !== activeUserId) {
      setToast("Only the task owner can delete it");
      return;
    }
    setConfirmDialog({
      title: "Move task to archive?",
      message: `“${task.title}” will leave the dashboard and project views, but its notes and history will remain recoverable.`,
      confirmLabel: "Move to archive",
      tone: "danger",
      onConfirm: async () => {
        await mutate(async () => {
          const { error } = await supabase
            .from("tasks")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", task.id);
          if (error) throw error;
          await safeActivity("task", task.id, "archived", `archived “${task.title}”.`);
        }, "Task moved to archive");
      },
    });
  };

  const addMessage = async (taskId: string, body: string) => {
    if (!body.trim()) return;
    const task = data.tasks.find((item) => item.id === taskId);
    await mutate(async () => {
      const { error } = await supabase.from("task_messages").insert({
        task_id: taskId,
        author_id: activeUserId,
        body: body.trim(),
      });
      if (error) throw error;
      if (task) await safeActivity("task", taskId, "commented", `commented on “${task.title}”.`);
    });
  };

  const saveProjectAction = async (
    name: string,
    description: string,
    targetDate: string,
    existingProject?: Project,
  ) => {
    let savedProjectId: string | null = existingProject?.id ?? null;
    const cleanedName = name.trim();
    const success = await mutate(async () => {
      if (existingProject) {
        const { error } = await supabase
          .from("projects")
          .update({
            name: cleanedName,
            description: description.trim(),
            target_date: targetDate || null,
          })
          .eq("id", existingProject.id);
        if (error) throw error;
        await safeActivity("project", existingProject.id, "updated", `edited project “${cleanedName}”.`);
      } else {
        const { data: inserted, error } = await supabase
          .from("projects")
          .insert({
            workspace_id: data.workspaceId,
            name: cleanedName,
            description: description.trim(),
            owner_user_id: null,
            is_joint: true,
            target_date: targetDate || null,
            preferred_view: "flow",
            created_by: activeUserId,
          })
          .select("id")
          .single();
        if (error) throw error;
        savedProjectId = inserted.id;
        await safeActivity("project", inserted.id, "created", `created project “${cleanedName}”.`);
      }
    }, existingProject ? "Project updated" : "Project created");

    if (success) {
      setProjectModal(null);
      setSelectedProjectId(savedProjectId);
    }
  };

  const archiveProject = (project: Project) => {
    setConfirmDialog({
      title: "Move project to archive?",
      message: `“${project.name}” and its phases will leave the Projects page. Connected tasks stay on their dashboards and will reconnect if the project is restored.`,
      confirmLabel: "Move to archive",
      tone: "danger",
      onConfirm: async () => {
        const success = await mutate(async () => {
          const { error } = await supabase
            .from("projects")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", project.id);
          if (error) throw error;
          await safeActivity("project", project.id, "archived", `archived project “${project.name}”.`);
        }, "Project moved to archive");
        if (success) {
          setSelectedProjectId(null);
        }
      },
    });
  };

  const restoreProject = async (project: Project) => {
    await mutate(async () => {
      const { error } = await supabase
        .from("projects")
        .update({ deleted_at: null })
        .eq("id", project.id);
      if (error) throw error;
      await safeActivity("project", project.id, "restored", `restored project “${project.name}”.`);
    }, "Project restored");
  };

  const restoreTask = async (task: Task) => {
    if (task.ownerId !== activeUserId) {
      setToast("Only the task owner can restore it");
      return;
    }
    await mutate(async () => {
      const { error } = await supabase
        .from("tasks")
        .update({ deleted_at: null })
        .eq("id", task.id);
      if (error) throw error;
      await safeActivity("task", task.id, "restored", `restored “${task.title}”.`);
      await repairRollovers(supabase, data.workspaceId, boardDate);
    }, "Task restored");
  };

  const addProjectNode = async (projectId: string, nodeTitle: string) => {
    const project = data.projects.find((item) => item.id === projectId);
    if (!project || !nodeTitle.trim()) return;
    const success = await mutate(async () => {
      const { data: inserted, error } = await supabase
        .from("project_nodes")
        .insert({
          project_id: projectId,
          title: nodeTitle.trim(),
          position: project.nodes.length,
          created_by: activeUserId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await safeActivity("project_node", inserted.id, "created", `added “${nodeTitle.trim()}” to project “${project.name}”.`);
    }, "Phase added");
    if (success) setPhaseProjectId(null);
  };

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setData((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);
    const dbPatch: Record<string, unknown> = {};
    if (patch.workspaceName !== undefined) dbPatch.name = patch.workspaceName;
    if (patch.timezone !== undefined) dbPatch.timezone = patch.timezone;
    if (patch.rolloverHour !== undefined) dbPatch.rollover_hour = patch.rolloverHour;
    if (patch.discreetMode !== undefined) dbPatch.discreet_mode = patch.discreetMode;
    if (patch.uiDensity !== undefined) dbPatch.ui_density = patch.uiDensity;
    if (patch.accentColor !== undefined) dbPatch.accent_color = patch.accentColor;

    await mutate(async () => {
      const { error } = await supabase.from("workspaces").update(dbPatch).eq("id", data.workspaceId);
      if (error) throw error;
    }, "Settings saved");
  };

  const makePartnerInvite = async () => {
    setSyncState("saving");
    try {
      const code = await createPartnerInvite(supabase, data.workspaceId);
      setInviteCode(code);
      setSyncState("saved");
      setToast("Partner invitation created");
      await refreshWorkspace(false);
    } catch (error) {
      setSyncState("error");
      setToast(errorMessage(error));
    }
  };

  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tbft-backup-${getCalendarDate(data.settings.timezone)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("Backup downloaded");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: "today", label: "Current Day", icon: "▤" },
    { id: "projects", label: "Projects", icon: "◇" },
    { id: "calendar", label: "Calendar", icon: "□" },
    { id: "activity", label: "Activity", icon: "↗" },
    { id: "archive", label: "Archive", icon: "⌑" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div className={`app-shell density-${data.settings.uiDensity}`} style={{ "--theme-accent": data.settings.accentColor } as React.CSSProperties}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">TB</div>
          <div>
            <span className="eyebrow">PRIVATE WORKSPACE</span>
            <h1>{title}</h1>
          </div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setSection(item.id);
                if (item.id === "today") setSelectedDate(boardDate);
                if (item.id === "projects") setSelectedProjectId(null);
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className={`demo-badge sync-${syncState}`} title={syncLabel(syncState)}>
          <span className="live-dot" /> {syncLabel(syncState)}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">SIGNED IN AS</span>
            <div className="user-switcher">
              <span className="user-chip active static-chip">
                <span className="avatar" style={{ "--accent": activeUser.accent } as React.CSSProperties}>
                  {activeUser.initials}
                </span>
                {activeUser.name}
              </span>
            </div>
          </div>
          <div className="topbar-right">
            <div className="clock-block">
              <strong>
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: data.settings.timezone,
                  hour: "numeric",
                  minute: "2-digit",
                }).format(now)}
              </strong>
              <span>{data.settings.timezone}</span>
            </div>
            <button
              className="primary-button compact"
              onClick={() => setTaskModal({ ownerId: activeUserId, date: section === "calendar" ? selectedDate : boardDate })}
              disabled={section === "calendar" && dateCompare(selectedDate, boardDate) < 0}
            >
              + New task
            </button>
          </div>
        </header>

        <div className="page-content">
          {section === "today" && (
            <TodayPage
              data={data}
              date={boardDate}
              now={now}
              activeUserId={activeUserId}
              onAdd={(ownerId) => setTaskModal({ ownerId, date: boardDate })}
              onComplete={toggleTaskCompletion}
              onDelete={deleteTask}
              onEdit={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onThread={setThreadTaskId}
              onOpenProject={(projectId) => { setSelectedProjectId(projectId); setSection("projects"); }}
            />
          )}

          {section === "projects" && (
            <ProjectsPage
              data={data}
              selectedProjectId={selectedProjectId}
              boardDate={boardDate}
              activeUserId={activeUserId}
              onSelectProject={setSelectedProjectId}
              onBack={() => setSelectedProjectId(null)}
              onCreateProject={() => setProjectModal({})}
              onAddNode={(project) => setPhaseProjectId(project.id)}
              onEditProject={(project) => setProjectModal({ project })}
              onArchiveProject={archiveProject}
              onOpenTask={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onCreateTask={(projectId, projectNodeId) => setTaskModal({ ownerId: activeUserId, date: boardDate, projectId, projectNodeId })}
              onCompleteTask={(task) => toggleTaskCompletion(task, task.originalDate)}
            />
          )}

          {section === "calendar" && (
            <CalendarPage
              data={data}
              now={now}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              activeUserId={activeUserId}
              onAdd={(ownerId) => setTaskModal({ ownerId, date: selectedDate })}
              onComplete={toggleTaskCompletion}
              onDelete={deleteTask}
              onEdit={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onThread={setThreadTaskId}
              onOpenProject={(projectId) => { setSelectedProjectId(projectId); setSection("projects"); }}
            />
          )}

          {section === "activity" && <ActivityPage data={data} />}

          {section === "archive" && (
            <ArchivePage
              data={data}
              activeUserId={activeUserId}
              onRestoreProject={restoreProject}
              onRestoreTask={restoreTask}
            />
          )}

          {section === "settings" && (
            <SettingsPage
              data={data}
              currentUser={activeUser}
              syncState={syncState}
              inviteCode={inviteCode}
              onUpdateSettings={updateSettings}
              onCreateInvite={makePartnerInvite}
              onExport={exportWorkspace}
              onSignOut={signOut}
            />
          )}
        </div>
      </main>

      {taskModal && (
        <TaskEditor
          data={data}
          activeUser={activeUser}
          task={taskModal.task}
          defaultOwnerId={taskModal.ownerId}
          defaultDate={taskModal.date}
          boardDate={boardDate}
          defaultProjectId={taskModal.projectId}
          defaultProjectNodeId={taskModal.projectNodeId}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
        />
      )}

      {threadTaskId && (
        <ThreadModal
          data={data}
          taskId={threadTaskId}
          activeUserId={activeUserId}
          onClose={() => setThreadTaskId(null)}
          onSend={addMessage}
        />
      )}

      {projectModal && (
        <ProjectEditor
          project={projectModal.project}
          onClose={() => setProjectModal(null)}
          onSave={saveProjectAction}
        />
      )}

      {phaseProjectId && (
        <PhaseEditor
          project={data.projects.find((project) => project.id === phaseProjectId)}
          onClose={() => setPhaseProjectId(null)}
          onSave={(nodeTitle) => addProjectNode(phaseProjectId, nodeTitle)}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          {...confirmDialog}
          onClose={() => setConfirmDialog(null)}
          onConfirm={() => {
            void confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ConfigurationScreen() {
  return (
    <main className="auth-shell">
      <section className="auth-card system-card">
        <div className="auth-brand"><span>TB</span><div><small>THE BEST FUCKING TEAM</small><strong>Connection required</strong></div></div>
        <h1>Supabase is not connected.</h1>
        <p>Add the project URL and publishable key to Netlify, then redeploy the site.</p>
        <div className="code-list">
          <code>NEXT_PUBLIC_SUPABASE_URL</code>
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        </div>
      </section>
    </main>
  );
}

function AuthScreen() {
  const supabase = getSupabaseClient();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (authError) throw authError;
        if (!data.session) setMessage("Check your inbox and confirm your email. Then return here to sign in.");
      } else {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (authError) throw authError;
        setMessage("A password-reset link has been sent to your email.");
      }
    } catch (authError) {
      setError(errorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span>TB</span><div><small>PRIVATE SHARED WORKSPACE</small><strong>The Best Fucking Team</strong></div></div>
        <div className="auth-copy">
          <span className="eyebrow">{mode === "signin" ? "WELCOME BACK" : mode === "signup" ? "CREATE YOUR ACCOUNT" : "ACCOUNT RECOVERY"}</span>
          <h1>{mode === "signin" ? "Open your day." : mode === "signup" ? "Start a calmer shared system." : "Reset your password."}</h1>
          <p>{mode === "signin" ? "Your tasks, projects, and notes are stored securely in your private Supabase workspace." : mode === "signup" ? "Create your own workspace or join your partner with an invitation code." : "We will email you a secure link to choose a new password."}</p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>Display name<input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" required /></label>
          )}
          <label>Email<input autoFocus={mode !== "signup"} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
          {mode !== "forgot" && (
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} placeholder="At least 8 characters" required /></label>
          )}
          {error && <p className="form-message error">{error}</p>}
          {message && <p className="form-message success">{message}</p>}
          <button className="primary-button auth-submit" disabled={busy || !email.trim() || (mode !== "forgot" && password.length < 8) || (mode === "signup" && !displayName.trim())}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        <div className="auth-links">
          {mode !== "signin" && <button type="button" onClick={() => { setMode("signin"); setError(null); setMessage(null); }}>Back to sign in</button>}
          {mode === "signin" && <><button type="button" onClick={() => setMode("signup")}>Create an account</button><button type="button" onClick={() => setMode("forgot")}>Forgot password?</button></>}
        </div>
      </section>
    </main>
  );
}

function PasswordRecoveryScreen({ onDone }: { onDone: () => void }) {
  const supabase = getSupabaseClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supabase) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) setError(updateError.message);
    else onDone();
  };

  return (
    <main className="auth-shell"><section className="auth-card compact-auth"><div className="auth-brand"><span>TB</span><div><small>ACCOUNT RECOVERY</small><strong>Choose a new password</strong></div></div><form className="auth-form" onSubmit={submit}><label>New password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>{error && <p className="form-message error">{error}</p>}<button className="primary-button auth-submit" disabled={busy || password.length < 8 || confirmPassword.length < 8}>{busy ? "Saving…" : "Save new password"}</button></form></section></main>
  );
}

function DatabaseSetupScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card system-card">
        <div className="auth-brand"><span>TB</span><div><small>ONE-TIME DATABASE SETUP</small><strong>Supabase is connected</strong></div></div>
        <h1>The TBFT tables are not installed yet.</h1>
        <p>Open Supabase → SQL Editor, paste the complete contents of <code>supabase/setup-v0.5.sql</code>, and run it once.</p>
        <button className="primary-button auth-submit" onClick={onRetry}>I ran the SQL — retry</button>
      </section>
    </main>
  );
}

function OnboardingScreen({ user, onReady }: { user: User; onReady: () => void }) {
  const supabase = getSupabaseClient();
  const suggestedName = (user.user_metadata?.display_name as string | undefined) || user.email?.split("@")[0] || "User";
  const [displayName, setDisplayName] = useState(suggestedName);
  const [workspaceName, setWorkspaceName] = useState("The Best Fucking Team");
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType>("couple");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supabase) return null;

  const createNew = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(supabase, { name: workspaceName, type: workspaceType, timezone: DEFAULT_TIMEZONE, displayName });
      onReady();
    } catch (setupError) {
      setError(errorMessage(setupError));
    } finally {
      setBusy(false);
    }
  };

  const joinExisting = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptPartnerInvite(supabase, inviteCode);
      onReady();
    } catch (setupError) {
      setError(errorMessage(setupError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="auth-brand"><span>TB</span><div><small>FIRST-TIME SETUP</small><strong>Build your workspace</strong></div></div>
        <div className="onboarding-grid">
          <form onSubmit={createNew} className="onboarding-option">
            <span className="eyebrow">CREATE A WORKSPACE</span>
            <h1>Start clean.</h1>
            <p>Create a solo notebook or a shared couple workspace. You can invite your partner afterward.</p>
            <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
            <label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required /></label>
            <div className="workspace-type-picker">
              <button type="button" className={workspaceType === "solo" ? "active" : ""} onClick={() => setWorkspaceType("solo")}><strong>Solo</strong><span>One focused dashboard</span></button>
              <button type="button" className={workspaceType === "couple" ? "active" : ""} onClick={() => setWorkspaceType("couple")}><strong>Couple</strong><span>Invite one partner</span></button>
            </div>
            <button className="primary-button auth-submit" disabled={busy || !displayName.trim() || !workspaceName.trim()}>{busy ? "Creating…" : "Create workspace"}</button>
          </form>
          <form onSubmit={joinExisting} className="onboarding-option join-option">
            <span className="eyebrow">JOIN YOUR PARTNER</span>
            <h2>Already invited?</h2>
            <p>Paste the private invitation code your partner created from Settings.</p>
            <label>Invitation code<input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="XXXXXXXXXX" maxLength={10} required /></label>
            <button className="secondary-button auth-submit" disabled={busy || inviteCode.trim().length < 8}>{busy ? "Joining…" : "Join workspace"}</button>
          </form>
        </div>
        {error && <p className="form-message error onboarding-error">{error}</p>}
      </section>
    </main>
  );
}

function DayCountdown({ timeZone, rolloverHour }: { timeZone: string; rolloverHour: number }) {
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = getZonedParts(clock, timeZone);
  const secondsNow = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const startSeconds = rolloverHour * 3600;
  const inGrace = secondsNow < startSeconds;
  const totalActiveSeconds = Math.max(1, (24 - rolloverHour) * 3600);
  const progress = inGrace ? 100 : Math.min(100, Math.max(0, ((secondsNow - startSeconds) / totalActiveSeconds) * 100));
  const remainingSeconds = inGrace ? startSeconds - secondsNow : 24 * 3600 - secondsNow;
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className={inGrace ? "day-countdown grace" : "day-countdown"}>
      <div className="day-countdown-copy"><span>{inGrace ? "GRACE PERIOD LEFT" : "DAY REMAINING"}</span><strong>{time}</strong></div>
      <div className="day-time-track" role="progressbar" aria-label="Operational day progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function TodayPage({
  data,
  date,
  now,
  activeUserId,
  onAdd,
  onComplete,
  onDelete,
  onEdit,
  onThread,
  onOpenProject,
}: {
  data: AppData;
  date: string;
  now: Date;
  activeUserId: string;
  onAdd: (ownerId: string) => void;
  onComplete: (task: Task, viewingDate: string) => void;
  onDelete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onThread: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const tasks = data.tasks.filter((task) => taskAppearsOnDate(task, date, data, now));
  const completed = tasks.filter((task) => task.completedAt).length;
  const grace = isGracePeriod(data.settings.timezone, data.settings.rolloverHour, now);
  const calendarDate = getCalendarDate(data.settings.timezone, now);
  const taskProgress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  return (
    <>
      <div className="dashboard-status-row">
        <DayCountdown timeZone={data.settings.timezone} rolloverHour={data.settings.rolloverHour} />
        <div className="team-progress-card">
          <span>TEAM PROGRESS</span>
          <strong>{taskProgress}%</strong>
          <div className="mini-progress"><i style={{ width: `${taskProgress}%` }} /></div>
        </div>
      </div>
      <PageHeading
        eyebrow={grace && calendarDate !== date ? "MIDNIGHT GRACE PERIOD" : "TODAY’S SHARED NOTEBOOK"}
        title={formatLongDate(date)}
        description={
          grace && calendarDate !== date
            ? `Yesterday’s board remains active until ${data.settings.rolloverHour}:00. Unfinished tasks are now red.`
            : "One page, two columns, and a clear view of what the team is moving forward."
        }
      />
      <TaskBoard
        data={data}
        date={date}
        now={now}
        activeUserId={activeUserId}
        allowAdd
        onAdd={onAdd}
        onComplete={onComplete}
        onDelete={onDelete}
        onEdit={onEdit}
        onThread={onThread}
        onOpenProject={onOpenProject}
      />
    </>
  );
}

function TaskBoard({
  data,
  date,
  now,
  activeUserId,
  allowAdd,
  onAdd,
  onComplete,
  onDelete,
  onEdit,
  onThread,
  onOpenProject,
}: {
  data: AppData;
  date: string;
  now: Date;
  activeUserId: string;
  allowAdd: boolean;
  onAdd: (ownerId: string) => void;
  onComplete: (task: Task, viewingDate: string) => void;
  onDelete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onThread: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <div className="split-board">
      {data.users.map((user) => {
        const tasks = data.tasks
          .filter((task) => task.ownerId === user.id && taskAppearsOnDate(task, date, data, now))
          .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || b.priority.localeCompare(a.priority));
        const completed = tasks.filter((task) => task.completedAt).length;

        return (
          <section className="notepad-column" key={user.id} style={{ "--partner-accent": user.accent } as React.CSSProperties}>
            <div className="column-header">
              <div className="partner-title">
                <span className="avatar large" style={{ "--accent": user.accent } as React.CSSProperties}>{user.initials}</span>
                <div>
                  <span>{user.id === activeUserId ? "YOUR COLUMN" : "PARTNER COLUMN"}</span>
                  <h3>{user.name}</h3>
                </div>
              </div>
              <div className="column-stat">
                <strong>{completed}/{tasks.length}</strong>
                <span>done</span>
              </div>
            </div>

            {allowAdd && (
              <button className="quick-add" onClick={() => onAdd(user.id)}>
                <span>+</span> Add a task for {user.name}
              </button>
            )}

            <div className="task-list">
              {tasks.length === 0 ? (
                <div className="empty-state">
                  <div>✓</div>
                  <strong>Clear page</strong>
                  <span>Nothing is scheduled in this column.</span>
                </div>
              ) : (
                tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    viewingDate={date}
                    data={data}
                    now={now}
                    activeUserId={activeUserId}
                    onComplete={() => onComplete(task, date)}
                    onDelete={() => onDelete(task)}
                    onEdit={() => onEdit(task)}
                    onThread={() => onThread(task.id)}
                    onOpenProject={onOpenProject}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  viewingDate,
  data,
  now,
  activeUserId,
  onComplete,
  onDelete,
  onEdit,
  onThread,
  onOpenProject,
}: {
  task: Task;
  viewingDate: string;
  data: AppData;
  now: Date;
  activeUserId: string;
  onComplete: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onThread: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const state = getTaskState(task, viewingDate, data, now);
  const owner = userById(data, task.ownerId);
  const creator = userById(data, task.creatorId);
  const project = data.projects.find((item) => !item.deletedAt && item.id === task.projectId);
  const node = project?.nodes.find((item) => item.id === task.projectNodeId);
  const messages = data.messages.filter((message) => message.taskId === task.id).length;
  const isOwner = task.ownerId === activeUserId;
  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const canToggleCompletion = isOwner && (Boolean(task.completedAt) || dateCompare(viewingDate, boardDate) <= 0);
  const carriedDays = Math.max(0, daysBetween(task.originalDate, viewingDate));

  return (
    <article className={`task-card state-${state}`}>
      <div className="task-card-top">
        <button
          className="complete-control"
          onClick={onComplete}
          disabled={!canToggleCompletion}
          aria-label={task.completedAt ? "Mark task incomplete" : "Mark task complete"}
          title={
            !isOwner
              ? `Only ${owner.name} can change completion`
              : task.completedAt
                ? "Mark incomplete"
                : state === "future"
                  ? "Cannot complete before the date"
                  : "Mark complete"
          }
        >
          {task.completedAt ? "✓" : ""}
        </button>
        <div className="task-copy">
          <div className="task-labels">
            <span className={`status-pill ${state}`}>{stateLabel(state)}</span>
            {task.priority === "high" && <span className="priority-pill">High priority</span>}
          </div>
          <h4>{task.title}</h4>
          {task.description && <p>{task.description}</p>}
        </div>
        <div className="task-menu">
          <button onClick={onEdit} title="Edit task" aria-label="Edit task">Edit</button>
          <button onClick={onDelete} disabled={!isOwner} title={isOwner ? "Move task to archive" : "Only the owner can archive"} aria-label="Move task to archive">Archive</button>
        </div>
      </div>

      {state === "carried" && (
        <div className="carry-note">↳ Carried from {formatShortDate(task.originalDate)} · {carriedDays} day{carriedDays === 1 ? "" : "s"}</div>
      )}

      <div className="task-meta">
        {task.deadline && <span>{task.deadline}</span>}
        {project && <button type="button" className="task-project-link" onClick={() => onOpenProject(project.id)}>{project.name}{node ? ` / ${node.title}` : ""}</button>}
        {task.creatorId !== task.ownerId && <span>Added by {creator.name}</span>}
        {task.completedAt && <span>Completed {formatClock(task.completedAt)}</span>}
      </div>

      <button className="thread-button" onClick={onThread}>
        <span>Notes</span>
        <strong>{messages}</strong>
      </button>
    </article>
  );
}

type ProjectWorkspaceTab = "overview" | "tasks" | "files" | "activity";
type ProjectHealth = "attention" | "on-track" | "planning" | "complete";

type ProjectMetrics = {
  tasks: Task[];
  openTasks: Task[];
  overdueTasks: Task[];
  completed: number;
  progress: number;
  health: ProjectHealth;
  nextTask?: Task;
};

function projectMetrics(project: Project, data: AppData, boardDate: string): ProjectMetrics {
  const tasks = data.tasks.filter((task) => !task.deletedAt && task.projectId === project.id);
  const openTasks = tasks
    .filter((task) => !task.completedAt)
    .sort((a, b) => dateCompare(a.originalDate, b.originalDate)
      || (a.deadline ?? "99:99").localeCompare(b.deadline ?? "99:99")
      || ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]));
  const overdueTasks = openTasks.filter((task) => dateCompare(task.originalDate, boardDate) < 0);
  const completed = tasks.length - openTasks.length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const missedTarget = Boolean(project.targetDate && dateCompare(project.targetDate, boardDate) < 0 && openTasks.length);
  const health: ProjectHealth = tasks.length > 0 && completed === tasks.length
    ? "complete"
    : overdueTasks.length > 0 || missedTarget
      ? "attention"
      : tasks.length === 0
        ? "planning"
        : "on-track";
  return { tasks, openTasks, overdueTasks, completed, progress, health, nextTask: overdueTasks[0] ?? openTasks[0] };
}

function projectHealthLabel(health: ProjectHealth): string {
  return {
    attention: "Needs attention",
    "on-track": "On track",
    planning: "Planning",
    complete: "Complete",
  }[health];
}

function projectTaskStatus(task: Task, boardDate: string): string {
  if (task.completedAt) return "Complete";
  if (dateCompare(task.originalDate, boardDate) < 0) return "Overdue";
  if (dateCompare(task.originalDate, boardDate) > 0) return "Scheduled";
  return "Today";
}

function ProjectsPage({
  data,
  selectedProjectId,
  boardDate,
  activeUserId,
  onSelectProject,
  onBack,
  onCreateProject,
  onAddNode,
  onEditProject,
  onArchiveProject,
  onOpenTask,
  onCreateTask,
  onCompleteTask,
}: {
  data: AppData;
  selectedProjectId: string | null;
  boardDate: string;
  activeUserId: string;
  onSelectProject: (id: string) => void;
  onBack: () => void;
  onCreateProject: () => void;
  onAddNode: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onArchiveProject: (project: Project) => void;
  onOpenTask: (task: Task) => void;
  onCreateTask: (projectId: string, projectNodeId?: string) => void;
  onCompleteTask: (task: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ProjectHealth>("all");
  const activeProjects = data.projects.filter((item) => !item.deletedAt);
  const selectedProject = activeProjects.find((item) => item.id === selectedProjectId);

  if (selectedProject) {
    return (
      <ProjectWorkspace
        key={selectedProject.id}
        data={data}
        project={selectedProject}
        boardDate={boardDate}
        activeUserId={activeUserId}
        onBack={onBack}
        onAddNode={() => onAddNode(selectedProject)}
        onEdit={() => onEditProject(selectedProject)}
        onArchive={() => onArchiveProject(selectedProject)}
        onOpenTask={onOpenTask}
        onCreateTask={(nodeId) => onCreateTask(selectedProject.id, nodeId)}
        onCompleteTask={onCompleteTask}
      />
    );
  }

  const summaries = activeProjects.map((project) => ({ project, metrics: projectMetrics(project, data, boardDate) }));
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const dueThisWeek = data.tasks.filter((task) => !task.deletedAt
    && !task.completedAt
    && task.projectId && activeProjectIds.has(task.projectId)
    && dateCompare(task.originalDate, boardDate) >= 0
    && dateCompare(task.originalDate, addDays(boardDate, 6)) <= 0).length;
  const visibleProjects = summaries
    .filter(({ project, metrics }) => {
      const matchesQuery = !query.trim()
        || project.name.toLowerCase().includes(query.trim().toLowerCase())
        || project.description.toLowerCase().includes(query.trim().toLowerCase());
      return matchesQuery && (filter === "all" || metrics.health === filter);
    })
    .sort((a, b) => Number(b.metrics.health === "attention") - Number(a.metrics.health === "attention")
      || Number(a.metrics.health === "complete") - Number(b.metrics.health === "complete")
      || (a.project.targetDate ?? "9999-12-31").localeCompare(b.project.targetDate ?? "9999-12-31")
      || a.project.name.localeCompare(b.project.name));

  return (
    <>
      <PageHeading
        eyebrow="PROJECT PORTFOLIO"
        title="Projects"
        description="Plan the bigger work here. Today remains where you execute it."
        action={<button className="primary-button" onClick={onCreateProject}>+ New project</button>}
      />

      <section className="project-portfolio">
        <div className="project-summary-grid">
          <div><span>ACTIVE PROJECTS</span><strong>{summaries.filter(({ metrics }) => metrics.health !== "complete").length}</strong></div>
          <div><span>NEEDS ATTENTION</span><strong>{summaries.filter(({ metrics }) => metrics.health === "attention").length}</strong></div>
          <div><span>DUE THIS WEEK</span><strong>{dueThisWeek}</strong></div>
        </div>

        <div className="project-portfolio-toolbar">
          <label>
            <span className="sr-only">Search projects</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" />
          </label>
          <label>
            <span className="sr-only">Filter projects</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as "all" | ProjectHealth)}>
              <option value="all">All projects</option>
              <option value="attention">Needs attention</option>
              <option value="on-track">On track</option>
              <option value="planning">Planning</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        </div>

        <div className="project-portfolio-list">
          <div className="project-portfolio-columns" aria-hidden="true">
            <span>Project</span><span>Next action</span><span>Progress</span><span>Target</span><span>Status</span>
          </div>
          {visibleProjects.map(({ project, metrics }) => (
            <button key={project.id} type="button" className="project-portfolio-row" onClick={() => onSelectProject(project.id)}>
              <span className="project-portfolio-name">
                <strong>{project.name}</strong>
                <small>{project.description || `${metrics.tasks.length} connected task${metrics.tasks.length === 1 ? "" : "s"}`}</small>
              </span>
              <span className="project-next-action">
                <small>NEXT ACTION</small>
                <strong>{metrics.nextTask?.title ?? (metrics.health === "complete" ? "Project complete" : "Add the first task")}</strong>
              </span>
              <span className="project-row-progress">
                <strong>{metrics.progress}%</strong>
                <i><b style={{ width: `${metrics.progress}%` }} /></i>
                <small>{metrics.completed}/{metrics.tasks.length} done</small>
              </span>
              <span className="project-row-target">{project.targetDate ? formatShortDate(project.targetDate) : "No target"}</span>
              <span className={`project-health ${metrics.health}`}>{projectHealthLabel(metrics.health)}</span>
            </button>
          ))}
          {!visibleProjects.length && (
            <div className="project-portfolio-empty">
              <strong>{activeProjects.length ? "No projects match this view." : "No projects yet."}</strong>
              <span>{activeProjects.length ? "Clear the search or choose another filter." : "Create a project to connect phases, tasks and files."}</span>
              {!activeProjects.length && <button className="primary-button compact" onClick={onCreateProject}>Create first project</button>}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ProjectWorkspace({
  data,
  project,
  boardDate,
  activeUserId,
  onBack,
  onAddNode,
  onEdit,
  onArchive,
  onOpenTask,
  onCreateTask,
  onCompleteTask,
}: {
  data: AppData;
  project: Project;
  boardDate: string;
  activeUserId: string;
  onBack: () => void;
  onAddNode: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onOpenTask: (task: Task) => void;
  onCreateTask: (nodeId?: string) => void;
  onCompleteTask: (task: Task) => void;
}) {
  const [tab, setTab] = useState<ProjectWorkspaceTab>("overview");
  const metrics = projectMetrics(project, data, boardDate);
  const unassignedTasks = metrics.tasks.filter((task) => !task.projectNodeId);
  const attentionTasks = metrics.overdueTasks.length
    ? metrics.overdueTasks.slice(0, 4)
    : metrics.openTasks.filter((task) => task.priority === "high").slice(0, 4);

  const taskRows = (tasks: Task[]) => tasks
    .slice()
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt))
      || dateCompare(a.originalDate, b.originalDate)
      || (a.deadline ?? "99:99").localeCompare(b.deadline ?? "99:99"))
    .map((task) => {
      const owner = userById(data, task.ownerId);
      const status = projectTaskStatus(task, boardDate);
      const canComplete = task.ownerId === activeUserId
        && (Boolean(task.completedAt) || dateCompare(task.originalDate, boardDate) <= 0);
      return (
        <div className={`project-task-row state-${status.toLowerCase()}`} key={task.id}>
          <button
            type="button"
            className="project-task-check"
            onClick={() => onCompleteTask(task)}
            disabled={!canComplete}
            aria-label={task.completedAt ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
            title={!canComplete && task.ownerId !== activeUserId ? `Only ${owner.name} can change completion` : undefined}
          >
            {task.completedAt ? "✓" : ""}
          </button>
          <button type="button" className="project-task-title" onClick={() => onOpenTask(task)}>
            <strong>{task.title}</strong>
            {task.description && <small>{task.description}</small>}
          </button>
          <span className="project-task-owner"><i style={{ "--accent": owner.accent } as React.CSSProperties}>{owner.initials}</i>{owner.name}</span>
          <span className="project-task-date">{formatShortDate(task.originalDate)}{task.deadline ? ` · ${task.deadline}` : ""}</span>
          <span className={`project-task-status ${status.toLowerCase()}`}>{status}</span>
        </div>
      );
    });

  const phaseBlock = (id: string, title: string, tasks: Task[], index?: number) => {
    const completed = tasks.filter((task) => task.completedAt).length;
    const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
    return (
      <section className="project-phase-block" key={id}>
        <div className="project-phase-heading">
          <div>
            {index !== undefined && <span>{String(index + 1).padStart(2, "0")}</span>}
            <strong>{title}</strong>
          </div>
          <div><span>{completed}/{tasks.length} complete</span><strong>{progress}%</strong></div>
        </div>
        <div className="project-phase-progress"><i style={{ width: `${progress}%` }} /></div>
        <div className="project-task-list">
          {tasks.length ? taskRows(tasks) : <div className="project-phase-empty">No tasks in this phase yet.</div>}
        </div>
        <button type="button" className="project-phase-add" onClick={() => onCreateTask(id === "unassigned" ? undefined : id)}>+ Add task here</button>
      </section>
    );
  };

  return (
    <>
      <button type="button" className="project-workspace-back" onClick={onBack}>← All projects</button>
      <section
        className="project-workspace project-workspace-redesign"
        data-project-id={project.id}
        data-workspace-id={data.workspaceId}
        data-project-name={project.name}
        data-project-tab={tab}
      >
        <div className="project-hero">
          <div className="project-identity">
            <span className="eyebrow">{project.ownerId === "joint" ? "JOINT PROJECT" : "PROJECT"}</span>
            <h3>{project.name}</h3>
            <p>{project.description || "No description yet."}</p>
            <div className="project-hero-meta">
              <span className={`project-health ${metrics.health}`}>{projectHealthLabel(metrics.health)}</span>
              <span>{project.targetDate ? `Target · ${formatShortDate(project.targetDate)}` : "No target date"}</span>
              <span>{metrics.openTasks.length} open task{metrics.openTasks.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="project-hero-side">
            <div className="project-score">
              <strong>{metrics.progress}%</strong>
              <span>{metrics.completed} of {metrics.tasks.length} tasks completed</span>
            </div>
            <button type="button" className="secondary-button compact" onClick={onEdit}>Edit</button>
            <button type="button" className="primary-button compact" onClick={() => onCreateTask()}>+ Add task</button>
            <details className="project-actions-menu">
              <summary aria-label="More project actions" title="More project actions">•••</summary>
              <div><button type="button" className="archive-action" onClick={onArchive}>Move to archive</button></div>
            </details>
          </div>
        </div>
        <div className="project-overall-progress"><i style={{ width: `${metrics.progress}%` }} /></div>

        <nav className="project-workspace-tabs" aria-label={`${project.name} workspace`}>
          {(["overview", "tasks", "files", "activity"] as ProjectWorkspaceTab[]).map((item) => (
            <button
              key={item}
              type="button"
              className={tab === item ? "active" : ""}
              aria-current={tab === item ? "page" : undefined}
              onClick={() => {
                setTab(item);
                window.dispatchEvent(new CustomEvent("tbft:project-workspace-tab", {
                  detail: { projectId: project.id, tab: item },
                }));
              }}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        <div className="project-tab-panel" hidden={tab !== "overview"}>
          <div className="project-overview-grid">
            <section className="project-overview-section">
              <div className="project-section-heading">
                <div><span className="eyebrow">MOVE FORWARD</span><h4>Next actions</h4></div>
                <button type="button" onClick={() => setTab("tasks")}>View all tasks</button>
              </div>
              {metrics.openTasks.length ? metrics.openTasks.slice(0, 4).map((task) => (
                <button type="button" className="project-next-row" key={task.id} onClick={() => onOpenTask(task)}>
                  <span><strong>{task.title}</strong><small>{project.nodes.find((node) => node.id === task.projectNodeId)?.title ?? "No phase"} · {userById(data, task.ownerId).name}</small></span>
                  <span>{projectTaskStatus(task, boardDate) === "Overdue" ? "Overdue" : formatShortDate(task.originalDate)} →</span>
                </button>
              )) : <div className="project-section-empty"><strong>No open tasks.</strong><span>{metrics.tasks.length ? "Everything connected to this project is complete." : "Add a task to define the next action."}</span></div>}
            </section>

            <section className="project-overview-section">
              <div className="project-section-heading"><div><span className="eyebrow">WATCH LIST</span><h4>Needs attention</h4></div></div>
              {attentionTasks.length ? attentionTasks.map((task) => (
                <button type="button" className="project-attention-row" key={task.id} onClick={() => onOpenTask(task)}>
                  <span><strong>{task.title}</strong><small>{userById(data, task.ownerId).name} · {formatShortDate(task.originalDate)}</small></span>
                  <span>{metrics.overdueTasks.includes(task) ? "Overdue" : "High priority"}</span>
                </button>
              )) : <div className="project-section-empty"><strong>Nothing is blocked.</strong><span>No overdue or high-priority tasks need attention.</span></div>}
            </section>
          </div>

          <section className="project-overview-section project-phase-summary">
            <div className="project-section-heading">
              <div><span className="eyebrow">PROJECT STRUCTURE</span><h4>Progress by phase</h4></div>
              <button type="button" onClick={onAddNode}>+ Add phase</button>
            </div>
            {project.nodes.length ? project.nodes.map((node, index) => {
              const nodeTasks = metrics.tasks.filter((task) => task.projectNodeId === node.id);
              const nodeCompleted = nodeTasks.filter((task) => task.completedAt).length;
              const nodeProgress = nodeTasks.length ? Math.round((nodeCompleted / nodeTasks.length) * 100) : 0;
              return (
                <button type="button" className="project-phase-summary-row" key={node.id} onClick={() => setTab("tasks")}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{node.title}</strong>
                  <i><b style={{ width: `${nodeProgress}%` }} /></i>
                  <small>{nodeCompleted}/{nodeTasks.length} · {nodeProgress}%</small>
                </button>
              );
            }) : <ProjectEmpty onAdd={onAddNode} />}
          </section>
        </div>

        <div className="project-tab-panel" hidden={tab !== "tasks"}>
          <div className="project-tasks-toolbar">
            <div><span className="eyebrow">PROJECT PLAN</span><h4>Tasks by phase</h4><p>Plan the project here; scheduled work still appears on Today.</p></div>
            <div><button type="button" className="secondary-button compact" onClick={onAddNode}>+ Add phase</button><button type="button" className="primary-button compact" onClick={() => onCreateTask()}>+ Add task</button></div>
          </div>
          <div className="project-phase-list">
            {project.nodes.map((node, index) => phaseBlock(node.id, node.title, metrics.tasks.filter((task) => task.projectNodeId === node.id), index))}
            {unassignedTasks.length > 0 && phaseBlock("unassigned", "No phase", unassignedTasks)}
            {!project.nodes.length && !unassignedTasks.length && <ProjectEmpty onAdd={onAddNode} />}
          </div>
        </div>

        <div className="project-tab-panel" hidden={tab !== "files"}><div className="project-files-mount" /></div>
        <div className="project-tab-panel" hidden={tab !== "activity"}><div className="project-activity-mount" /></div>
      </section>
    </>
  );
}

function ProjectEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="project-empty">
      <strong>No project phases yet</strong>
      <span>Add a phase to turn this project into a clear plan.</span>
      <button className="secondary-button compact" onClick={onAdd}>Add first phase</button>
    </div>
  );
}

function CalendarPage({
  data,
  now,
  selectedDate,
  onSelectDate,
  activeUserId,
  onAdd,
  onComplete,
  onDelete,
  onEdit,
  onThread,
  onOpenProject,
}: {
  data: AppData;
  now: Date;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  activeUserId: string;
  onAdd: (ownerId: string) => void;
  onComplete: (task: Task, viewingDate: string) => void;
  onDelete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onThread: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [year, month] = selectedDate.split("-").map(Number);
  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const startWeekday = new Date(`${monthStart}T00:00:00Z`).getUTCDay();
  const gridStart = addDays(monthStart, -startWeekday);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));

  const moveMonth = (amount: number) => {
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    onSelectDate(date.toISOString().slice(0, 10));
  };

  return (
    <>
      <PageHeading
        eyebrow="DATE BROWSER"
        title="Calendar"
        description="Open any daily board. Past dates are protected; future dates can receive scheduled tasks."
      />
      <section className="calendar-panel">
        <div className="calendar-header">
          <button onClick={() => moveMonth(-1)}>←</button>
          <h3>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)))}</h3>
          <button onClick={() => moveMonth(1)}>→</button>
        </div>
        <div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {days.map((date) => {
            const dateMonth = Number(date.slice(5, 7));
            const tasks = data.tasks.filter((task) => taskAppearsOnDate(task, date, data, now));
            const completed = tasks.filter((task) => task.completedAt).length;
            return (
              <button
                key={date}
                className={`${date === selectedDate ? "selected" : ""} ${dateMonth !== month ? "muted" : ""} ${date === boardDate ? "today" : ""}`}
                onClick={() => onSelectDate(date)}
              >
                <strong>{Number(date.slice(8, 10))}</strong>
                {tasks.length > 0 && (
                  <span className="calendar-counts"><i>{completed}</i><b>{tasks.length - completed}</b></span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <div className="selected-day-header">
        <div>
          <span className="eyebrow">OPEN DAILY BOARD</span>
          <h3>{formatLongDate(selectedDate)}</h3>
        </div>
        <span className={`date-rule ${dateCompare(selectedDate, boardDate) < 0 ? "past" : dateCompare(selectedDate, boardDate) > 0 ? "future" : "current"}`}>
          {dateCompare(selectedDate, boardDate) < 0 ? "Past: no new entries" : dateCompare(selectedDate, boardDate) > 0 ? "Future: scheduling enabled" : "Current operational day"}
        </span>
      </div>

      <TaskBoard
        data={data}
        date={selectedDate}
        now={now}
        activeUserId={activeUserId}
        allowAdd={dateCompare(selectedDate, boardDate) >= 0}
        onAdd={onAdd}
        onComplete={onComplete}
        onDelete={onDelete}
        onEdit={onEdit}
        onThread={onThread}
        onOpenProject={onOpenProject}
      />
    </>
  );
}

function ArchivePage({
  data,
  activeUserId,
  onRestoreProject,
  onRestoreTask,
}: {
  data: AppData;
  activeUserId: string;
  onRestoreProject: (project: Project) => void | Promise<void>;
  onRestoreTask: (task: Task) => void | Promise<void>;
}) {
  const archivedProjects = data.projects
    .filter((project) => project.deletedAt)
    .sort((a, b) => new Date(b.deletedAt ?? 0).getTime() - new Date(a.deletedAt ?? 0).getTime());
  const archivedTasks = data.tasks
    .filter((task) => task.deletedAt)
    .sort((a, b) => new Date(b.deletedAt ?? 0).getTime() - new Date(a.deletedAt ?? 0).getTime());
  const archivedAt = (value?: string) => value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Recently archived";

  return (
    <>
      <PageHeading
        eyebrow="RECOVERABLE ITEMS"
        title="Archive"
        description="Deleted tasks and projects stay here until you restore them. Nothing in this archive is permanently removed."
      />

      <div className="archive-grid">
        <section className="archive-panel">
          <div className="archive-panel-heading">
            <div><span className="eyebrow">PROJECTS</span><h3>Archived projects</h3></div>
            <strong>{archivedProjects.length}</strong>
          </div>
          <div className="archive-list">
            {archivedProjects.length ? archivedProjects.map((project) => {
              const connectedTasks = data.tasks.filter((task) => task.projectId === project.id).length;
              return (
                <article className="archive-item" key={project.id}>
                  <div className="archive-item-icon">◇</div>
                  <div className="archive-item-copy">
                    <strong>{project.name}</strong>
                    <p>{project.description || "No description"}</p>
                    <span>{connectedTasks} connected task{connectedTasks === 1 ? "" : "s"} · Archived {archivedAt(project.deletedAt)}</span>
                  </div>
                  <button className="secondary-button compact" onClick={() => onRestoreProject(project)}>Restore</button>
                </article>
              );
            }) : <div className="archive-empty"><strong>No archived projects</strong><span>Projects moved to the archive will appear here.</span></div>}
          </div>
        </section>

        <section className="archive-panel">
          <div className="archive-panel-heading">
            <div><span className="eyebrow">TASKS</span><h3>Archived tasks</h3></div>
            <strong>{archivedTasks.length}</strong>
          </div>
          <div className="archive-list">
            {archivedTasks.length ? archivedTasks.map((task) => {
              const owner = userById(data, task.ownerId);
              const project = data.projects.find((item) => item.id === task.projectId);
              const canRestore = task.ownerId === activeUserId;
              return (
                <article className="archive-item" key={task.id}>
                  <div className="archive-item-icon">✓</div>
                  <div className="archive-item-copy">
                    <strong>{task.title}</strong>
                    <p>{owner.name} · {formatShortDate(task.originalDate)}{project ? ` · ${project.name}` : ""}</p>
                    <span>Archived {archivedAt(task.deletedAt)}</span>
                  </div>
                  <button
                    className="secondary-button compact"
                    disabled={!canRestore}
                    title={canRestore ? "Restore task" : "Only the task owner can restore it"}
                    onClick={() => onRestoreTask(task)}
                  >
                    Restore
                  </button>
                </article>
              );
            }) : <div className="archive-empty"><strong>No archived tasks</strong><span>Tasks moved to the archive will appear here.</span></div>}
          </div>
        </section>
      </div>
    </>
  );
}

function ActivityPage({ data }: { data: AppData }) {
  return (
    <>
      <PageHeading
        eyebrow="SHARED ACCOUNTABILITY"
        title="Activity"
        description="A human-readable record of what changed, who changed it, and when."
      />
      <section className="activity-panel">
        {data.activities.length ? data.activities.map((activity) => {
          const actor = userById(data, activity.actorId);
          return (
            <article key={activity.id}>
              <span className="avatar" style={{ "--accent": actor.accent } as React.CSSProperties}>{actor.initials}</span>
              <div>
                <p><strong>{actor.name}</strong> {activity.text}</p>
                <span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.createdAt))}</span>
              </div>
            </article>
          );
        }) : <div className="empty-state">No activity yet.</div>}
      </section>
    </>
  );
}

function SettingsPage({
  data,
  currentUser,
  syncState,
  inviteCode,
  onUpdateSettings,
  onCreateInvite,
  onExport,
  onSignOut,
}: {
  data: AppData;
  currentUser: UserProfile;
  syncState: SyncState;
  inviteCode: string | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => void | Promise<void>;
  onCreateInvite: () => void | Promise<void>;
  onExport: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const [workspaceName, setWorkspaceName] = useState(data.settings.workspaceName);

  useEffect(() => setWorkspaceName(data.settings.workspaceName), [data.settings.workspaceName]);

  const copyInvite = async () => {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
  };

  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE CONTROL"
        title="Settings"
        description="Appearance, daily rollover, partner access, and cloud persistence for this workspace."
      />
      <section className="settings-grid">
        <div className="settings-card">
          <span className="eyebrow">IDENTITY</span>
          <label>
            Workspace name
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              onBlur={() => {
                const clean = workspaceName.trim();
                if (clean && clean !== data.settings.workspaceName) void onUpdateSettings({ workspaceName: clean });
                else setWorkspaceName(data.settings.workspaceName);
              }}
            />
          </label>
          <label className="toggle-row">
            <div><strong>Discreet mode</strong><span>Use “TBFT” in the interface.</span></div>
            <input
              type="checkbox"
              checked={data.settings.discreetMode}
              onChange={(event) => void onUpdateSettings({ discreetMode: event.target.checked })}
            />
          </label>
        </div>
        <div className="settings-card">
          <span className="eyebrow">APPEARANCE</span>
          <label>
            Interface size
            <div className="density-selector" role="group" aria-label="Interface size">
              {(["compact", "comfortable", "large"] as const).map((density) => (
                <button
                  key={density}
                  type="button"
                  className={data.settings.uiDensity === density ? "active" : ""}
                  onClick={() => void onUpdateSettings({ uiDensity: density })}
                >
                  {density === "compact" ? "Small" : density === "comfortable" ? "Medium" : "Large"}
                </button>
              ))}
            </div>
          </label>
          <label>
            Accent color
            <div className="accent-selector" role="group" aria-label="Accent color">
              {[
                { name: "Mustard", value: "#a38b57" },
                { name: "Muted green", value: "#74836b" },
                { name: "Mellow blue", value: "#7c9caa" },
                { name: "Clay", value: "#a47761" },
                { name: "Soft mauve", value: "#88758d" },
                { name: "Blue green", value: "#6f8585" },
              ].map(({ name, value }) => (
                <button
                  key={value}
                  type="button"
                  className={data.settings.accentColor === value ? "active" : ""}
                  style={{ "--swatch": value } as React.CSSProperties}
                  aria-label={`Use ${name} theme`}
                  title={name}
                  onClick={() => void onUpdateSettings({ accentColor: value })}
                />
              ))}
            </div>
          </label>
          <p className="settings-note">Size and color are stored in the shared workspace and follow you across devices.</p>
        </div>
        <div className="settings-card">
          <span className="eyebrow">DAILY SYSTEM</span>
          <label>
            Workspace timezone
            <select
              value={data.settings.timezone}
              onChange={(event) => void onUpdateSettings({ timezone: event.target.value })}
            >
              <option value="Europe/Berlin">Europe/Berlin</option>
              <option value="America/New_York">America/New_York</option>
              <option value="Asia/Dhaka">Asia/Dhaka</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <label>
            New operational day
            <select
              value={data.settings.rolloverHour}
              onChange={(event) => void onUpdateSettings({ rolloverHour: Number(event.target.value) })}
            >
              {[4, 5, 6, 7, 8].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
            </select>
          </label>
          <p className="settings-note">From midnight until rollover, the day timer remains full and glows red. Unfinished tasks roll forward after the new operational day begins.</p>
        </div>
        <div className="settings-card">
          <span className="eyebrow">PARTNER ACCESS</span>
          <h3>{data.users.length > 1 ? "Partner connected" : "Invite your partner"}</h3>
          <p>{data.users.length > 1 ? `${data.users.find((user) => user.id !== currentUser.id)?.name ?? "Your partner"} is connected to this workspace.` : "Create a private one-time code. It expires after 14 days and can only add one partner."}</p>
          {data.users.length < 2 && (
            <>
              <button className="secondary-button" onClick={() => void onCreateInvite()}>Create invitation code</button>
              {inviteCode && <div className="invite-code-box"><code>{inviteCode}</code><button type="button" onClick={() => void copyInvite()}>Copy</button></div>}
            </>
          )}
        </div>
        <div className="settings-card cloud-card">
          <span className="eyebrow">CLOUD DATA</span>
          <h3>{syncLabel(syncState)}</h3>
          <p>Tasks, projects, notes, activity, and settings are stored in Supabase rather than only in this browser.</p>
          <div className="settings-actions-row">
            <button className="secondary-button" onClick={onExport}>Download backup</button>
            <button className="danger-button subtle-danger" onClick={() => void onSignOut()}>Sign out</button>
          </div>
        </div>
      </section>
    </>
  );
}

function TaskEditor({
  data,
  activeUser,
  task,
  defaultOwnerId,
  defaultDate,
  boardDate,
  defaultProjectId,
  defaultProjectNodeId,
  onClose,
  onSave,
}: {
  data: AppData;
  activeUser: UserProfile;
  task?: Task;
  defaultOwnerId: string;
  defaultDate: string;
  boardDate: string;
  defaultProjectId?: string;
  defaultProjectNodeId?: string;
  onClose: () => void;
  onSave: (form: TaskFormState, existingTask?: Task) => void;
}) {
  const [form, setForm] = useState<TaskFormState>({
    title: task?.title ?? "",
    description: task?.description ?? "",
    ownerId: task?.ownerId ?? defaultOwnerId,
    originalDate: task?.originalDate ?? defaultDate,
    deadline: task?.deadline ?? "",
    priority: task?.priority ?? "normal",
    projectId: task?.projectId ?? defaultProjectId ?? "",
    projectNodeId: task?.projectNodeId ?? defaultProjectNodeId ?? "",
  });
  const project = data.projects.find((item) => !item.deletedAt && item.id === form.projectId);
  const isNew = !task;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    if (isNew && dateCompare(form.originalDate, boardDate) < 0) return;
    onSave(form, task);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal-card task-editor" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">{task ? "TASK DETAILS" : `CREATING AS ${activeUser.name.toUpperCase()}`}</span>
            <h3>{task ? "Edit task" : "Create a task"}</h3>
            <p>Keep the title clear. Additional details are optional.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        <label className="full-field">
          Task name
          <input autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What needs to get done?" />
        </label>
        <label className="full-field">
          Notes
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Context, expectations, links, or a useful reminder…" />
        </label>

        <div className="form-grid">
          <label>
            Owner
            <select
              value={form.ownerId}
              disabled={Boolean(task && task.ownerId !== activeUser.id)}
              onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
            >
              {data.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
            {task && task.ownerId !== activeUser.id && <small className="field-hint">Only the current owner can transfer this task.</small>}
          </label>
          <label>
            Scheduled date
            <input
              type="date"
              min={isNew ? boardDate : undefined}
              value={form.originalDate}
              onChange={(event) => setForm({ ...form, originalDate: event.target.value })}
            />
          </label>
          <label>
            Deadline
            <input type="time" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Task["priority"] })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Project
            <select
              value={form.projectId}
              onChange={(event) => setForm({ ...form, projectId: event.target.value, projectNodeId: "" })}
            >
              <option value="">No project</option>
              {data.projects.filter((item) => !item.deletedAt).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            Project phase
            <select
              value={form.projectNodeId}
              disabled={!project}
              onChange={(event) => setForm({ ...form, projectNodeId: event.target.value })}
            >
              <option value="">No specific phase</option>
              {project?.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!form.title.trim()}>{task ? "Save changes" : "Add task"}</button>
        </div>
      </form>
    </div>
  );
}

function ThreadModal({ data, taskId, activeUserId, onClose, onSend }: { data: AppData; taskId: string; activeUserId: string; onClose: () => void; onSend: (taskId: string, body: string) => void }) {
  const [body, setBody] = useState("");
  const task = data.tasks.find((item) => item.id === taskId);
  const messages = data.messages.filter((message) => message.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!task) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    onSend(taskId, body);
    setBody("");
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card thread-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">TASK THREAD</span><h3>{task.title}</h3></div>
          <button onClick={onClose}>×</button>
        </div>
        <div className="thread-context">
          <span>Original date: {formatShortDate(task.originalDate)}</span>
          <span>Owner: {userById(data, task.ownerId).name}</span>
        </div>
        <div className="messages-list">
          {messages.length ? messages.map((message) => {
            const author = userById(data, message.authorId);
            return (
              <article key={message.id} className={message.authorId === activeUserId ? "mine" : ""}>
                <span className="avatar" style={{ "--accent": author.accent } as React.CSSProperties}>{author.initials}</span>
                <div><strong>{author.name}</strong><p>{message.body}</p><small>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(message.createdAt))}</small></div>
              </article>
            );
          }) : <div className="empty-state"><strong>No notes yet</strong><span>Start the task conversation here.</span></div>}
        </div>
        <form className="message-form" onSubmit={submit}>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Leave context, a note, or a message for your partner…" />
          <button className="primary-button" disabled={!body.trim()}>Send note</button>
        </form>
      </section>
    </div>
  );
}

function ProjectEditor({
  project,
  onClose,
  onSave,
}: {
  project?: Project;
  onClose: () => void;
  onSave: (name: string, description: string, targetDate: string, existingProject?: Project) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [targetDate, setTargetDate] = useState(project?.targetDate ?? "");
  const editing = Boolean(project);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal-card project-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name, description, targetDate, project);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">{editing ? "EDIT PROJECT" : "NEW PROJECT"}</span>
            <h3>{editing ? "Edit project details" : "Create a project"}</h3>
            <p>{editing ? "Update the project without changing its phases or linked tasks." : "Group related tasks into a shared plan."}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Wedding planning" /></label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does success look like?" /></label>
        <label>Target date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!name.trim()}>{editing ? "Save changes" : "Create project"}</button>
        </div>
      </form>
    </div>
  );
}

function PhaseEditor({ project, onClose, onSave }: { project?: Project; onClose: () => void; onSave: (title: string) => void }) {
  const [title, setTitle] = useState("");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal-card compact-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) onSave(title.trim());
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">NEW PHASE</span>
            <h3>Add a project phase</h3>
            <p>{project ? `Organize the next part of ${project.name}.` : "Create a new section for this project."}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <label className="full-field">
          Phase name
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Documents, Research, Launch"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={!title.trim()}>Add phase</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = "default",
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card confirm-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">PLEASE CONFIRM</span>
            <h3>{title}</h3>
            <p>{message}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="button" className={tone === "danger" ? "danger-button" : "primary-button"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
