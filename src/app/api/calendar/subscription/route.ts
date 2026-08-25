import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { addDays, getBoardDate } from "@/lib/date";
import { adminSupabase, requireTbftUser } from "@/lib/googleDriveServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedTokenRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  token_value: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  original_date: string;
  deadline: string | null;
  priority: string;
  project_id: string | null;
  completed_at: string | null;
  updated_at: string;
};

type ProjectRow = { id: string; name: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function icsEscape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function dateCompact(value: string): string {
  return value.replaceAll("-", "");
}

function utcStamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const dayOffset = Math.floor(total / (24 * 60));
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    date: dayOffset ? addDays(date, dayOffset) : date,
    time: `${String(Math.floor(wrapped / 60)).padStart(2, "0")}${String(wrapped % 60).padStart(2, "0")}00`,
  };
}

function eventLines(input: {
  task: TaskRow;
  eventDate: string;
  timezone: string;
  projectName?: string;
}): string[] {
  const { task, eventDate, timezone, projectName } = input;
  const descriptionParts = [task.description?.trim() || ""];
  if (projectName) descriptionParts.push(`Project: ${projectName}`);
  descriptionParts.push(`Priority: ${task.priority}`);
  if (task.completed_at) descriptionParts.push("Status: Completed");
  const description = descriptionParts.filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:tbft-task-${task.id}@tbft.marzan.info`,
    `DTSTAMP:${utcStamp(task.updated_at || new Date())}`,
    `LAST-MODIFIED:${utcStamp(task.updated_at || new Date())}`,
    `SUMMARY:${icsEscape(task.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "CATEGORIES:TBFT",
    `X-TBFT-TASK-ID:${task.id}`,
  ];

  if (task.deadline) {
    const startTime = `${task.deadline.slice(0, 5).replace(":", "")}00`;
    const end = addMinutes(eventDate, task.deadline, 30);
    lines.push(`DTSTART;TZID=${timezone}:${dateCompact(eventDate)}T${startTime}`);
    lines.push(`DTEND;TZID=${timezone}:${dateCompact(end.date)}T${end.time}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateCompact(eventDate)}`);
    lines.push(`DTEND;VALUE=DATE:${dateCompact(addDays(eventDate, 1))}`);
  }

  if (task.completed_at) lines.push("X-TBFT-STATUS:COMPLETED");
  lines.push("END:VEVENT");
  return lines;
}

async function activeMembership(userId: string, requestedWorkspaceId?: string): Promise<string> {
  const admin = adminSupabase();
  let query = admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1);
  if (requestedWorkspaceId) query = query.eq("workspace_id", requestedWorkspaceId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("Workspace membership not found.");
  return data.workspace_id as string;
}

export async function POST(request: Request) {
  try {
    const userId = await requireTbftUser(request);
    const body = await request.json().catch(() => ({})) as { workspaceId?: string };
    const workspaceId = await activeMembership(userId, body.workspaceId);
    const admin = adminSupabase();

    const { data: existing, error: existingError } = await admin
      .from("calendar_feed_tokens")
      .select("id, workspace_id, user_id, token_value")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (existingError) throw existingError;

    let token = (existing as FeedTokenRow | null)?.token_value ?? null;
    if (!token) {
      token = randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      if (existing) {
        const { error } = await admin
          .from("calendar_feed_tokens")
          .update({ token_hash: tokenHash, token_value: token })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("calendar_feed_tokens").insert({
          workspace_id: workspaceId,
          user_id: userId,
          token_hash: tokenHash,
          token_value: token,
        });
        if (error) throw error;
      }
    }

    const origin = new URL(request.url).origin;
    const feedUrl = `${origin}/api/calendar/subscription?token=${encodeURIComponent(token)}`;
    return NextResponse.json({ feedUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Calendar subscription could not be created." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireTbftUser(request);
    const body = await request.json().catch(() => ({})) as { workspaceId?: string };
    const workspaceId = await activeMembership(userId, body.workspaceId);
    const { error } = await adminSupabase()
      .from("calendar_feed_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Calendar subscription could not be reset." },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token || token.length < 24) return new Response("Calendar not found.", { status: 404 });

  try {
    const admin = adminSupabase();
    const { data: tokenRow, error: tokenError } = await admin
      .from("calendar_feed_tokens")
      .select("workspace_id, user_id")
      .eq("token_hash", hashToken(token))
      .is("revoked_at", null)
      .maybeSingle();
    if (tokenError || !tokenRow) return new Response("Calendar not found.", { status: 404 });

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("name, timezone, rollover_hour")
      .eq("id", tokenRow.workspace_id)
      .single();
    if (workspaceError || !workspace) throw workspaceError ?? new Error("Workspace not found.");

    const timezone = String(workspace.timezone || "Europe/Berlin");
    const rolloverHour = Number(workspace.rollover_hour ?? 0);
    const boardDate = getBoardDate(timezone, rolloverHour);

    const { data: taskRows, error: taskError } = await admin
      .from("tasks")
      .select("id,title,description,original_date,deadline,priority,project_id,completed_at,updated_at")
      .eq("workspace_id", tokenRow.workspace_id)
      .eq("owner_user_id", tokenRow.user_id)
      .eq("recurrence_type", "none")
      .is("recurrence_source_id", null)
      .is("deleted_at", null)
      .order("original_date", { ascending: true });
    if (taskError) throw taskError;

    const tasks = ((taskRows ?? []) as TaskRow[]).filter((task) => {
      if (task.original_date >= boardDate) return true;
      if (!task.completed_at) return true;
      return getBoardDate(timezone, rolloverHour, new Date(task.completed_at)) === boardDate;
    });

    const projectIds = Array.from(new Set(tasks.map((task) => task.project_id).filter((id): id is string => Boolean(id))));
    const { data: projectRows, error: projectError } = projectIds.length
      ? await admin.from("projects").select("id,name").in("id", projectIds)
      : { data: [] as ProjectRow[], error: null };
    if (projectError) throw projectError;
    const projectMap = new Map(((projectRows ?? []) as ProjectRow[]).map((project) => [project.id, project.name]));

    const calendarName = `${String(workspace.name || "TBFT")} — My tasks`;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TBFT//Task Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${icsEscape(calendarName)}`,
      `X-WR-TIMEZONE:${timezone}`,
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];

    for (const task of tasks) {
      const eventDate = task.original_date >= boardDate ? task.original_date : boardDate;
      lines.push(...eventLines({
        task,
        eventDate,
        timezone,
        projectName: task.project_id ? projectMap.get(task.project_id) : undefined,
      }));
    }
    lines.push("END:VCALENDAR", "");

    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="tbft-tasks.ics"',
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response("Calendar feed is temporarily unavailable.", { status: 503 });
  }
}
