export interface DesktopNotificationOptions {
  title: string;
  body: string;
  conversationId: string;
  hasRequestedPermissionRef: { current: boolean };
  onClick: (conversationId: string) => void;
}

export async function showDesktopNotification(options: DesktopNotificationOptions): Promise<void> {
  if (await isTauriRuntime()) {
    await showTauriNotification(options.title, options.body);
    return;
  }

  await showWebNotification(options);
}

export async function focusMainWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFocus();
  } catch {
    window.focus();
  }
}

async function showTauriNotification(title: string, body: string): Promise<void> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    );
    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      const permission = await requestPermission();
      permissionGranted = permission === 'granted';
    }

    if (!permissionGranted) {
      return;
    }

    sendNotification({ title, body });
  } catch (error) {
    console.warn('Tauri notification failed', error instanceof Error ? error.message : String(error));
  }
}

async function showWebNotification({
  title,
  body,
  conversationId,
  hasRequestedPermissionRef,
  onClick,
}: DesktopNotificationOptions): Promise<void> {
  if (!('Notification' in window)) {
    return;
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    if (hasRequestedPermissionRef.current) {
      return;
    }

    hasRequestedPermissionRef.current = true;
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return;
  }

  const notification = new Notification(title, {
    body,
    tag: `langram:${conversationId}`,
  });
  notification.onclick = () => {
    notification.close();
    window.focus();
    onClick(conversationId);
  };
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return '__TAURI_INTERNALS__' in window;
  }
}
