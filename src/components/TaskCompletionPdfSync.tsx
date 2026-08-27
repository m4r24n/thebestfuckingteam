"use client";

import { useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { saveTaskCompletionPdf } from "@/lib/taskCompletionPdf";

export default function TaskCompletionPdfSync() {
  useEffect(() => {
    let cancelled = false;
    const attempted = new Set<string>();
    const completionState = new Map<string, string | null>();
    const retryTimers = new Set<number>();
    let cleanupChannel: (() => void) | null = null;

    const run = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId || cancelled) return;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      const workspaceId = membership?.workspace_id as string | undefined;
      if (!workspaceId || cancelled) return;

      const exportOne = async (taskId: string, completedAt: string) => {
        const key = `${taskId}:${completedAt}`;
        if (attempted.has(key) || cancelled) return;
        attempted.add(key);
        try {
          const filename = await saveTaskCompletionPdf(supabase, taskId, completedAt, userId);
          if (!filename) attempted.delete(key);
        } catch (error) {
          attempted.delete(key);
          console.warn("TBFT task note PDF export is pending", error);
        }
      };

      const exportAfterCompletion = (taskId: string, completedAt: string) => {
        void exportOne(taskId, completedAt);

        // Completion can race the note editor's final autosave. Retry only this
        // completion event; ordinary note edits must never generate PDFs.
        for (const delay of [1_000, 3_000]) {
          const timer = window.setTimeout(() => {
            retryTimers.delete(timer);
            void exportOne(taskId, completedAt);
          }, delay);
          retryTimers.add(timer);
        }
      };

      const { data: taskStates, error: taskStatesError } = await supabase
        .from("tasks")
        .select("id, completed_at")
        .eq("workspace_id", workspaceId);

      if (taskStatesError) {
        console.warn("TBFT task completion state could not be loaded", taskStatesError);
        return;
      }

      for (const row of taskStates ?? []) {
        completionState.set(row.id as string, (row.completed_at as string | null) ?? null);
      }

      const { data: completedTasks } = await supabase
        .from("tasks")
        .select("id, completed_at, completion_note")
        .eq("workspace_id", workspaceId)
        .not("completed_at", "is", null)
        .neq("completion_note", "")
        .order("completed_at", { ascending: false })
        .limit(40);

      for (const row of completedTasks ?? []) {
        if (cancelled) return;
        const completedAt = row.completed_at as string | null;
        if (completedAt) await exportOne(row.id as string, completedAt);
      }

      const channel = supabase
        .channel(`tbft-task-note-pdf-${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            const row = payload.new as { id?: string; completed_at?: string | null };
            if (!row.id) return;
            const wasCompleted = Boolean(completionState.get(row.id));
            completionState.set(row.id, row.completed_at ?? null);
            if (!wasCompleted && row.completed_at) exportAfterCompletion(row.id, row.completed_at);
          },
        )
        .subscribe();

      cleanupChannel = () => { void supabase.removeChannel(channel); };
    };

    void run();
    return () => {
      cancelled = true;
      for (const timer of retryTimers) window.clearTimeout(timer);
      retryTimers.clear();
      cleanupChannel?.();
    };
  }, []);

  return null;
}
