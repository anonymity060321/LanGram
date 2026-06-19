import { create } from 'zustand';
import { loadClientConfig, saveClientConfig } from '../utils/localConfig';
import { setApiBaseUrl } from '../api/http';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'zh-CN' | 'en-US';
export type SendShortcutPreference = 'enter' | 'ctrlEnter';

export interface ClientConfig {
  serverUrl: string;
  theme: ThemePreference;
  language: LanguagePreference;
  deviceId: string;
  downloadDir: string | null;
  enableNotifications: boolean;
  closeToTray: boolean;
  sendShortcut: SendShortcutPreference;
}

interface SettingsState {
  config: ClientConfig | null;
  isLoaded: boolean;
  load: () => Promise<void>;
  updateConfig: (patch: Partial<Omit<ClientConfig, 'deviceId'>>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  isLoaded: false,
  load: async () => {
    const config = await loadClientConfig();
    setApiBaseUrl(config.serverUrl);
    set({ config, isLoaded: true });
  },
  updateConfig: async (patch) => {
    const current = get().config ?? (await loadClientConfig());
    const next = { ...current, ...patch };
    const saved = await saveClientConfig(next);
    setApiBaseUrl(saved.serverUrl);
    set({ config: saved, isLoaded: true });
  },
}));
