import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type ConnectionRow = {
  workspace_id: string;
  provider: "google_drive";
  connected_by: string;
  account_email: string | null;
  refresh_token_ciphertext: string;
  root_folder_id: string;
  root_folder_url: string | null;
  revoked_at: string | null;
};

type FileSpaceRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_id: string | null;
  parent_space_id: string | null;
  kind: "project" | "lonely_root" | "task";
  label: string;
  provider: string;
  external_folder_id: string | null;
  external_folder_url: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function publicSupabase(): SupabaseClient {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("Supabase publishable key is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function adminSupabase(): SupabaseClient {
  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serverSecretKey(purpose: string): Buffer {
  return createHash("sha256")
    .update(`${purpose}:${requiredEnv("GOOGLE_DRIVE_SERVER_SECRET")}`)
    .digest();
}

export function encryptGoogleRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", serverSecretKey("token"), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptGoogleRefreshToken(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Google Drive credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", serverSecretKey("token"), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function bearerToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) throw new Error("You must be signed in.");
  return auth.slice(7).trim();
}

export async function requireTbftUser(request: Request): Promise<string> {
  const { data, error } = await publicSupabase().auth.getUser(bearerToken(request));
  if (error || !data.user) throw new Error("Your TBFT session is not valid.");
  return data.user.id;
}

export async function requireWorkspaceMembership(
  request: Request,
  workspaceId: string,
  options: { ownerOnly?: boolean } = {},
): Promise<{ userId: string; role: string }> {
  const userId = await requireTbftUser(request);
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("You are not a member of this workspace.");
  if (options.ownerOnly && data.role !== "owner") throw new Error("Only the workspace owner can change cloud storage.");
  return { userId, role: String(data.role) };
}

export function googleRedirectUri(origin: string): string {
  return process.env.GOOGLE_DRIVE_REDIRECT_URI ?? `${origin}/api/google-drive/callback`;
}

export function createGoogleOAuthState(input: { workspaceId: string; userId: string }): string {
  const payload = Buffer.from(JSON.stringify({ ...input, issuedAt: Date.now(), nonce: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", serverSecretKey("state")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(state: string): { workspaceId: string; userId: string } {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("Google authorization state is invalid.");
  const expected = createHmac("sha256", serverSecretKey("state")).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Google authorization state could not be verified.");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    workspaceId?: string;
    userId?: string;
    issuedAt?: number;
  };
  if (!parsed.workspaceId || !parsed.userId || !parsed.issuedAt || Date.now() - parsed.issuedAt > 10 * 60 * 1000) {
    throw new Error("Google authorization state has expired.");
  }
  return { workspaceId: parsed.workspaceId, userId: parsed.userId };
}

export function googleAuthorizationUrl(input: { state: string; redirectUri: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requiredEnv("GOOGLE_DRIVE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive.file");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_DRIVE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(body.error_description ?? "Google did not return an offline Drive credential.");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function googleAccountEmail(accessToken: string): Promise<string | null> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const body = await response.json() as { email?: string };
  return body.email ?? null;
}

async function driveFetch(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json; charset=UTF-8" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return response;
}

async function refreshAccessToken(connection: ConnectionRow): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decryptGoogleRefreshToken(connection.refresh_token_ciphertext),
      client_id: requiredEnv("GOOGLE_DRIVE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description ?? "Google Drive connection needs to be reconnected.");
  return body.access_token;
}

export async function getGoogleDriveConnection(workspaceId: string): Promise<ConnectionRow> {
  const { data, error } = await adminSupabase()
    .from("storage_connections")
    .select("workspace_id, provider, connected_by, account_email, refresh_token_ciphertext, root_folder_id, root_folder_url, revoked_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google_drive")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Google Drive is not connected to this TBFT workspace yet.");
  return data as ConnectionRow;
}

export async function googleAccessForWorkspace(workspaceId: string): Promise<{ connection: ConnectionRow; accessToken: string }> {
  const connection = await getGoogleDriveConnection(workspaceId);
  return { connection, accessToken: await refreshAccessToken(connection) };
}

async function lookupRootByWorkspace(accessToken: string, workspaceId: string): Promise<{ id: string; webViewLink?: string } | null> {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='tbftWorkspaceId' and value='${workspaceId}' } and appProperties has { key='tbftRoot' and value='true' }`;
  const response = await driveFetch(accessToken, `/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=files(id,name,webViewLink)`);
  const body = await response.json() as { files?: Array<{ id: string; webViewLink?: string }> };
  return body.files?.[0] ?? null;
}

export async function ensureGoogleDriveRoot(
  accessToken: string,
  workspaceId: string,
  existingRootId?: string | null,
): Promise<{ id: string; webViewLink: string }> {
  if (existingRootId) {
    try {
      const response = await driveFetch(accessToken, `/files/${encodeURIComponent(existingRootId)}?fields=id,name,mimeType,trashed,webViewLink`);
      const file = await response.json() as { id: string; mimeType?: string; trashed?: boolean; webViewLink?: string };
      if (file.mimeType === FOLDER_MIME && !file.trashed) {
        return { id: file.id, webViewLink: file.webViewLink ?? `https://drive.google.com/drive/folders/${file.id}` };
      }
    } catch {
      // Reconnects can legitimately lose access to an old root. Create/find a new one below.
    }
  }

  const existing = await lookupRootByWorkspace(accessToken, workspaceId);
  if (existing) return { id: existing.id, webViewLink: existing.webViewLink ?? `https://drive.google.com/drive/folders/${existing.id}` };

  const response = await driveFetch(accessToken, "/files?fields=id,name,webViewLink", {
    method: "POST",
    body: JSON.stringify({
      name: "TBFT",
      mimeType: FOLDER_MIME,
      parents: ["root"],
      appProperties: { tbftWorkspaceId: workspaceId, tbftRoot: "true" },
    }),
  });
  const created = await response.json() as { id: string; webViewLink?: string };
  return { id: created.id, webViewLink: created.webViewLink ?? `https://drive.google.com/drive/folders/${created.id}` };
}

async function findSpaceFolder(accessToken: string, spaceId: string): Promise<{ id: string; webViewLink?: string } | null> {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='tbftSpaceId' and value='${spaceId}' }`;
  const response = await driveFetch(accessToken, `/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=files(id,name,webViewLink)`);
  const body = await response.json() as { files?: Array<{ id: string; webViewLink?: string }> };
  return body.files?.[0] ?? null;
}

async function alignExistingFolder(
  accessToken: string,
  folderId: string,
  desiredName: string,
  desiredParentId: string,
): Promise<{ id: string; webViewLink?: string } | null> {
  try {
    const response = await driveFetch(
      accessToken,
      `/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed,parents,webViewLink`,
    );
    let folder = await response.json() as {
      id: string;
      name?: string;
      mimeType?: string;
      trashed?: boolean;
      parents?: string[];
      webViewLink?: string;
    };
    if (folder.mimeType !== FOLDER_MIME || folder.trashed) return null;

    const needsRename = folder.name !== desiredName;
    const currentParents = folder.parents ?? [];
    const needsMove = !currentParents.includes(desiredParentId);
    if (needsRename || needsMove) {
      const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(folder.id)}`);
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("fields", "id,name,parents,webViewLink");
      if (needsMove) {
        url.searchParams.set("addParents", desiredParentId);
        if (currentParents.length) url.searchParams.set("removeParents", currentParents.join(","));
      }
      const update = await fetch(url, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(needsRename ? { name: desiredName } : {}),
      });
      if (!update.ok) throw new Error(`Google Drive could not align folder ${folder.id} (${update.status}).`);
      folder = await update.json() as typeof folder;
    }

    return { id: folder.id, webViewLink: folder.webViewLink };
  } catch {
    return null;
  }
}

export async function ensureGoogleDriveFolderForSpace(
  admin: SupabaseClient,
  accessToken: string,
  rootFolderId: string,
  spaceId: string,
  visiting = new Set<string>(),
): Promise<string> {
  if (visiting.has(spaceId)) throw new Error("File-space hierarchy contains a cycle.");
  visiting.add(spaceId);

  const { data, error } = await admin
    .from("project_file_spaces")
    .select("id, workspace_id, project_id, task_id, parent_space_id, kind, label, provider, external_folder_id, external_folder_url")
    .eq("id", spaceId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "TBFT file space was not found.");
  const space = data as FileSpaceRow;

  const parentFolderId = space.parent_space_id
    ? await ensureGoogleDriveFolderForSpace(admin, accessToken, rootFolderId, space.parent_space_id, visiting)
    : rootFolderId;

  let folder = space.external_folder_id
    ? await alignExistingFolder(accessToken, space.external_folder_id, space.label, parentFolderId)
    : null;

  if (!folder) {
    const found = await findSpaceFolder(accessToken, space.id);
    folder = found
      ? await alignExistingFolder(accessToken, found.id, space.label, parentFolderId)
      : null;
  }

  if (!folder) {
    const response = await driveFetch(accessToken, "/files?fields=id,name,webViewLink", {
      method: "POST",
      body: JSON.stringify({
        name: space.label,
        mimeType: FOLDER_MIME,
        parents: [parentFolderId],
        appProperties: {
          tbftSpaceId: space.id,
          tbftWorkspaceId: space.workspace_id,
          tbftKind: space.kind,
        },
      }),
    });
    folder = await response.json() as { id: string; webViewLink?: string };
  }

  await admin
    .from("project_file_spaces")
    .update({
      provider: "google_drive",
      external_folder_id: folder.id,
      external_folder_url: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`,
    })
    .eq("id", space.id);

  visiting.delete(spaceId);
  return folder.id;
}

export async function syncGoogleDriveHierarchy(
  workspaceId: string,
  accessToken?: string,
  rootFolderId?: string,
): Promise<number> {
  const admin = adminSupabase();
  let token = accessToken;
  let root = rootFolderId;
  if (!token || !root) {
    const resolved = await googleAccessForWorkspace(workspaceId);
    token = resolved.accessToken;
    root = resolved.connection.root_folder_id;
  }

  const { data, error } = await admin
    .from("project_file_spaces")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  let synced = 0;
  for (const row of data ?? []) {
    await ensureGoogleDriveFolderForSpace(admin, token, root, row.id);
    synced += 1;
  }
  return synced;
}

export async function shareGoogleDriveRootWithWorkspace(
  workspaceId: string,
  rootFolderId: string,
  accessToken: string,
  ownerGoogleEmail: string | null,
): Promise<void> {
  const admin = adminSupabase();
  const { data: members } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId);
  for (const member of members ?? []) {
    const { data } = await admin.auth.admin.getUserById(member.user_id);
    const email = data.user?.email;
    if (!email || email.toLowerCase() === ownerGoogleEmail?.toLowerCase()) continue;
    try {
      await driveFetch(accessToken, `/files/${encodeURIComponent(rootFolderId)}/permissions?sendNotificationEmail=false&fields=id`, {
        method: "POST",
        body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
      });
    } catch {
      // Sharing can be blocked by Google Workspace policy or already exist. The owner can
      // still share the TBFT root manually without breaking TBFT's server-side access.
    }
  }
}

export async function initiateGoogleDriveUpload(input: {
  workspaceId: string;
  fileSpaceId: string;
  name: string;
  mimeType: string;
  size: number;
}): Promise<string> {
  const admin = adminSupabase();
  const { connection, accessToken } = await googleAccessForWorkspace(input.workspaceId);
  const folderId = await ensureGoogleDriveFolderForSpace(admin, accessToken, connection.root_folder_id, input.fileSpaceId);
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,mimeType,size,webViewLink,webContentLink,parents");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": input.mimeType || "application/octet-stream",
      "x-upload-content-length": String(input.size),
    },
    body: JSON.stringify({
      name: input.name,
      parents: [folderId],
      appProperties: { tbftWorkspaceId: input.workspaceId, tbftSpaceId: input.fileSpaceId },
    }),
  });
  if (!response.ok) throw new Error(`Google Drive could not start the upload (${response.status}).`);
  const location = response.headers.get("location");
  if (!location) throw new Error("Google Drive did not return an upload session URL.");
  return location;
}

export async function removeGoogleDriveFile(workspaceId: string, driveFileId: string): Promise<void> {
  const { accessToken } = await googleAccessForWorkspace(workspaceId);
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(driveFileId)}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Google Drive could not delete the file (${response.status}).`);
  }
}
