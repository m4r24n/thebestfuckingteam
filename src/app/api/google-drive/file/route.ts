import { NextResponse } from "next/server";
import { adminSupabase, removeGoogleDriveFile, requireWorkspaceMembership } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { metadataId?: string };
    if (!body.metadataId) return NextResponse.json({ error: "metadataId is required." }, { status: 400 });

    const admin = adminSupabase();
    const { data: file, error } = await admin
      .from("project_files")
      .select("id, workspace_id, provider, external_file_id")
      .eq("id", body.metadataId)
      .maybeSingle();
    if (error || !file) return NextResponse.json({ error: "TBFT file metadata was not found." }, { status: 404 });

    await requireWorkspaceMembership(request, file.workspace_id);
    if (file.provider !== "google_drive" || !file.external_file_id) {
      return NextResponse.json({ error: "This file is not stored in Google Drive." }, { status: 400 });
    }

    await removeGoogleDriveFile(file.workspace_id, file.external_file_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove Google Drive file." }, { status: 400 });
  }
}
