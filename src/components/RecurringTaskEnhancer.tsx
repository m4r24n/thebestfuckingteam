"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";

type RepeatMode = "none" | "daily" | "weekly" | "monthly" | "yearly" | "interval";

type PendingRecurrence = {
  title: string;
  date: string;
  repeat: Exclude<RepeatMode, "none">;
  intervalDays: number | null;
  createdAfter: string;
};

type Routine = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  owner_user_id: string;
  original_date: string;
  deadline: string | null;
  recurrence_type: Exclude<RepeatMode, "none">;
  recurrence_interval_days: number | null;
};

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function repeatLabel(routine: Routine): string {
  if (routine.recurrence_type === "interval") return `Every ${routine.recurrence_interval_days ?? 1} days`;
  return routine.recurrence_type.charAt(0).toUpperCase() + routine.recurrence_type.slice(1);
}

export default function RecurringTaskEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
  const [editingTask, setEditingTask] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("none");
  const [intervalDays, setIntervalDays] = useState(2);
  const [showRoutines, setShowRoutines] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loadingRoutines, setLoadingRoutines] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [savingRoutineId, setSavingRoutineId] = useState<string | null>(null);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editRepeat, setEditRepeat] = useState<Exclude<RepeatMode, "none">>("daily");
  const [editIntervalDays, setEditIntervalDays] = useState(2);
  const currentForm = useRef<HTMLFormElement | null>(null);
  const submitLocked = useRef(false);

  useEffect(() => {
    const inspect = () => {
      const form = document.querySelector<HTMLFormElement>("form.task-editor");
      const grid = form?.querySelector<HTMLElement>(".form-grid") ?? null;
      const nav = document.querySelector<HTMLElement>(".main-nav");

      if (form !== currentForm.current) {
        currentForm.current = form;
        submitLocked.current = false;
        setRepeat("none");
        setIntervalDays(2);
      }

      setTarget(grid);
      setNavTarget(nav);
      setEditingTask(Boolean(form?.querySelector(".modal-header h3")?.textContent?.trim() === "Edit task"));
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target || editingTask) return;
    const form = target.closest("form") as HTMLFormElement | null;
    if (!form) return;

    const onSubmitCapture = (event: SubmitEvent) => {
      if (submitLocked.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      submitLocked.current = true;

      const submitButton = form.querySelector<HTMLButtonElement>('.modal-actions button[type="submit"], .modal-actions button:not([type])');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.dataset.originalLabel = submitButton.textContent ?? "Add task";
        submitButton.textContent = "Saving…";
      }

      // Hide the dialog immediately after a valid submit so cloud refresh latency does not
      // make the app feel frozen. If the save fails and the form is still mounted after a
      // few seconds, restore it so the user can retry.
      const modal = form.closest<HTMLElement>(".modal-backdrop");
      if (modal) modal.classList.add("task-save-pending");
      window.setTimeout(() => {
        if (!document.body.contains(form)) return;
        submitLocked.current = false;
        if (modal) modal.classList.remove("task-save-pending");
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = submitButton.dataset.originalLabel || "Add task";
        }
      }, 4500);

      if (repeat === "none") return;

      const titleInput = form.querySelector<HTMLInputElement>("label.full-field input");
      const dateInput = form.querySelector<HTMLInputElement>('input[type="date"]');
      const title = titleInput?.value.trim() ?? "";
      const date = dateInput?.value ?? "";
      if (!title || !date) return;

      const pending: PendingRecurrence = {
        title,
        date,
        repeat,
        intervalDays: repeat === "interval" ? Math.max(1, Math.min(3650, intervalDays || 1)) : null,
        createdAfter: new Date(Date.now() - 1500).toISOString(),
      };
      void attachRecurrence(pending);
    };

    form.addEventListener("submit", onSubmitCapture, true);
    return () => form.removeEventListener("submit", onSubmitCapture, true);
  }, [editingTask, intervalDays, repeat, target]);

  const loadRoutines = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoadingRoutines(true);
    setRoutineError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoadingRoutines(false);
      return;
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (membershipError || !membership) {
      setRoutineError(membershipError?.message ?? "Workspace not found");
      setLoadingRoutines(false);
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .select("id, workspace_id, title, description, owner_user_id, original_date, deadline, recurrence_type, recurrence_interval_days")
      .eq("workspace_id", membership.workspace_id)
      .is("recurrence_source_id", null)
      .neq("recurrence_type", "none")
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) setRoutineError(error.message);
    else setRoutines((data ?? []) as Routine[]);
    setLoadingRoutines(false);
  }, []);

  useEffect(() => {
    if (showRoutines) void loadRoutines();
  }, [loadRoutines, showRoutines]);

  const beginEdit = (routine: Routine) => {
    setEditingRoutineId(routine.id);
    setEditTitle(routine.title);
    setEditRepeat(routine.recurrence_type);
    setEditIntervalDays(routine.recurrence_interval_days ?? 2);
  };

  const saveRoutine = async (routine: Routine) => {
    const supabase = getSupabaseClient();
    if (!supabase || !editTitle.trim()) return;
    setSavingRoutineId(routine.id);
    setRoutineError(null);
    const { error } = await supabase
      .from("tasks")
      .update({
        title: editTitle.trim(),
        recurrence_type: editRepeat,
        recurrence_interval_days: editRepeat === "interval" ? Math.max(1, Math.min(3650, editIntervalDays)) : null,
      })
      .eq("id", routine.id);
    setSavingRoutineId(null);
    if (error) {
      setRoutineError(error.message);
      return;
    }
    setEditingRoutineId(null);
    await loadRoutines();
  };

  const stopRoutine = async (routine: Routine) => {
    if (!window.confirm(`Stop “${routine.title}”? Future occurrences will be archived. Past completion history will stay.`)) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setSavingRoutineId(routine.id);
    setRoutineError(null);
    const { error } = await supabase.rpc("stop_recurring_series", { source_task_id: routine.id });
    setSavingRoutineId(null);
    if (error) {
      setRoutineError(error.message);
      return;
    }
    await loadRoutines();
  };

  return (
    <>
      {target && !editingTask && createPortal(
        <>
          <label className="recurrence-field">
            Repeat
            <select value={repeat} onChange={(event) => setRepeat(event.target.value as RepeatMode)}>
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="interval">Custom interval</option>
            </select>
            <small className="field-hint">Each occurrence has its own completion and history.</small>
          </label>
          {repeat === "interval" && (
            <label className="recurrence-field">
              Repeat every
              <div className="recurrence-interval-control">
                <input type="number" min={1} max={3650} inputMode="numeric" value={intervalDays} onChange={(event) => setIntervalDays(Math.max(1, Number(event.target.value) || 1))} />
                <span>days</span>
              </div>
            </label>
          )}
        </>,
        target,
      )}

      {navTarget && createPortal(
        <button className="nav-item routines-nav-item" type="button" onClick={() => setShowRoutines(true)}>
          <span>↻</span> Routines
        </button>,
        navTarget,
      )}

      {showRoutines && createPortal(
        <div className="modal-backdrop routines-backdrop" onMouseDown={() => setShowRoutines(false)}>
          <section className="modal-card routines-manager" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">REPEATING TASKS</span>
                <h3>Routines</h3>
                <p>Manage recurring series without cluttering the Today dashboard.</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowRoutines(false)}>×</button>
            </div>

            {routineError && <p className="form-message error">{routineError}</p>}
            {loadingRoutines ? (
              <div className="routines-empty">Loading routines…</div>
            ) : routines.length === 0 ? (
              <div className="routines-empty"><strong>No active routines</strong><span>Recurring tasks you create will appear here.</span></div>
            ) : (
              <div className="routines-list">
                {routines.map((routine) => {
                  const editing = editingRoutineId === routine.id;
                  return (
                    <article className="routine-card" key={routine.id}>
                      {editing ? (
                        <div className="routine-edit-grid">
                          <label>Task name<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
                          <label>Repeat<select value={editRepeat} onChange={(event) => setEditRepeat(event.target.value as Exclude<RepeatMode, "none">)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="interval">Custom interval</option></select></label>
                          {editRepeat === "interval" && <label>Every N days<input type="number" min={1} max={3650} value={editIntervalDays} onChange={(event) => setEditIntervalDays(Math.max(1, Number(event.target.value) || 1))} /></label>}
                          <div className="routine-actions"><button type="button" className="secondary-button compact" onClick={() => setEditingRoutineId(null)}>Cancel</button><button type="button" className="primary-button compact" disabled={savingRoutineId === routine.id || !editTitle.trim()} onClick={() => void saveRoutine(routine)}>{savingRoutineId === routine.id ? "Saving…" : "Save series"}</button></div>
                        </div>
                      ) : (
                        <>
                          <div className="routine-copy"><strong>{routine.title}</strong><span>{repeatLabel(routine)} · starts {routine.original_date}</span></div>
                          <div className="routine-actions"><button type="button" className="secondary-button compact" onClick={() => beginEdit(routine)}>Edit</button><button type="button" className="danger-button subtle-danger compact" disabled={savingRoutineId === routine.id} onClick={() => void stopRoutine(routine)}>{savingRoutineId === routine.id ? "Stopping…" : "Stop series"}</button></div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

async function attachRecurrence(pending: PendingRecurrence): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await delay(attempt === 0 ? 120 : 220);
    const { data: task, error } = await supabase
      .from("tasks")
      .select("id, workspace_id, created_at")
      .eq("created_by", userId)
      .eq("title", pending.title)
      .eq("original_date", pending.date)
      .gte("created_at", pending.createdAfter)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return;
    if (!task) continue;

    const { error: recurrenceError } = await supabase
      .from("tasks")
      .update({ recurrence_type: pending.repeat, recurrence_interval_days: pending.intervalDays })
      .eq("id", task.id)
      .eq("created_by", userId);
    if (recurrenceError) return;

    const label = pending.repeat === "interval" ? `every ${pending.intervalDays} days` : pending.repeat;
    await supabase.from("activity_log").insert({ workspace_id: task.workspace_id, actor_id: userId, entity_type: "task", entity_id: task.id, action: "recurrence_set", summary: `set “${pending.title}” to repeat ${label}.` });
    return;
  }
}
