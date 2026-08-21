import { NextResponse } from "next/server";
import { adminSupabase, googleAccessForWorkspace, requireWorkspaceMembership } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
  createdTime?: string;
  appProperties?: Record<string, string>;
};

type SpaceRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { workspaceId?: string };
    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const membership = await requireWorkspaceMembership(request, body.workspaceId);
    const { accessToken } = await googleAccessForWorkspace(body.workspaceId);
    const admin = adminSupabase();

    const q = `trashed=false and mimeType!='${FOLDER_MIME}' and appProperties has { key='tbftWorkspaceId' and value='${body.workspaceId}' }`;
    const files: DriveFile[] = [];
    let pageToken = "";

    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", q);
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,webViewLink,createdTime,appProperties)");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google Drive reconciliation failed (${response.status}): ${text.slice(0, 400)}`);
      }
      const payload = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(payload.files ?? []));
      pageToken = payload.nextPageToken ?? "";
    } while (pageToken);

    const tagged = files.filter((file) => file.appProperties?.tbftSpaceId);
    if (!tagged.length) return NextResponse.json({ recovered: 0, files: [] });

    const spaceIds = [...new Set(tagged.map((file) => file.appProperties?.tbftSpaceId).filter(Boolean))] as string[];
    const { data: spaces, error: spacesError } = await admin
      .from("project_file_spaces")
      .select("id, workspace_id, project_id, task_id")
      .eq("workspace_id", body.workspaceId)
      .in("id", spaceIds);
    if (spacesError) throw new Error(spacesError.message);

    const spaceById = new Map((spaces ?? []).map((row) => [row.id as string, row as SpaceRow]));
    const driveIds = tagged.map((file) => file.id);
    const { data: existingRows, error: existingError } = await admin
      .from("project_files")
      .select("external_file_id")
      .eq("workspace_id", body.workspaceId)
      .in("external_file_id", driveIds);
    if (existingError) throw new Error(existingError.message);
    const existing = new Set((existingRows ?? []).map((row) => row.external_file_id as string).filter(Boolean));

    const inserts = tagged.flatMap((file) => {
      if (existing.has(file.id)) return [];
      const spaceId = file.appProperties?.tbftSpaceId;
      if (!spaceId) return [];
      const space = spaceById.get(spaceId);
      if (!space) return [];
      return [{
        workspace_id: body.workspaceId,
        project_id: space.project_id,
        task_id: space.task_id,
        file_space_id: space.id,
        provider: "google_drive",
        storage_path: null,
        external_file_id: file.id,
        external_file_url: file.webViewLink ?? `https://drive.google.com/open?id=${file.id}`,
        original_name: file.name || "Recovered Drive file",
        mime_type: file.mimeType ?? null,
        size_bytes: file.size == null ? null : Number(file.size),
        uploaded_by: membership.userId,
        ...(file.createdTime ? { created_at: file.createdTime } : {}),
      }];
    });

    if (!inserts.length) return NextResponse.json({ recovered: 0, files: [] });

    const { data: recoveredRows, error: insertError } = await admin
      .from("project_files")
      .insert(inserts)
      .select("id, original_name, project_id, task_id, file_space_id, external_file_id");
    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({
      recovered: recoveredRows?.length ?? 0,
      files: recoveredRows ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not reconcile Google Drive files." },
      { status: 400 },
    );
  }
}
