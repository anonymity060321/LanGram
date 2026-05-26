import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';

type ImagePreviewPayload = {
  id: string;
  originalName: string;
  dataUrl: string;
};

const IMAGE_PREVIEW_OPEN_EVENT = 'image-preview:open';
const IMAGE_PREVIEW_READY_EVENT = 'image-preview:ready';

export function ImagePreviewWindow(): JSX.Element {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ImagePreviewPayload | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isCancelled = false;

    async function listenForPreview(): Promise<void> {
      if (!(await isTauriRuntime())) {
        return;
      }

      const [{ listen, emit }, { WebviewWindow }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/webviewWindow'),
      ]);
      const label = WebviewWindow.getCurrent().label;
      unlisten = await listen<ImagePreviewPayload>(IMAGE_PREVIEW_OPEN_EVENT, (event) => {
        if (isCancelled) {
          return;
        }

        setPreview(event.payload);
        setScale(1);
        document.title = event.payload.originalName;
      });
      await emit(IMAGE_PREVIEW_READY_EVENT, { label });
    }

    void listenForPreview();
    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        void closePreviewWindow();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function updateScale(nextScale: number): void {
    setScale(Math.min(3, Math.max(0.5, nextScale)));
  }

  function downloadPreview(): void {
    if (!preview) {
      return;
    }

    const link = document.createElement('a');
    link.href = preview.dataUrl;
    link.download = sanitizeDownloadName(preview.originalName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <main className="image-preview-window">
      <section className="image-lightbox image-preview-window-shell" aria-labelledby="image-preview-title">
        <header className="image-lightbox-header">
          <strong id="image-preview-title">
            {preview?.originalName ?? t('chat.openImagePreview')}
          </strong>
          <button
            type="button"
            className="image-lightbox-icon-button"
            aria-label={t('chat.closePreview')}
            onClick={() => void closePreviewWindow()}
          >
            &times;
          </button>
        </header>
        <div className="image-lightbox-stage">
          {preview ? (
            <img
              src={preview.dataUrl}
              alt={preview.originalName}
              style={{ transform: `scale(${scale})` }}
            />
          ) : (
            <p className="image-lightbox-state">{t('chat.imagePreviewLoading')}</p>
          )}
        </div>
        <footer className="image-lightbox-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale <= 0.5}
            onClick={() => updateScale(scale - 0.25)}
          >
            {t('chat.zoomOut')}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale === 1}
            onClick={() => updateScale(1)}
          >
            {t('chat.zoomReset')}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale >= 3}
            onClick={() => updateScale(scale + 0.25)}
          >
            {t('chat.zoomIn')}
          </button>
          <button
            type="button"
            className="primary-button compact-button"
            disabled={!preview}
            onClick={downloadPreview}
          >
            {t('chat.download')}
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => void closePreviewWindow()}>
            {t('chat.closePreview')}
          </button>
        </footer>
      </section>
    </main>
  );
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return '__TAURI_INTERNALS__' in window;
  }
}

async function closePreviewWindow(): Promise<void> {
  if (!(await isTauriRuntime())) {
    window.close();
    return;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

function sanitizeDownloadName(originalName: string): string {
  const name = originalName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\r\n]/g, '')
    .trim();

  return name || 'image';
}
