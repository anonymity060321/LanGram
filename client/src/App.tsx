import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSessionRevokedHandler } from './api/http';
import { AppRoutes } from './routes';
import { useI18n } from './i18n';
import { useAuthStore } from './stores/auth.store';
import { useChatStore } from './stores/chat.store';
import { isTauriRuntime } from './utils/desktopNotification';

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface InputContextMenuState {
  target: EditableTarget;
  x: number;
  y: number;
  canCopy: boolean;
  canCut: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
}

export function App(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isSessionReplaced = useAuthStore((state) => state.isSessionReplaced);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const notifySessionReplaced = useAuthStore((state) => state.notifySessionReplaced);
  const acknowledgeSessionReplaced = useAuthStore((state) => state.acknowledgeSessionReplaced);
  const clearSession = useAuthStore((state) => state.clearSession);
  const disconnect = useChatStore((state) => state.disconnect);
  const [inputContextMenu, setInputContextMenu] = useState<InputContextMenuState | null>(null);
  const inputContextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function preventNativeContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const editableTarget = getEditableTarget(event.target);
      if (!editableTarget) {
        setInputContextMenu(null);
        return;
      }

      setInputContextMenu(createInputContextMenuState(editableTarget, event.clientX, event.clientY));
    }

    document.addEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', preventNativeContextMenu, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!inputContextMenu) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (inputContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setInputContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setInputContextMenu(null);
      }
    }

    function handleScroll(): void {
      setInputContextMenu(null);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [inputContextMenu]);

  useEffect(() => {
    setSessionRevokedHandler(() => notifySessionReplaced());
    return () => setSessionRevokedHandler(null);
  }, [notifySessionReplaced]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let isCancelled = false;

    async function listenForTraySettings(): Promise<void> {
      if (!(await isTauriRuntime())) {
        return;
      }

      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen('tray-open-settings', () => {
        navigate('/settings');
      });

      if (isCancelled) {
        unlisten();
        return;
      }

      cleanup = unlisten;
    }

    void listenForTraySettings().catch(() => undefined);
    return () => {
      isCancelled = true;
      cleanup?.();
    };
  }, [navigate]);

  useEffect(() => {
    void updateTrayAuthenticated(isAuthenticated);
  }, [isAuthenticated]);

  function handleConfirmSessionReplaced(): void {
    acknowledgeSessionReplaced();
    disconnect();
    clearSession();
    navigate('/auth/login', { replace: true });
  }

  return (
    <>
      <AppRoutes />
      {inputContextMenu ? (
        <div
          ref={inputContextMenuRef}
          className="input-context-menu"
          role="menu"
          style={{ left: inputContextMenu.x, top: inputContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!inputContextMenu.canCopy}
            onClick={() => void handleInputContextMenuAction(inputContextMenu, 'copy', setInputContextMenu)}
          >
            {t('edit.copy')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!inputContextMenu.canCut}
            onClick={() => void handleInputContextMenuAction(inputContextMenu, 'cut', setInputContextMenu)}
          >
            {t('edit.cut')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!inputContextMenu.canPaste}
            onClick={() => void handleInputContextMenuAction(inputContextMenu, 'paste', setInputContextMenu)}
          >
            {t('edit.paste')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!inputContextMenu.canSelectAll}
            onClick={() => void handleInputContextMenuAction(inputContextMenu, 'selectAll', setInputContextMenu)}
          >
            {t('edit.selectAll')}
          </button>
        </div>
      ) : null}
      {isSessionReplaced ? (
        <div className="session-replaced-backdrop" role="presentation">
          <section
            className="session-replaced-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="session-replaced-title"
            aria-describedby="session-replaced-message"
          >
            <h2 id="session-replaced-title">{t('auth.sessionReplacedTitle')}</h2>
            <p id="session-replaced-message">{t('auth.sessionReplacedMessage')}</p>
            <div className="session-replaced-actions">
              <button type="button" className="primary-button" onClick={handleConfirmSessionReplaced}>
                {t('common.confirm')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

type InputContextMenuAction = 'copy' | 'cut' | 'paste' | 'selectAll';

function getEditableTarget(target: EventTarget | null): EditableTarget | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const editable = target.closest('input, textarea, [contenteditable="true"]');
  if (
    editable instanceof HTMLInputElement ||
    editable instanceof HTMLTextAreaElement ||
    (editable instanceof HTMLElement && editable.isContentEditable)
  ) {
    return editable;
  }

  return null;
}

function createInputContextMenuState(
  target: EditableTarget,
  clientX: number,
  clientY: number,
): InputContextMenuState {
  const isPassword = target instanceof HTMLInputElement && target.type === 'password';
  const isMutable = !isReadonlyOrDisabled(target);
  const hasSelection = getSelectedText(target).length > 0;
  const hasText = getEditableText(target).length > 0;
  const position = getContextMenuPosition(clientX, clientY);

  return {
    target,
    x: position.x,
    y: position.y,
    canCopy: hasSelection && !isPassword,
    canCut: hasSelection && isMutable && !isPassword,
    canPaste: isMutable,
    canSelectAll: hasText,
  };
}

async function handleInputContextMenuAction(
  menu: InputContextMenuState,
  action: InputContextMenuAction,
  closeMenu: (nextState: InputContextMenuState | null) => void,
): Promise<void> {
  if (!document.contains(menu.target)) {
    closeMenu(null);
    return;
  }

  menu.target.focus();
  switch (action) {
    case 'copy':
      if (menu.canCopy) {
        await copySelectedText(menu.target);
      }
      break;
    case 'cut':
      if (menu.canCut) {
        await cutSelectedText(menu.target);
      }
      break;
    case 'paste':
      if (menu.canPaste) {
        await pasteClipboardText(menu.target);
      }
      break;
    case 'selectAll':
      if (menu.canSelectAll) {
        selectEditableText(menu.target);
      }
      break;
    default:
      assertNever(action);
  }

  closeMenu(null);
}

async function copySelectedText(target: EditableTarget): Promise<void> {
  const selectedText = getSelectedText(target);
  if (!selectedText) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(selectedText);
    return;
  }

  document.execCommand('copy');
}

async function cutSelectedText(target: EditableTarget): Promise<void> {
  const selectedText = getSelectedText(target);
  if (!selectedText || isReadonlyOrDisabled(target)) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(selectedText);
    replaceSelectedText(target, '');
    return;
  }

  document.execCommand('cut');
}

async function pasteClipboardText(target: EditableTarget): Promise<void> {
  if (isReadonlyOrDisabled(target) || !navigator.clipboard?.readText) {
    return;
  }

  const text = await navigator.clipboard.readText();
  if (!text) {
    return;
  }

  replaceSelectedText(target, text);
}

function getSelectedText(target: EditableTarget): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const selectionStart = target.selectionStart ?? 0;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    return target.value.slice(selectionStart, selectionEnd);
  }

  return window.getSelection()?.toString() ?? '';
}

function getEditableText(target: EditableTarget): string {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value;
  }

  return target.textContent ?? '';
}

function replaceSelectedText(target: EditableTarget, text: string): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    target.setRangeText(text, selectionStart, selectionEnd, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  document.execCommand('insertText', false, text);
}

function selectEditableText(target: EditableTarget): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function isReadonlyOrDisabled(target: EditableTarget): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.readOnly || target.disabled;
  }

  return target.getAttribute('contenteditable') === 'false';
}

function getContextMenuPosition(clientX: number, clientY: number): { x: number; y: number } {
  const menuWidth = 156;
  const menuHeight = 150;
  const padding = 8;

  return {
    x: Math.max(padding, Math.min(clientX, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(clientY, window.innerHeight - menuHeight - padding)),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected action: ${String(value)}`);
}

async function updateTrayAuthenticated(authenticated: boolean): Promise<void> {
  if (!(await isTauriRuntime())) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_tray_authenticated', { authenticated });
  } catch {
    // Tray state is desktop-only and should never affect the web app or auth flow.
  }
}
