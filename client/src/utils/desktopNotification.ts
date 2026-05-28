export interface DesktopNotificationOptions {
  title: string;
  body: string;
  conversationId: string;
  hasRequestedPermissionRef: { current: boolean };
  onClick: (conversationId: string) => void;
}

export type NotificationRuntime = 'tauri' | 'web';
export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';
export type NotificationSkipReason =
  | 'sent'
  | 'denied'
  | 'default'
  | 'unsupported'
  | 'tauri-failed'
  | 'web-failed';

export interface NotificationRuntimeStatus {
  runtime: NotificationRuntime;
  permission: NotificationPermissionState;
}

export interface NotificationAttemptResult extends NotificationRuntimeStatus {
  reason: NotificationSkipReason;
}

export async function showDesktopNotification(options: DesktopNotificationOptions): Promise<NotificationAttemptResult> {
  const status = await getNotificationRuntimeStatus();
  if (status.runtime === 'tauri') {
    return showTauriNotification(options.title, options.body);
  }

  return showWebNotification(options);
}

export async function getNotificationRuntimeStatus(): Promise<NotificationRuntimeStatus> {
  if (await isTauriRuntime()) {
    return getTauriNotificationStatus();
  }

  return {
    runtime: 'web',
    permission: getWebNotificationPermission(),
  };
}

export async function requestWebNotificationPermission(): Promise<NotificationRuntimeStatus> {
  if (await isTauriRuntime()) {
    return requestTauriNotificationPermission();
  }

  if (!('Notification' in window)) {
    return { runtime: 'web', permission: 'unsupported' };
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    return { runtime: 'web', permission };
  }

  return { runtime: 'web', permission: Notification.permission };
}

export async function showTestNotification(title: string, body: string): Promise<NotificationAttemptResult> {
  const status = await getNotificationRuntimeStatus();
  if (status.runtime === 'tauri') {
    return showTauriNotification(title, body);
  }

  if (status.permission === 'default') {
    return { ...status, reason: 'default' };
  }

  if (status.permission === 'denied') {
    return { ...status, reason: 'denied' };
  }

  if (status.permission === 'unsupported') {
    return { ...status, reason: 'unsupported' };
  }

  try {
    new Notification(title, {
      body,
      tag: 'langram:test',
    });
    return { ...status, reason: 'sent' };
  } catch {
    return { ...status, reason: 'web-failed' };
  }
}

export function debugNotificationDiagnostic(
  event: string,
  details: Record<string, string | boolean | number | null>,
): void {
  try {
    if (window.localStorage.getItem('langram.debugNotifications') !== '1') {
      return;
    }
  } catch {
    return;
  }

  console.debug('[LanGram notifications]', event, details);
}

export async function focusMainWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.unminimize();
    await currentWindow.setFocus();
  } catch {
    window.focus();
  }
}

async function getTauriNotificationStatus(): Promise<NotificationRuntimeStatus> {
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    return {
      runtime: 'tauri',
      permission: (await isPermissionGranted()) ? 'granted' : 'denied',
    };
  } catch {
    return { runtime: 'tauri', permission: 'unsupported' };
  }
}

async function requestTauriNotificationPermission(): Promise<NotificationRuntimeStatus> {
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    if (await isPermissionGranted()) {
      return { runtime: 'tauri', permission: 'granted' };
    }

    const permission = await requestPermission();
    return { runtime: 'tauri', permission: permission === 'granted' ? 'granted' : 'denied' };
  } catch {
    return { runtime: 'tauri', permission: 'unsupported' };
  }
}

async function showTauriNotification(title: string, body: string): Promise<NotificationAttemptResult> {
  const status = await requestTauriNotificationPermission();
  if (status.permission === 'denied') {
    return { ...status, reason: 'denied' };
  }

  if (status.permission === 'unsupported') {
    return { ...status, reason: 'unsupported' };
  }

  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification({ title, body });
    return { ...status, reason: 'sent' };
  } catch (error) {
    console.warn('Tauri notification failed', error instanceof Error ? error.message : String(error));
    return { ...status, reason: 'tauri-failed' };
  }
}

async function showWebNotification({
  title,
  body,
  conversationId,
  hasRequestedPermissionRef,
  onClick,
}: DesktopNotificationOptions): Promise<NotificationAttemptResult> {
  const status: NotificationRuntimeStatus = {
    runtime: 'web',
    permission: getWebNotificationPermission(),
  };

  if (!('Notification' in window)) {
    return { ...status, reason: 'unsupported' };
  }

  if (status.permission === 'default') {
    hasRequestedPermissionRef.current = true;
    return { ...status, reason: 'default' };
  }

  if (status.permission === 'denied') {
    return { ...status, reason: 'denied' };
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: `langram:${conversationId}`,
    });
    notification.onclick = () => {
      notification.close();
      window.focus();
      onClick(conversationId);
    };
    return { ...status, reason: 'sent' };
  } catch {
    return { ...status, reason: 'web-failed' };
  }
}

function getWebNotificationPermission(): NotificationPermissionState {
  if (!('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
}

export async function isTauriRuntime(): Promise<boolean> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return true;
  }

  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return false;
  }
}
