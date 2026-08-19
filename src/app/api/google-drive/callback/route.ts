import { NextResponse } from "next/server";
import {
  adminSupabase,
  encryptGoogleRefreshToken,
  ensureGoogleDriveRoot,
  exchangeGoogleCode,
  googleAccountEmail,
  googleRedirectUri,
  shareGoogleDriveRootWithWorkspace,
  syncGoogleDriveHierarchy,
  verifyGoogleOAuthState,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  try {
    const providerError = url.searchParams.get("error");
    if (providerError) throw new Error(`Google authorization was cancelled or denied (${providerError}).`);
    const code = url.searchParams.get("code");
    const stateText = url.searchParams.get("state");
    if (!code || !stateText) throw new Error("Google authorization callback is incomplete.");

    const state = verifyGoogleOAuthState(stateText);
    const admin = adminSupabase();
    const { data: membership } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", state.workspaceId)
      .eq("user_id", state.userId)
      .maybeSingle();
    if (!membership || membership.role !== "owner") throw new Error("Only the workspace owner can connect Google Drive.");

    const { data: previous } = await admin
      .from("storage_connections")
      .select("root_folder_id")
      .eq("workspace_id", state.workspaceId)
      .eq("provider", "google_drive")
      .maybeSingle();

    const tokens = await exchangeGoogleCode(code, googleRedirectUri(origin));
    const accountEmail = await googleAccountEmail(tokens.accessToken);
    const root = await ensureGoogleDriveRoot(tokens.accessToken, state.workspaceId, previous?.root_folder_id ?? null);

    const { error: upsertError } = await admin
      .from("storage_connections")
      .upsert({
        workspace_id: state.workspaceId,
        provider: "google_drive",
        connected_by: state.userId,
        account_email: accountEmail,
        refresh_token_ciphertext: encryptGoogleRefreshToken(tokens.refreshToken),
        root_folder_id: root.id,
        root_folder_url: root.webViewLink,
        revoked_at: null,
      }, { onConflict: "workspace_id,provider" });
    if (upsertError) throw new Error(upsertError.message);

    await shareGoogleDriveRootWithWorkspace(state.workspaceId, root.id, tokens.accessToken, accountEmail);
    await syncGoogleDriveHierarchy(state.workspaceId, tokens.accessToken, root.id);

    return NextResponse.redirect(new URL("/?drive=connected", origin));
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Google Drive connection failed.");
    return NextResponse.redirect(new URL(`/?drive=error&message=${message}`, origin));
  }
}
