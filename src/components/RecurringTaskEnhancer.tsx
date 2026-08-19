"use client";

import { useEffect, useRef, useState } from "react";
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

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Adds recurrence to the existing TBFT task editor without changing the task editor's
 * normal one-off save path. The task is created normally, then this helper attaches
 * recurrence to that just-created row; the database trigger expands the series.
 */
export default function RecurringTaskEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("none");
  const [intervalDays, setIntervalDays] = useState(2);
  const currentForm = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const inspect = () => {
      const form = document.querySelector<HTMLFormElement>("form.task-editor");
      const grid = form?.querySelector<HTMLElement>(".form-grid") ?? null;

      if (form !== currentForm.current) {
        currentForm.current = form;
        setRepeat("none");
        setIntervalDays(2);
      }

      setTarget(grid);
      setEditing(Boolean(form?.querySelector(".modal-header h3")?.textContent?.trim() === "Edit task"));
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target || editing) return;
    const form = target.closest("form") as HTMLFormElement | null;
    if (!form) return;

    const onSubmitCapture = () => {
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
  }, [editing, intervalDays, repeat, target]);

  if (!target || editing) return null;

  return createPortal(
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
            <input
              type="number"
              min={1}
              max={3650}
              inputMode="numeric"
              value={intervalDays}
              onChange={(event) => setIntervalDays(Math.max(1, Number(event.target.value) || 1))}
            />
            <span>days</span>
          </div>
          <small className="field-hint">For example, 3 means every 3 days.</small>
        </label>
      )}
    </>,
    target,
  );
}

async function attachRecurrence(pending: PendingRecurrence): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  // The regular task save happens in the existing TBFT component. Realtime/database
  // latency varies, so locate the newly-created row with a short bounded retry loop.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(attempt === 0 ? 180 : 260);

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

    if (error) {
      console.warn("TBFT recurrence lookup failed", error.message);
      return;
    }
    if (!task) continue;

    const { error: recurrenceError } = await supabase
      .from("tasks")
      .update({
        recurrence_type: pending.repeat,
        recurrence_interval_days: pending.intervalDays,
      })
      .eq("id", task.id)
      .eq("created_by", userId);

    if (recurrenceError) {
      console.warn("TBFT recurrence setup failed", recurrenceError.message);
      return;
    }

    // Keep the human-readable history useful without making recurrence setup block task creation.
    const label = pending.repeat === "interval"
      ? `every ${pending.intervalDays} days`
      : pending.repeat;
    await supabase.from("activity_log").insert({
      workspace_id: task.workspace_id,
      actor_id: userId,
      entity_type: "task",
      entity_id: task.id,
      action: "recurrence_set",
      summary: `set “${pending.title}” to repeat ${label}.`,
    });
    return;
  }

  console.warn("TBFT could not find the newly-created task to attach recurrence.");
}
