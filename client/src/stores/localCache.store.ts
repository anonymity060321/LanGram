import { create } from 'zustand';
import {
  clearLocalCache,
  getLocalCacheStatus,
  initLocalCache,
  type LocalCacheStatus,
} from '../api/localCache.api';

type LocalCacheInitializationState = 'idle' | 'initialized' | 'failed';

interface LocalCacheState {
  status: LocalCacheStatus | null;
  initializationState: LocalCacheInitializationState;
  error: string | null;
  isInitializing: boolean;
  isRefreshing: boolean;
  isClearing: boolean;
  initializeOnce: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  clearCache: () => Promise<void>;
}

let hasRequestedInitialization = false;

export const useLocalCacheStore = create<LocalCacheState>((set) => ({
  status: null,
  initializationState: 'idle',
  error: null,
  isInitializing: false,
  isRefreshing: false,
  isClearing: false,
  initializeOnce: async () => {
    if (hasRequestedInitialization) {
      return;
    }

    hasRequestedInitialization = true;
    set({ isInitializing: true, error: null });
    try {
      const result = await initLocalCache();
      set({
        status: {
          dbPath: result.dbPath,
          exists: true,
          schemaVersion: result.schemaVersion,
        },
        initializationState: 'initialized',
        error: null,
      });
    } catch (error) {
      set({
        initializationState: 'failed',
        error: toLocalCacheErrorMessage(error),
      });
    } finally {
      set({ isInitializing: false });
    }
  },
  refreshStatus: async () => {
    set({ isRefreshing: true, error: null });
    try {
      const status = await getLocalCacheStatus();
      set({
        status,
        initializationState: status.exists ? 'initialized' : 'idle',
        error: null,
      });
    } catch (error) {
      set({ error: toLocalCacheErrorMessage(error) });
      throw error;
    } finally {
      set({ isRefreshing: false });
    }
  },
  clearCache: async () => {
    set({ isClearing: true, error: null });
    try {
      const status = await clearLocalCache();
      set({
        status,
        initializationState: status.exists ? 'initialized' : 'idle',
        error: null,
      });
    } catch (error) {
      set({ error: toLocalCacheErrorMessage(error) });
      throw error;
    } finally {
      set({ isClearing: false });
    }
  },
}));

function toLocalCacheErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Local cache operation failed';
}
