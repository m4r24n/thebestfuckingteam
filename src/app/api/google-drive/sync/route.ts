import { NextResponse } from "next/server";
import { requireWorkspaceMembership, syncGoogleDriveHierarchy } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { workspaceId?: string };
    if (!body.workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    await requireWorkspaceMembership(request, body.workspaceId);
    const synced = await syncGoogleDriveHierarchy(body.workspaceId);
    return NextResponse.json({ ok: true, synced });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync Google Drive folders." }, { status: 400 });
  }
}
