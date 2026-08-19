import { NextResponse } from "next/server";
import { adminSupabase, initiateGoogleDriveUpload, requireWorkspaceMembership } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      workspaceId?: string;
      fileSpaceId?: string;
      name?: string;
      mimeType?: string;
      size?: number;
    };
    if (!body.workspaceId || !body.fileSpaceId || !body.name || body.size == null) {
      return NextResponse.json({ error: "workspaceId, fileSpaceId, name, and size are required." }, { status: 400 });
    }

    await requireWorkspaceMembership(request, body.workspaceId);
    const admin = adminSupabase();
    const { data: space, error } = await admin
      .from("project_file_spaces")
      .select("id, workspace_id")
      .eq("id", body.fileSpaceId)
      .eq("workspace_id", body.workspaceId)
      .maybeSingle();
    if (error || !space) return NextResponse.json({ error: "TBFT file space was not found." }, { status: 404 });

    const uploadUrl = await initiateGoogleDriveUpload({
      workspaceId: body.workspaceId,
      fileSpaceId: body.fileSpaceId,
      name: body.name,
      mimeType: body.mimeType || "application/octet-stream",
      size: Number(body.size),
    });

    return NextResponse.json({ uploadUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start Google Drive upload." }, { status: 400 });
  }
}
