"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabaseClient } from "@/lib/supabase";

type DriveStatus = {
  provider: string;
  account_email: string | null;
  root_folder_url: string | null;
  connected_at: string;
};

async function authHeaders() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase is not connected.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your TBFT session expired.");
  return { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" };
}

export default function GoogleDriveSettings() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const inspect = () => setTarget(document.querySelector<HTMLElement>(".settings-grid"));
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const load = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!membership) return;
    setWorkspaceId(membership.workspace_id);
    setRole(String(membership.role));

    const { data, error } = await supabase.rpc("storage_connection_status", {
      target_workspace: membership.workspace_id,
    });
    if (error) {
      setMessage(error.message.includes("storage_connection_status")
        ? "Run google-drive-storage-v1.sql in Supabase before connecting Drive."
        : error.message);
      return;
    }
    const connection = ((data ?? []) as DriveStatus[]).find((item) => item.provider === "google_drive") ?? null;
    setStatus(connection);
  };

  useEffect(() => {
    if (!target) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "connected") setMessage("Google Drive connected. TBFT is syncing the folder hierarchy.");
    if (params.get("drive") === "error") setMessage(params.get("message") ?? "Google Drive connection failed.");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const connect = async () => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/google-drive/connect", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId }),
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "Could not start Google authorization.");
      window.location.href = body.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/google-drive/sync", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId }),
      });
      const body = await response.json() as { synced?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not sync Drive folders.");
      setMessage(`${body.synced ?? 0} TBFT folder${body.synced === 1 ? "" : "s"} synced with Google Drive.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!workspaceId || busy) return;
    if (!window.confirm("Disconnect Google Drive from this TBFT workspace? Existing Drive files stay in Google Drive.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/google-drive/connect", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not disconnect Google Drive.");
      setStatus(null);
      setMessage("Google Drive disconnected. Existing Drive files were not deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;

  return createPortal(
    <div className="settings-card google-drive-card">
      <span className="eyebrow">DOCUMENT STORAGE</span>
      <div className="google-drive-heading">
        <div>
          <h3>Google Drive</h3>
          <p>File bytes live in Drive. Supabase keeps only TBFT metadata, folder links, and history.</p>
        </div>
        <span className={status ? "drive-status connected" : "drive-status"}>{status ? "Connected" : "Not connected"}</span>
      </div>

      {status ? (
        <div className="google-drive-connection">
          <div><span>Account</span><strong>{status.account_email ?? "Google account"}</strong></div>
          <div><span>Root folder</span><strong>TBFT</strong></div>
        </div>
      ) : (
        <p className="settings-note">Connect one Google account for the workspace. TBFT will create its own root folder and mirror project/task folders underneath it.</p>
      )}

      {message && <p className="google-drive-message">{message}</p>}

      <div className="settings-actions-row google-drive-actions">
        {status?.root_folder_url && (
          <button className="secondary-button" type="button" onClick={() => window.open(status.root_folder_url ?? "", "_blank", "noopener,noreferrer")}>Open Drive folder</button>
        )}
        {status && <button className="secondary-button" type="button" disabled={busy} onClick={() => void sync()}>{busy ? "Working…" : "Sync folders"}</button>}
        {role === "owner" && (
          <button className="primary-button" type="button" disabled={busy} onClick={() => void connect()}>
            {status ? "Reconnect Drive" : "Connect Google Drive"}
          </button>
        )}
        {role === "owner" && status && (
          <button className="danger-button subtle-danger" type="button" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
        )}
      </div>
      {role !== "owner" && !status && <p className="settings-note">The workspace owner needs to connect Google Drive once for the team.</p>}
    </div>,
    target,
  );
}
