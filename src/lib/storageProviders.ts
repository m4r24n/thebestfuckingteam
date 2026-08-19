import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectFile, StorageProvider } from "@/lib/types";

export type StoredObject = {
  storagePath?: string;
  externalFileId?: string;
  externalFileUrl?: string;
};

export interface StorageProviderAdapter {
  readonly id: StorageProvider;
  upload(input: { path: string; file: File }): Promise<StoredObject>;
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
