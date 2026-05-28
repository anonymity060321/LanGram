import { create } from 'zustand';

export type NetworkStatus = 'online' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed';

interface NetworkState {
  status: NetworkStatus;
  online: boolean;
  connecting: boolean;
  disconnected: boolean;
  reconnecting: boolean;
  failed: boolean;
  lastChangedAt: string | null;
  setStatus: (status: NetworkStatus) => void;
  reset: () => void;
}

function toFlags(status: NetworkStatus): Pick<
  NetworkState,
  'online' | 'connecting' | 'disconnected' | 'reconnecting' | 'failed'
> {
  return {
    online: status === 'online',
    connecting: status === 'connecting',
    disconnected: status === 'disconnected',
    reconnecting: status === 'reconnecting',
    failed: status === 'failed',
  };
}

export const useNetworkStore = create<NetworkState>((set) => ({
  status: 'disconnected',
  ...toFlags('disconnected'),
  lastChangedAt: null,
  setStatus: (status) => {
    set((state) => {
      if (state.status === status) {
        return state;
      }

      return {
        status,
        ...toFlags(status),
        lastChangedAt: new Date().toISOString(),
      };
    });
  },
  reset: () => {
    set({
      status: 'disconnected',
      ...toFlags('disconnected'),
      lastChangedAt: new Date().toISOString(),
    });
  },
}));
