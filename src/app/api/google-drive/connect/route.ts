import { NextResponse } from "next/server";
import {
  adminSupabase,
  createGoogleOAuthState,
  googleAuthorizationUrl,
  googleRedirectUri,
  requireWorkspaceMembership,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { workspaceId?: string };
    if (!body.workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    const { userId } = await requireWorkspaceMembership(request, body.workspaceId, { ownerOnly: true });
    const origin = new URL(request.url).origin;
    const state = createGoogleOAuthState({ workspaceId: body.workspaceId, userId });
    return NextResponse.json({
      url: googleAuthorizationUrl({ state, redirectUri: googleRedirectUri(origin) }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start Google Drive connection." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { workspaceId?: string };
    if (!body.workspaceId) return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    await requireWorkspaceMembership(request, body.workspaceId, { ownerOnly: true });
    const admin = adminSupabase();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("storage_connections")
      .update({ revoked_at: now })
      .eq("workspace_id", body.workspaceId)
      .eq("provider", "google_drive");
    if (error) throw new Error(error.message);

    await admin
      .from("project_file_spaces")
      .update({ provider: "supabase", external_folder_id: null, external_folder_url: null })
      .eq("workspace_id", body.workspaceId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not disconnect Google Drive." }, { status: 400 });
  }
}
