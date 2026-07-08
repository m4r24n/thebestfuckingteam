"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { FormEvent, useEffect, useState } from "react";
import {
  addDays,
  dateCompare,
  daysBetween,
  formatClock,
  formatLongDate,
  formatShortDate,
  getBoardDate,
  getCalendarDate,
  isGracePeriod,
} from "@/lib/date";
import type {
  Activity,
  AppData,
  Project,
  Task,
  TaskMessage,
  UserProfile,
} from "@/lib/types";

const STORAGE_KEY = "tbft-demo-v1";
const DEFAULT_TIMEZONE = "Europe/Berlin";

type Section = "today" | "projects" | "calendar" | "activity" | "settings";
type TaskVisualState = "pending" | "completed" | "overdue" | "carried" | "future";

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

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function makeInitialData(): AppData {
  const timezone = DEFAULT_TIMEZONE;
  const rolloverHour = 6;
  const boardDate = getBoardDate(timezone, rolloverHour);
  const yesterday = addDays(boardDate, -1);
  const tomorrow = addDays(boardDate, 1);
  const now = new Date().toISOString();

  const users: UserProfile[] = [
    { id: "marzan", name: "Marzan", initials: "MI", accent: "#d9ff57" },
    { id: "shamina", name: "Shamina", initials: "SI", accent: "#ff9fbd" },
  ];

  const projects: Project[] = [
    {
      id: "project_wedding",
      name: "Wedding & Life Planning",
      description: "Documents, travel, ceremony, and everything we are building together.",
      ownerId: "joint",
      targetDate: addDays(boardDate, 60),
      view: "flow",
      nodes: [
        { id: "node_documents", title: "Documents", position: 0 },
        { id: "node_travel", title: "Travel", position: 1 },
        { id: "node_ceremony", title: "Ceremony", position: 2 },
      ],
      createdAt: now,
    },
    {
      id: "project_career",
      name: "Career Launch",
      description: "Applications, portfolio projects, interview practice, and German.",
      ownerId: "joint",
      targetDate: addDays(boardDate, 90),
      view: "terminal",
      nodes: [
        { id: "node_portfolio", title: "Portfolio", position: 0 },
        { id: "node_applications", title: "Applications", position: 1 },
        { id: "node_interviews", title: "Interviews", position: 2 },
      ],
      createdAt: now,
    },
  ];

  const tasks: Task[] = [
    {
      id: "task_1",
      title: "Review this week’s priorities together",
      description: "Keep the list realistic and decide what matters most.",
      ownerId: "marzan",
      creatorId: "marzan",
      originalDate: boardDate,
      priority: "high",
      projectId: "project_career",
      projectNodeId: "node_applications",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "task_2",
      title: "Prepare the travel document checklist",
      ownerId: "shamina",
      creatorId: "marzan",
      originalDate: boardDate,
      deadline: "18:00",
      priority: "normal",
      projectId: "project_wedding",
      projectNodeId: "node_documents",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "task_3",
      title: "Finish the portfolio project description",
      ownerId: "marzan",
      creatorId: "shamina",
      originalDate: yesterday,
      priority: "normal",
      projectId: "project_career",
      projectNodeId: "node_portfolio",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "task_4",
      title: "Book a focused planning call",
      ownerId: "shamina",
      creatorId: "shamina",
      originalDate: tomorrow,
      priority: "low",
      projectId: "project_wedding",
      projectNodeId: "node_ceremony",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "task_5",
      title: "Send one job application",
      ownerId: "marzan",
      creatorId: "marzan",
      originalDate: boardDate,
      priority: "normal",
      projectId: "project_career",
      projectNodeId: "node_applications",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    users,
    tasks,
    projects,
    messages: [
      {
        id: "message_1",
        taskId: "task_2",
        authorId: "marzan",
        body: "I added this under Documents. Please add anything I missed in this thread.",
        createdAt: now,
      },
    ],
    activities: [
      {
        id: "activity_1",
        actorId: "marzan",
        text: "created the shared workspace.",
        createdAt: now,
      },
    ],
    settings: {
      timezone,
      rolloverHour,
      discreetMode: false,
      workspaceName: "The Best Fucking Team",
    },
  };
}

function userById(data: AppData, id: string): UserProfile {
  return data.users.find((user) => user.id === id) ?? data.users[0];
}

function taskAppearsOnDate(task: Task, date: string, data: AppData, now: Date): boolean {
  if (task.deletedAt || dateCompare(date, task.originalDate) < 0) return false;

  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);

  if (dateCompare(date, boardDate) > 0) {
    return task.originalDate === date;
  }

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

export default function TBFTApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [activeUserId, setActiveUserId] = useState("marzan");
  const [section, setSection] = useState<Section>("today");
  const [now, setNow] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState("");
  const [taskModal, setTaskModal] = useState<{ task?: Task; ownerId: string; date: string; projectId?: string; projectNodeId?: string } | null>(null);
  const [threadTaskId, setThreadTaskId] = useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as AppData;
        setData(parsed);
        const date = getBoardDate(parsed.settings.timezone, parsed.settings.rolloverHour);
        setSelectedDate(date);
        setSelectedProjectId(parsed.projects[0]?.id ?? null);
        return;
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    const initial = makeInitialData();
    setData(initial);
    setSelectedDate(getBoardDate(initial.settings.timezone, initial.settings.rolloverHour));
    setSelectedProjectId(initial.projects[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (data) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!data || !selectedDate) {
    return <div className="loading-screen">Opening your shared notebook…</div>;
  }

  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const activeUser = userById(data, activeUserId);
  const title = data.settings.discreetMode ? "TBFT" : data.settings.workspaceName;

  const recordActivity = (actorId: string, text: string) => {
    const activity: Activity = {
      id: makeId("activity"),
      actorId,
      text,
      createdAt: new Date().toISOString(),
    };
    setData((current) => current ? { ...current, activities: [activity, ...current.activities] } : current);
  };

  const saveTask = (form: TaskFormState, existingTask?: Task) => {
    const timestamp = new Date().toISOString();
    if (existingTask) {
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === existingTask.id
              ? {
                  ...task,
                  title: form.title.trim(),
                  description: form.description.trim() || undefined,
                  ownerId: form.ownerId,
                  originalDate: form.originalDate,
                  deadline: form.deadline || undefined,
                  priority: form.priority,
                  projectId: form.projectId || undefined,
                  projectNodeId: form.projectNodeId || undefined,
                  updatedAt: timestamp,
                }
              : task,
          ),
        };
      });
      recordActivity(activeUserId, `edited “${form.title.trim()}”.`);
      setToast("Task updated");
    } else {
      const newTask: Task = {
        id: makeId("task"),
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        ownerId: form.ownerId,
        creatorId: activeUserId,
        originalDate: form.originalDate,
        deadline: form.deadline || undefined,
        priority: form.priority,
        projectId: form.projectId || undefined,
        projectNodeId: form.projectNodeId || undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setData((current) => current ? { ...current, tasks: [...current.tasks, newTask] } : current);
      const owner = userById(data, form.ownerId);
      recordActivity(activeUserId, `created “${newTask.title}” for ${owner.name}.`);
      setToast(`Task added for ${owner.name}`);
    }
    setTaskModal(null);
  };

  const completeTask = (task: Task, viewingDate: string) => {
    if (task.ownerId !== activeUserId) {
      setToast("Only the task owner can complete it");
      return;
    }
    if (dateCompare(viewingDate, boardDate) > 0) {
      setToast("A future task cannot be completed early");
      return;
    }
    if (task.completedAt) return;

    const timestamp = new Date().toISOString();
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === task.id ? { ...item, completedAt: timestamp, updatedAt: timestamp } : item,
        ),
      };
    });
    const lateDays = Math.max(0, daysBetween(task.originalDate, boardDate));
    recordActivity(activeUserId, `completed “${task.title}”${lateDays ? ` ${lateDays} day${lateDays === 1 ? "" : "s"} late` : ""}.`);
    setToast("Hell yes — completed");
  };

  const deleteTask = (task: Task) => {
    if (task.ownerId !== activeUserId) {
      setToast("Only the task owner can delete it");
      return;
    }
    const confirmed = window.confirm(`Delete “${task.title}”?`);
    if (!confirmed) return;

    const timestamp = new Date().toISOString();
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === task.id ? { ...item, deletedAt: timestamp, updatedAt: timestamp } : item,
        ),
      };
    });
    recordActivity(activeUserId, `deleted “${task.title}”.`);
    setToast("Task removed");
  };

  const addMessage = (taskId: string, body: string) => {
    if (!body.trim()) return;
    const message: TaskMessage = {
      id: makeId("message"),
      taskId,
      authorId: activeUserId,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    setData((current) => current ? { ...current, messages: [...current.messages, message] } : current);
    const task = data.tasks.find((item) => item.id === taskId);
    if (task) recordActivity(activeUserId, `commented on “${task.title}”.`);
  };

  const createProject = (name: string, description: string, targetDate: string) => {
    const project: Project = {
      id: makeId("project"),
      name: name.trim(),
      description: description.trim(),
      ownerId: "joint",
      targetDate: targetDate || undefined,
      view: "flow",
      nodes: [],
      createdAt: new Date().toISOString(),
    };
    setData((current) => current ? { ...current, projects: [...current.projects, project] } : current);
    setSelectedProjectId(project.id);
    setProjectModalOpen(false);
    recordActivity(activeUserId, `created project “${project.name}”.`);
    setToast("Project created");
  };

  const addProjectNode = (project: Project) => {
    const title = window.prompt("Name this project phase or section:");
    if (!title?.trim()) return;
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        projects: current.projects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                nodes: [
                  ...item.nodes,
                  { id: makeId("node"), title: title.trim(), position: item.nodes.length },
                ],
              }
            : item,
        ),
      };
    });
    recordActivity(activeUserId, `added “${title.trim()}” to project “${project.name}”.`);
  };

  const updateProjectView = (projectId: string, view: Project["view"]) => {
    setData((current) => current ? {
      ...current,
      projects: current.projects.map((project) => project.id === projectId ? { ...project, view } : project),
    } : current);
  };

  const resetDemo = () => {
    if (!window.confirm("Reset all demo data and start again?")) return;
    const initial = makeInitialData();
    setData(initial);
    setActiveUserId("marzan");
    setSelectedDate(getBoardDate(initial.settings.timezone, initial.settings.rolloverHour));
    setSelectedProjectId(initial.projects[0]?.id ?? null);
    setSection("today");
    setToast("Demo reset");
  };

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: "today", label: "Current Day", icon: "▤" },
    { id: "projects", label: "Projects", icon: "◇" },
    { id: "calendar", label: "Calendar", icon: "□" },
    { id: "activity", label: "Activity", icon: "↗" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div className="app-shell">
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
              }}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-quote">
          <span>TEAM REMINDER</span>
          <p>“Two people. One team. No excuses.”</p>
        </div>

        <div className="demo-badge">
          <span className="live-dot" /> Local demo mode
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">ACTIVE AS</span>
            <div className="user-switcher">
              {data.users.map((user) => (
                <button
                  key={user.id}
                  className={activeUserId === user.id ? "user-chip active" : "user-chip"}
                  onClick={() => setActiveUserId(user.id)}
                >
                  <span className="avatar" style={{ "--accent": user.accent } as React.CSSProperties}>
                    {user.initials}
                  </span>
                  {user.name}
                </button>
              ))}
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
              onComplete={completeTask}
              onDelete={deleteTask}
              onEdit={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onThread={setThreadTaskId}
            />
          )}

          {section === "projects" && (
            <ProjectsPage
              data={data}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onCreateProject={() => setProjectModalOpen(true)}
              onAddNode={addProjectNode}
              onUpdateView={updateProjectView}
              onOpenTask={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onCreateTask={(projectId, projectNodeId) => setTaskModal({ ownerId: activeUserId, date: boardDate, projectId, projectNodeId })}
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
              onComplete={completeTask}
              onDelete={deleteTask}
              onEdit={(task) => setTaskModal({ task, ownerId: task.ownerId, date: task.originalDate })}
              onThread={setThreadTaskId}
            />
          )}

          {section === "activity" && <ActivityPage data={data} />}

          {section === "settings" && (
            <SettingsPage data={data} setData={setData} resetDemo={resetDemo} />
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

      {projectModalOpen && (
        <ProjectEditor onClose={() => setProjectModalOpen(false)} onSave={createProject} />
      )}

      {toast && <div className="toast">{toast}</div>}
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
}) {
  const tasks = data.tasks.filter((task) => taskAppearsOnDate(task, date, data, now));
  const completed = tasks.filter((task) => task.completedAt).length;
  const grace = isGracePeriod(data.settings.timezone, data.settings.rolloverHour, now);
  const calendarDate = getCalendarDate(data.settings.timezone, now);

  return (
    <>
      <PageHeading
        eyebrow={grace && calendarDate !== date ? "MIDNIGHT GRACE PERIOD" : "TODAY’S SHARED NOTEBOOK"}
        title={formatLongDate(date)}
        description={
          grace && calendarDate !== date
            ? `Yesterday’s board remains active until ${data.settings.rolloverHour}:00. Unfinished tasks are now red.`
            : "One page, two columns, and a clear view of what the team is moving forward."
        }
        action={
          <div className="team-progress-card">
            <span>TEAM PROGRESS</span>
            <strong>{tasks.length ? Math.round((completed / tasks.length) * 100) : 0}%</strong>
            <div className="mini-progress"><i style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div>
          </div>
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
}) {
  const state = getTaskState(task, viewingDate, data, now);
  const owner = userById(data, task.ownerId);
  const creator = userById(data, task.creatorId);
  const project = data.projects.find((item) => item.id === task.projectId);
  const node = project?.nodes.find((item) => item.id === task.projectNodeId);
  const messages = data.messages.filter((message) => message.taskId === task.id).length;
  const isOwner = task.ownerId === activeUserId;
  const boardDate = getBoardDate(data.settings.timezone, data.settings.rolloverHour, now);
  const canComplete = isOwner && !task.completedAt && dateCompare(viewingDate, boardDate) <= 0;
  const carriedDays = Math.max(0, daysBetween(task.originalDate, viewingDate));

  return (
    <article className={`task-card state-${state}`}>
      <div className="task-card-top">
        <button
          className="complete-control"
          onClick={onComplete}
          disabled={!canComplete}
          aria-label={task.completedAt ? "Completed" : "Mark complete"}
          title={!isOwner ? `Only ${owner.name} can complete this task` : state === "future" ? "Cannot complete before the date" : "Mark complete"}
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
          <button onClick={onEdit} title="Edit task">✎</button>
          <button onClick={onDelete} disabled={!isOwner} title={isOwner ? "Delete task" : "Only the owner can delete"}>×</button>
        </div>
      </div>

      {state === "carried" && (
        <div className="carry-note">↳ Carried from {formatShortDate(task.originalDate)} · {carriedDays} day{carriedDays === 1 ? "" : "s"}</div>
      )}

      <div className="task-meta">
        {task.deadline && <span>◷ {task.deadline}</span>}
        {project && <span>◇ {project.name}{node ? ` / ${node.title}` : ""}</span>}
        {task.creatorId !== task.ownerId && <span>Added by {creator.name}</span>}
        {task.completedAt && <span>Completed {formatClock(task.completedAt)}</span>}
      </div>

      <button className="thread-button" onClick={onThread}>
        <span>☵ Open thread</span>
        <strong>{messages} {messages === 1 ? "note" : "notes"}</strong>
      </button>
    </article>
  );
}

function ProjectsPage({
  data,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  onAddNode,
  onUpdateView,
  onOpenTask,
  onCreateTask,
}: {
  data: AppData;
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onAddNode: (project: Project) => void;
  onUpdateView: (projectId: string, view: Project["view"]) => void;
  onOpenTask: (task: Task) => void;
  onCreateTask: (projectId: string, projectNodeId?: string) => void;
}) {
  const project = data.projects.find((item) => item.id === selectedProjectId) ?? data.projects[0];

  return (
    <>
      <PageHeading
        eyebrow="THE CONNECTING DOTS"
        title="Projects"
        description="Break bigger goals into phases, attach daily tasks, and switch how the whole project is visualized."
        action={<button className="primary-button" onClick={onCreateProject}>+ New project</button>}
      />

      <div className="project-layout">
        <aside className="project-list-panel">
          {data.projects.map((item) => {
            const tasks = data.tasks.filter((task) => !task.deletedAt && task.projectId === item.id);
            const complete = tasks.filter((task) => task.completedAt).length;
            const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;
            return (
              <button
                key={item.id}
                className={project?.id === item.id ? "project-list-item active" : "project-list-item"}
                onClick={() => onSelectProject(item.id)}
              >
                <span>◇</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{progress}% complete · {tasks.length} tasks</small>
                </div>
              </button>
            );
          })}
        </aside>

        {project ? (
          <ProjectWorkspace
            data={data}
            project={project}
            onAddNode={() => onAddNode(project)}
            onUpdateView={(view) => onUpdateView(project.id, view)}
            onOpenTask={onOpenTask}
            onCreateTask={(nodeId) => onCreateTask(project.id, nodeId)}
          />
        ) : (
          <div className="blank-panel">Create your first project to begin.</div>
        )}
      </div>
    </>
  );
}

function ProjectWorkspace({
  data,
  project,
  onAddNode,
  onUpdateView,
  onOpenTask,
  onCreateTask,
}: {
  data: AppData;
  project: Project;
  onAddNode: () => void;
  onUpdateView: (view: Project["view"]) => void;
  onOpenTask: (task: Task) => void;
  onCreateTask: (nodeId?: string) => void;
}) {
  const tasks = data.tasks.filter((task) => !task.deletedAt && task.projectId === project.id);
  const completed = tasks.filter((task) => task.completedAt).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  return (
    <section className="project-workspace">
      <div className="project-hero">
        <div>
          <span className="eyebrow">JOINT PROJECT</span>
          <h3>{project.name}</h3>
          <p>{project.description || "No description yet."}</p>
        </div>
        <div className="project-score">
          <strong>{progress}%</strong>
          <span>{completed} of {tasks.length} tasks completed</span>
        </div>
      </div>
      <div className="large-progress"><i style={{ width: `${progress}%` }} /></div>

      <div className="project-toolbar">
        <div className="view-tabs">
          <button className={project.view === "flow" ? "active" : ""} onClick={() => onUpdateView("flow")}>Flowchart</button>
          <button className={project.view === "folders" ? "active" : ""} onClick={() => onUpdateView("folders")}>Windows 98</button>
          <button className={project.view === "terminal" ? "active" : ""} onClick={() => onUpdateView("terminal")}>Neon terminal</button>
        </div>
        <button className="secondary-button compact" onClick={onAddNode}>+ Add phase</button>
      </div>

      {project.view === "flow" && (
        <div className="flow-view">
          {project.nodes.length === 0 ? <ProjectEmpty onAdd={onAddNode} /> : project.nodes.map((node, index) => {
            const nodeTasks = tasks.filter((task) => task.projectNodeId === node.id);
            const nodeComplete = nodeTasks.filter((task) => task.completedAt).length;
            const nodeProgress = nodeTasks.length ? Math.round((nodeComplete / nodeTasks.length) * 100) : 0;
            return (
              <div className="flow-row" key={node.id}>
                <div className="flow-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="flow-connector" />
                <div className="flow-node">
                  <div>
                    <span>PROJECT PHASE</span>
                    <h4>{node.title}</h4>
                  </div>
                  <strong>{nodeProgress}%</strong>
                  <div className="node-tasks">
                    {nodeTasks.length ? nodeTasks.map((task) => (
                      <button key={task.id} onClick={() => onOpenTask(task)} className={task.completedAt ? "done" : ""}>
                        {task.completedAt ? "✓" : "○"} {task.title}
                      </button>
                    )) : <em>No connected tasks yet</em>}
                    <button className="node-add-task" onClick={() => onCreateTask(node.id)}>+ Add task here</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {project.view === "folders" && (
        <div className="win98-window">
          <div className="win98-titlebar"><strong>Exploring - {project.name}</strong><span>_ □ ×</span></div>
          <div className="win98-menu">File&nbsp;&nbsp; Edit&nbsp;&nbsp; View&nbsp;&nbsp; Help</div>
          <div className="win98-address">Address: C:\TEAM\{project.name.toUpperCase().replaceAll(" ", "_")}</div>
          <div className="folder-grid">
            {project.nodes.map((node) => {
              const nodeTasks = tasks.filter((task) => task.projectNodeId === node.id);
              return (
                <div className="folder-group" key={node.id}>
                  <div className="folder-icon">📁</div>
                  <strong>{node.title}</strong>
                  {nodeTasks.map((task) => (
                    <button key={task.id} onClick={() => onOpenTask(task)}>{task.completedAt ? "☑" : "📄"} {task.title}</button>
                  ))}
                  <button onClick={() => onCreateTask(node.id)}>➕ Add task</button>
                </div>
              );
            })}
            {!project.nodes.length && <ProjectEmpty onAdd={onAddNode} />}
          </div>
          <div className="win98-status">{project.nodes.length} object(s) · {progress}% complete</div>
        </div>
      )}

      {project.view === "terminal" && (
        <div className="terminal-view">
          <div className="terminal-top"><span>● ● ●</span><strong>tbft-project-browser</strong></div>
          <p className="terminal-path">TBFT://{project.name.toUpperCase().replaceAll(" ", "-")}</p>
          <p>[{Array(Math.round(progress / 5)).fill("█").join("")}{Array(20 - Math.round(progress / 5)).fill("░").join("")}] {progress}%</p>
          {project.nodes.map((node) => {
            const nodeTasks = tasks.filter((task) => task.projectNodeId === node.id);
            return (
              <div className="terminal-section" key={node.id}>
                <strong>&gt; {node.title.toLowerCase().replaceAll(" ", "_")}</strong>
                {nodeTasks.length ? nodeTasks.map((task) => (
                  <button key={task.id} onClick={() => onOpenTask(task)}>
                    &nbsp;&nbsp;[{task.completedAt ? "x" : " "}] {task.title}
                  </button>
                )) : <span>&nbsp;&nbsp;[ ] no_tasks_connected</span>}
                <button onClick={() => onCreateTask(node.id)}>&nbsp;&nbsp;+ create_task</button>
              </div>
            );
          })}
          {!project.nodes.length && <button className="terminal-add" onClick={onAddNode}>&gt; create_first_phase --now</button>}
          <span className="terminal-cursor">_</span>
        </div>
      )}
    </section>
  );
}

function ProjectEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="project-empty">
      <strong>No project phases yet</strong>
      <span>Create the first connecting point in this project.</span>
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
      />
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

function SettingsPage({ data, setData, resetDemo }: { data: AppData; setData: React.Dispatch<React.SetStateAction<AppData | null>>; resetDemo: () => void }) {
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE CONTROL"
        title="Settings"
        description="The workspace timezone controls midnight warnings and the 6:00 AM operational-day rollover."
      />
      <section className="settings-grid">
        <div className="settings-card">
          <span className="eyebrow">IDENTITY</span>
          <label>
            Workspace name
            <input
              value={data.settings.workspaceName}
              onChange={(event) => setData((current) => current ? { ...current, settings: { ...current.settings, workspaceName: event.target.value } } : current)}
            />
          </label>
          <label className="toggle-row">
            <div><strong>Discreet mode</strong><span>Use “TBFT” in the interface.</span></div>
            <input
              type="checkbox"
              checked={data.settings.discreetMode}
              onChange={(event) => setData((current) => current ? { ...current, settings: { ...current.settings, discreetMode: event.target.checked } } : current)}
            />
          </label>
        </div>
        <div className="settings-card">
          <span className="eyebrow">DAILY SYSTEM</span>
          <label>
            Workspace timezone
            <select
              value={data.settings.timezone}
              onChange={(event) => setData((current) => current ? { ...current, settings: { ...current.settings, timezone: event.target.value } } : current)}
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
              onChange={(event) => setData((current) => current ? { ...current, settings: { ...current.settings, rolloverHour: Number(event.target.value) } } : current)}
            >
              {[4, 5, 6, 7, 8].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
            </select>
          </label>
          <p className="settings-note">From midnight until rollover, unfinished tasks illuminate red. After rollover they appear yellow as carried tasks.</p>
        </div>
        <div className="settings-card danger-card">
          <span className="eyebrow">DEMO DATA</span>
          <h3>Start with a clean notebook</h3>
          <p>This removes tasks, threads, projects, and local activity from this browser.</p>
          <button className="danger-button" onClick={resetDemo}>Reset demo workspace</button>
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
  const project = data.projects.find((item) => item.id === form.projectId);
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
            <span className="eyebrow">{task ? "EDIT TASK" : `CREATING AS ${activeUser.name.toUpperCase()}`}</span>
            <h3>{task ? "Refine the task" : "Add something worth finishing"}</h3>
          </div>
          <button type="button" onClick={onClose}>×</button>
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
            <select value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}>
              {data.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
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
              {data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
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

function ProjectEditor({ onClose, onSave }: { onClose: () => void; onSave: (name: string, description: string, targetDate: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal-card project-editor" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name, description, targetDate); }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className="eyebrow">NEW PROJECT</span><h3>Build the bigger picture</h3></div><button type="button" onClick={onClose}>×</button></div>
        <label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Wedding planning" /></label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does success look like?" /></label>
        <label>Target date<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()}>Create project</button></div>
      </form>
    </div>
  );
}
