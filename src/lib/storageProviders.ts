import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectFile, StorageProvider } from "@/lib/types";

export type StoredObject = {
  storagePath?: string;
  externalFileId?: string;
  externalFileUrl?: string;
};

export interface StorageProviderAdapter {
  readonly id: StorageProvider;
  upload(input: { workspaceId: string; fileSpaceId: string; file: File }): Promise<StoredObject>;
  createOpenUrl(file: ProjectFile, expiresInSeconds?: number): Promise<string>;
  remove(file: ProjectFile): Promise<void>;
}

export class StorageProviderNotConfiguredError extends Error {
  constructor(provider: StorageProvider) {
    const label = provider === "supabase"
      ? "External cloud storage"
      : provider.replaceAll("_", " ");
    super(`${label} is not connected yet. TBFT keeps file metadata in Supabase, but new document bytes must be stored in a connected external provider.`);
    this.name = "StorageProviderNotConfiguredError";
  }
}

async function sessionAccessToken(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your TBFT session expired. Sign in again.");
  return data.session.access_token;
}

/**
 * Supabase Storage remains readable/removable for files uploaded during the prototype
 * phase, but TBFT no longer sends NEW document bytes there. Supabase is the metadata
 * database; real document storage belongs to a connected external provider.
 */
class SupabaseStorageProvider implements StorageProviderAdapter {
  readonly id: StorageProvider = "supabase";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async upload(): Promise<StoredObject> {
    throw new StorageProviderNotConfiguredError("supabase");
  }

  async createOpenUrl(file: ProjectFile, expiresInSeconds = 300): Promise<string> {
    if (!file.storagePath) throw new Error("File storage path is missing.");
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(file.storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not open this file.");
    return data.signedUrl;
  }

  async remove(file: ProjectFile): Promise<void> {
    if (!file.storagePath) return;
    const { error } = await this.supabase.storage.from(this.bucket).remove([file.storagePath]);
    if (error) throw new Error(error.message);
  }
}

class GoogleDriveStorageProvider implements StorageProviderAdapter {
  readonly id: StorageProvider = "google_drive";

  constructor(private readonly supabase: SupabaseClient) {}

  async upload(input: { workspaceId: string; fileSpaceId: string; file: File }): Promise<StoredObject> {
    const token = await sessionAccessToken(this.supabase);
    const start = await fetch("/api/google-drive/upload-session", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        fileSpaceId: input.fileSpaceId,
        name: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        size: input.file.size,
      }),
    });
    const startBody = await start.json() as { uploadUrl?: string; error?: string };
    if (!start.ok || !startBody.uploadUrl) {
      throw new Error(startBody.error ?? "Could not start Google Drive upload.");
    }

    const upload = await fetch(startBody.uploadUrl, {
      method: "PUT",
      headers: { "content-type": input.file.type || "application/octet-stream" },
      body: input.file,
    });
    if (!upload.ok) {
      const text = await upload.text();
      throw new Error(`Google Drive upload failed (${upload.status}): ${text.slice(0, 300)}`);
    }

    const file = await upload.json() as {
      id?: string;
      webViewLink?: string;
      webContentLink?: string;
    };
    if (!file.id) throw new Error("Google Drive did not return a file ID.");

    return {
      externalFileId: file.id,
      externalFileUrl: file.webViewLink ?? file.webContentLink ?? `https://drive.google.com/open?id=${file.id}`,
    };
  }

  async createOpenUrl(file: ProjectFile): Promise<string> {
    if (file.externalFileUrl) return file.externalFileUrl;
    if (file.externalFileId) return `https://drive.google.com/open?id=${file.externalFileId}`;
    throw new Error("Google Drive file ID is missing.");
  }

  async remove(file: ProjectFile): Promise<void> {
    if (!file.externalFileId || file.id === "pending") return;
    const token = await sessionAccessToken(this.supabase);
    const response = await fetch("/api/google-drive/file", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ metadataId: file.id }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not remove Google Drive file.");
  }
}

class ExternalStorageProvider implements StorageProviderAdapter {
  constructor(readonly id: StorageProvider) {}

  async upload(): Promise<StoredObject> {
    throw new StorageProviderNotConfiguredError(this.id);
  }

  async createOpenUrl(file: ProjectFile): Promise<string> {
    if (file.externalFileUrl) return file.externalFileUrl;
    throw new StorageProviderNotConfiguredError(this.id);
  }

  async remove(): Promise<void> {
    throw new StorageProviderNotConfiguredError(this.id);
  }
}

export function getStorageProvider(
  supabase: SupabaseClient,
  provider: StorageProvider,
): StorageProviderAdapter {
  if (provider === "supabase") return new SupabaseStorageProvider(supabase, "tbft-files");
  if (provider === "google_drive") return new GoogleDriveStorageProvider(supabase);
  return new ExternalStorageProvider(provider);
}

export function storageProviderLabel(provider: StorageProvider): string {
  return {
    supabase: "No external storage connected",
    google_drive: "Google Drive",
    onedrive: "OneDrive",
    local: "Local storage",
  }[provider];
}
