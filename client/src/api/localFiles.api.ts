import { invoke } from '@tauri-apps/api/core';

export interface LocalFileRecord {
  id: string;
  fileId: string;
  conversationId: string | null;
  messageId: string | null;
  originalName: string;
  safeName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  localPath: string;
  status: string;
  errorMessage: string | null;
  downloadedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalFileRecordInput {
  fileId: string;
  conversationId: string | null;
  messageId: string | null;
  originalName: string;
  safeName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  localPath: string;
  status: string;
  errorMessage: string | null;
  downloadedAt: string | null;
}

export interface SavedDownloadedFile {
  localPath: string;
  safeName: string;
  sizeBytes: number;
}

export function saveDownloadedFile(
  fileName: string,
  bytes: number[],
): Promise<SavedDownloadedFile> {
  return invoke<SavedDownloadedFile>('save_downloaded_file', { fileName, bytes });
}

export function upsertLocalFileRecord(
  record: LocalFileRecordInput,
): Promise<LocalFileRecord> {
  return invoke<LocalFileRecord>('upsert_local_file_record', { record });
}

export function listLocalFileRecords(limit?: number): Promise<LocalFileRecord[]> {
  return invoke<LocalFileRecord[]>('list_local_file_records', { limit });
}

export function getLocalFileRecord(id: string): Promise<LocalFileRecord | null> {
  return invoke<LocalFileRecord | null>('get_local_file_record', { id });
}
