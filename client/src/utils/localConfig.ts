import { invoke } from '@tauri-apps/api/core';
import type { ClientConfig } from '../stores/settings.store';

const storageKey = 'langram.clientConfig';

const fallbackConfig: ClientConfig = {
  serverUrl: 'http://localhost:8080/api',
  theme: 'system',
  language: 'system',
  deviceId: '',
};

export async function loadClientConfig(): Promise<ClientConfig> {
  if (isTauriRuntime()) {
    return invoke<ClientConfig>('get_client_config');
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    const config = { ...fallbackConfig, deviceId: createBrowserDeviceId() };
    window.localStorage.setItem(storageKey, JSON.stringify(config));
    return config;
  }

  return { ...fallbackConfig, ...(JSON.parse(raw) as Partial<ClientConfig>) };
}

export async function saveClientConfig(config: ClientConfig): Promise<ClientConfig> {
  if (isTauriRuntime()) {
    return invoke<ClientConfig>('save_client_config', { config });
  }

  window.localStorage.setItem(storageKey, JSON.stringify(config));
  return config;
}

function createBrowserDeviceId(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}
