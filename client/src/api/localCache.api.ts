import { invoke } from '@tauri-apps/api/core';

export interface LocalCacheStatus {
  dbPath: string;
  exists: boolean;
  schemaVersion: number | null;
}

export interface InitLocalCacheResult {
  dbPath: string;
  schemaVersion: number;
  initialized: true;
}

export function initLocalCache(): Promise<InitLocalCacheResult> {
  return invoke<InitLocalCacheResult>('init_local_cache');
}

export function getLocalCacheStatus(): Promise<LocalCacheStatus> {
  return invoke<LocalCacheStatus>('get_local_cache_status');
}

export function clearLocalCache(): Promise<LocalCacheStatus> {
  return invoke<LocalCacheStatus>('clear_local_cache');
}
