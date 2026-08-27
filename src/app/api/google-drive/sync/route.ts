import { NextResponse } from "next/server";
import {
  adminSupabase,
  ensureGoogleDriveFolderForSpace,
  googleAccessForWorkspace,
  requireWorkspaceMembership,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const INCREMENTAL_BATCH_SIZE = 16;
const FULL_BATCH_SIZE = 6;

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      workspaceId?: string;
      mode?: "incremental" | "full";
      offset?: number;
    };
    if (!body.workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    await requireWorkspaceMembership(request, body.workspaceId);

    const mode = body.mode === "full" ? "full" : "incremental";
    const batchSize = mode === "full" ? FULL_BATCH_SIZE : INCREMENTAL_BATCH_SIZE;
    const offset = mode === "full" ? Math.max(0, Number(body.offset ?? 0)) : 0;
    const admin = adminSupabase();
    const { connection, accessToken } = await googleAccessForWorkspace(body.workspaceId);

    let query = admin
      .from("project_file_spaces")
      .select("id", { count: "exact" })
      .eq("workspace_id", body.workspaceId)
      .order("created_at", { ascending: true });

    if (mode === "incremental") query = query.is("external_folder_id", null);

    const { data, error, count } = await query.range(offset, offset + batchSize - 1);
    if (error) throw new Error(error.message);

    let synced = 0;
    for (const row of data ?? []) {
      await ensureGoogleDriveFolderForSpace(
        admin,
        accessToken,
        connection.root_folder_id,
        row.id as string,
      );
      synced += 1;
    }

    const total = count ?? synced;
    const nextOffset = mode === "full" ? offset + synced : 0;
    const hasMore = mode === "full"
      ? nextOffset < total
      : total > synced;

    return NextResponse.json({
      ok: true,
      synced,
      total,
      hasMore,
      nextOffset: mode === "full" ? nextOffset : undefined,
      mode,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync Google Drive folders." }, { status: 400 });
  }
}
