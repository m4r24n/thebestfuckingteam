"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";

type Reminder = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  created_by: string;
  reminder_date: string;
  title: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type Member = { id: string; name: string };

type ColumnTarget = {
  ownerId: string;
  ownerName: string;
  topMount: HTMLElement;
  bottomMount: HTMLElement;
};

type EditorState = {
  ownerId: string;
  ownerName: string;
  reminder?: Reminder;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function dateFromTodayHeading(): string {
  const status = document.querySelector<HTMLElement>(".dashboard-status-row");
  const page = status?.closest<HTMLElement>(".page-content");
  const heading = page?.querySelector<HTMLElement>(".page-heading h2")?.textContent?.trim();
  if (!heading) return "";
  const parsed = new Date(`${heading} 12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function TodayRemindersEnhancer() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [userId, setUserId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [boardDate, setBoardDate] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [targets, setTargets] = useState<ColumnTarget[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetSignature = useRef("");
  const mountSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const currentUserId = auth.user?.id;
      if (!currentUserId || cancelled) return;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", currentUserId)
        .limit(1)
        .maybeSingle();
      const currentWorkspaceId = membership?.workspace_id as string | undefined;
      if (!currentWorkspaceId || cancelled) return;

      const { data: memberRows } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", currentWorkspaceId);
      const ids = (memberRows ?? []).map((row) => row.user_id as string);
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id, display_name").in("id", ids)
        : { data: [] as Array<{ id: string; display_name: string | null }> };

      if (cancelled) return;
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id as string, String(profile.display_name || "Partner")]));
      setUserId(currentUserId);
      setWorkspaceId(currentWorkspaceId);
      setMembers(ids.map((id) => ({ id, name: profileMap.get(id) ?? "Partner" })));
    };

    void loadContext();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const inspect = () => {
      const status = document.querySelector<HTMLElement>(".dashboard-status-row");
      const page = status?.closest<HTMLElement>(".page-content");
      if (!page) {
        if (targetSignature.current) {
          targetSignature.current = "";
          setTargets([]);
          setBoardDate("");
        }
        return;
      }

      const nextDate = dateFromTodayHeading();
      setBoardDate((current) => current === nextDate ? current : nextDate);

      const columns = Array.from(page.querySelectorAll<HTMLElement>(".split-board .notepad-column"));
      const next: ColumnTarget[] = [];

      columns.forEach((column, index) => {
        const ownerName = column.querySelector<HTMLElement>(".partner-title h3")?.textContent?.trim() ?? "Partner";
        const owner = members.find((member) => normalize(member.name) === normalize(ownerName)) ?? members[index];
        const taskList = column.querySelector<HTMLElement>(":scope > .task-list");
        if (!owner || !taskList) return;

        // Remove mounts from the first version, where reminders occupied their own
        // section outside the task list and reduced the usable task-board area.
        column.querySelectorAll<HTMLElement>(":scope > .tbft-reminder-top-mount, :scope > .tbft-reminder-bottom-mount")
          .forEach((legacyMount) => legacyMount.remove());

        let topMount = taskList.querySelector<HTMLElement>(`:scope > .tbft-reminder-top-mount[data-owner-id="${owner.id}"]`);
        if (!topMount) {
          topMount = document.createElement("div");
          topMount.className = "tbft-reminder-top-mount";
          topMount.dataset.ownerId = owner.id;
          topMount.dataset.mountKey = `${owner.id}-top-${++mountSequence.current}`;
          taskList.insertBefore(topMount, taskList.firstChild);
        }

        let bottomMount = taskList.querySelector<HTMLElement>(`:scope > .tbft-reminder-bottom-mount[data-owner-id="${owner.id}"]`);
        if (!bottomMount) {
          bottomMount = document.createElement("div");
          bottomMount.className = "tbft-reminder-bottom-mount";
          bottomMount.dataset.ownerId = owner.id;
          bottomMount.dataset.mountKey = `${owner.id}-bottom-${++mountSequence.current}`;
          taskList.appendChild(bottomMount);
        }

        next.push({ ownerId: owner.id, ownerName, topMount, bottomMount });
      });

      const signature = next
        .map((item) => `${item.ownerId}:${item.topMount.dataset.mountKey}:${item.bottomMount.dataset.mountKey}`)
        .join("|");
      if (signature !== targetSignature.current) {
        targetSignature.current = signature;
        setTargets(next);
      }
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [members]);

  const loadReminders = useCallback(async () => {
    if (!workspaceId || !boardDate) {
      setReminders([]);
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error: loadError } = await supabase
      .from("reminders")
      .select("id, workspace_id, owner_user_id, created_by, reminder_date, title, note, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("reminder_date", boardDate)
      .order("created_at", { ascending: true });
    if (loadError) {
      console.warn("TBFT reminders could not be loaded", loadError);
      return;
    }
    setReminders((data ?? []) as Reminder[]);
  }, [boardDate, workspaceId]);

  useEffect(() => { void loadReminders(); }, [loadReminders]);

  useEffect(() => {
    if (!workspaceId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase
      .channel(`tbft-reminders-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reminders", filter: `workspace_id=eq.${workspaceId}` },
        () => void loadReminders(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadReminders, workspaceId]);

  const openEditor = (ownerId: string, ownerName: string, reminder?: Reminder) => {
    setEditor({ ownerId, ownerName, reminder });
    setTitle(reminder?.title ?? "");
    setNote(reminder?.note ?? "");
    setReminderDate(reminder?.reminder_date ?? boardDate);
    setError("");
  };

  const save = async () => {
    if (!editor || !workspaceId || !userId || !title.trim() || !reminderDate || busy) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      if (editor.reminder) {
        const { error: saveError } = await supabase
          .from("reminders")
          .update({
            owner_user_id: editor.ownerId,
            reminder_date: reminderDate,
            title: title.trim(),
            note: note.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editor.reminder.id);
        if (saveError) throw saveError;
      } else {
        const { error: saveError } = await supabase.from("reminders").insert({
          workspace_id: workspaceId,
          owner_user_id: editor.ownerId,
          created_by: userId,
          reminder_date: reminderDate,
          title: title.trim(),
          note: note.trim() || null,
        });
        if (saveError) throw saveError;
      }
      setEditor(null);
      await loadReminders();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (reminder: Reminder) => {
    if (!window.confirm(`Delete reminder “${reminder.title}”?`)) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error: removeError } = await supabase.from("reminders").delete().eq("id", reminder.id);
    if (removeError) {
      console.warn("TBFT reminder could not be deleted", removeError);
      return;
    }
    await loadReminders();
  };

  return (
    <>
      {targets.map((target) => {
        const ownerReminders = reminders.filter((reminder) => reminder.owner_user_id === target.ownerId);
        return createPortal(
          <>
            {ownerReminders.map((reminder) => (
              <article className="today-reminder-card" key={reminder.id}>
                <button className="today-reminder-main" type="button" onClick={() => openEditor(target.ownerId, target.ownerName, reminder)}>
                  <span className="today-reminder-label">REMINDER</span>
                  <strong>{reminder.title}</strong>
                  {reminder.note && <span className="today-reminder-note">{reminder.note}</span>}
                </button>
                <button className="today-reminder-remove" type="button" aria-label={`Delete ${reminder.title}`} onClick={() => void remove(reminder)}>×</button>
              </article>
            ))}
          </>,
          target.topMount,
          `reminders-${target.ownerId}`,
        );
      })}

      {targets.map((target) => createPortal(
        <button className="add-reminder-flow" type="button" onClick={() => openEditor(target.ownerId, target.ownerName)}>
          <span>+</span> Add reminder for {target.ownerName}
        </button>,
        target.bottomMount,
        `add-reminder-${target.ownerId}`,
      ))}

      {editor && createPortal(
        <div className="modal-backdrop reminder-modal-backdrop" onMouseDown={() => !busy && setEditor(null)}>
          <section className="modal-card reminder-editor-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">REMINDER FOR {editor.ownerName}</span>
                <h3>{editor.reminder ? "Edit reminder" : "Add reminder"}</h3>
                <p>On that day it will appear as the first card in {editor.ownerName}&apos;s task list.</p>
              </div>
              <button type="button" className="icon-button" disabled={busy} onClick={() => setEditor(null)}>×</button>
            </div>
            <div className="reminder-editor-fields">
              <label className="full-field">Reminder<input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What should not be forgotten?" /></label>
              <label>Date<input type="date" min={boardDate || undefined} value={reminderDate} onChange={(event) => setReminderDate(event.target.value)} /></label>
              <label className="full-field">Note<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context" /></label>
            </div>
            {error && <p className="form-message error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
              <button className="primary-button" type="button" disabled={busy || !title.trim() || !reminderDate} onClick={() => void save()}>{busy ? "Saving…" : editor.reminder ? "Save reminder" : "Add reminder"}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
