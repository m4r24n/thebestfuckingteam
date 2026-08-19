import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBoardDate } from "@/lib/date";

export const dynamic = "force-dynamic";

type WidgetRequest = {
  refreshToken?: string;
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return noStoreJson({ error: "Supabase is not configured." }, 503);
  }

  let body: WidgetRequest;
  try {
    body = (await request.json()) as WidgetRequest;
  } catch {
    return noStoreJson({ error: "Invalid request body." }, 400);
  }

  const refreshToken = body.refreshToken?.trim();
  if (!refreshToken) {
    return noStoreJson({ error: "Missing widget session." }, 401);
  }

  const authClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: refreshData, error: refreshError } = await authClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  const session = refreshData.session;
  if (refreshError || !session?.access_token || !session.user) {
    return noStoreJson({ error: "Your TBFT login needs to be refreshed. Open the app and sign in again." }, 401);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const userId = session.user.id;
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) return noStoreJson({ error: membershipError.message }, 500);
  if (!membership) {
    return noStoreJson({
      boardDate: null,
      count: 0,
      tasks: [],
      refreshToken: session.refresh_token,
    });
  }

  const workspaceId = membership.workspace_id as string;
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("timezone, rollover_hour")
    .eq("id", workspaceId)
    .single();

  if (workspaceError || !workspace) {
    return noStoreJson({ error: workspaceError?.message ?? "Workspace not found." }, 500);
  }

  const timezone = workspace.timezone as string;
  const rolloverHour = Number(workspace.rollover_hour);
  const boardDate = getBoardDate(timezone, rolloverHour);

  // Ensure today's carried-task appearances exist before reading the board.
  const { error: rolloverError } = await supabase.rpc("repair_workspace_rollovers", {
    target_workspace: workspaceId,
    target_board_date: boardDate,
  });
  if (rolloverError) {
    return noStoreJson({ error: rolloverError.message }, 500);
  }

  const { data: appearances, error: appearanceError } = await supabase
    .from("task_day_appearances")
    .select("task_id, appearance_type")
    .eq("board_date", boardDate);

  if (appearanceError) return noStoreJson({ error: appearanceError.message }, 500);

  const appearanceByTask = new Map(
    (appearances ?? []).map((row) => [row.task_id as string, row.appearance_type as string]),
  );
  const taskIds = Array.from(appearanceByTask.keys());

  if (!taskIds.length) {
    return noStoreJson({
      boardDate,
      timezone,
      count: 0,
      tasks: [],
      refreshToken: session.refresh_token,
    });
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, priority, deadline, original_date, owner_user_id, completed_at, deleted_at")
    .in("id", taskIds)
    .eq("owner_user_id", userId)
    .is("completed_at", null)
    .is("deleted_at", null);

  if (taskError) return noStoreJson({ error: taskError.message }, 500);

  const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const tasks = (taskRows ?? [])
    .map((row) => ({
      id: row.id as string,
      title: row.title as string,
      priority: row.priority as string,
      deadline: row.deadline ? String(row.deadline).slice(0, 5) : null,
      carried: appearanceByTask.get(row.id as string) === "carried",
      originalDate: row.original_date as string,
    }))
    .sort((a, b) => {
      const byPriority = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (byPriority !== 0) return byPriority;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.title.localeCompare(b.title);
    });

  return noStoreJson({
    boardDate,
    timezone,
    count: tasks.length,
    tasks,
    refreshToken: session.refresh_token,
  });
}
