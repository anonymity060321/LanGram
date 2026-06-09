import { invoke } from '@tauri-apps/api/core';

export interface DownloadDirectoryStatus {
  configuredDir: string | null;
  effectiveDir: string;
  isDefault: boolean;
}

export function getDownloadDirectoryStatus(): Promise<DownloadDirectoryStatus> {
  return invoke<DownloadDirectoryStatus>('get_download_directory_status');
}

export function setDownloadDirectory(path: string): Promise<DownloadDirectoryStatus> {
  return invoke<DownloadDirectoryStatus>('set_download_directory', { path });
}

export function resetDownloadDirectory(): Promise<DownloadDirectoryStatus> {
  return invoke<DownloadDirectoryStatus>('reset_download_directory');
}
