import { invoke } from '@tauri-apps/api/core';
import { loadClientConfig } from './localConfig';

export interface DeviceIdentity {
  deviceIdentifier: string;
  name?: string;
  platform?: string;
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if ('__TAURI_INTERNALS__' in window) {
    return invoke<DeviceIdentity>('get_device_identity');
  }

  const config = await loadClientConfig();
  return {
    deviceIdentifier: config.deviceId,
    name: 'LanGram Browser Preview',
    platform: window.navigator.platform || 'browser',
  };
}
