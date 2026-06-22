import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useI18n } from '../../i18n';

type ImagePreviewPayload = {
  id: string;
  originalName: string;
  dataUrl: string;
};

const IMAGE_PREVIEW_OPEN_EVENT = 'image-preview:open';
const IMAGE_PREVIEW_READY_EVENT = 'image-preview:ready';
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

export function ImagePreviewWindow(): JSX.Element {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ImagePreviewPayload | null>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const didDragRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const scaleLabel = `${Math.round(scale * 100)}%`;

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
        resetView();
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
    const clampedScale = clampScale(nextScale);
    setScale(clampedScale);
    if (clampedScale <= 1) {
      setTranslate({ x: 0, y: 0 });
      return;
    }

    setTranslate((current) => clampTranslate(current, clampedScale, stageRef.current, imageRef.current));
  }

  function resetView(): void {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsDragging(false);
    dragStateRef.current = null;
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    if (!preview) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP;
    updateScale(scale + delta);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    if (event.button !== 0 || scale <= 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }

    didDragRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: translate.x,
      originY: translate.y,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextTranslate = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    };
    if (Math.abs(event.clientX - dragState.startX) > 3 || Math.abs(event.clientY - dragState.startY) > 3) {
      didDragRef.current = true;
    }

    setTranslate(clampTranslate(nextTranslate, scale, stageRef.current, imageRef.current));
  }

  function stopDragging(event: ReactPointerEvent<HTMLImageElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const dragState = dragStateRef.current;
    if (dragState?.pointerId === event.pointerId) {
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    }

    dragStateRef.current = null;
    setIsDragging(false);
  }

  function handleStageClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    if (event.target === event.currentTarget) {
      void closePreviewWindow();
    }
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
        <div
          ref={stageRef}
          className="image-lightbox-stage image-preview-pan-stage"
          onWheel={handleWheel}
          onClick={handleStageClick}
        >
          {preview ? (
            <img
              ref={imageRef}
              src={preview.dataUrl}
              alt={preview.originalName}
              className={`image-preview-pan-image ${scale > 1 ? 'is-zoomed' : ''} ${
                isDragging ? 'is-dragging' : ''
              }`}
              draggable={false}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
              onLostPointerCapture={() => {
                dragStateRef.current = null;
                setIsDragging(false);
              }}
              onDoubleClick={resetView}
              style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              }}
            />
          ) : (
            <p className="image-lightbox-state">{t('chat.imagePreviewLoading')}</p>
          )}
        </div>
        <footer className="image-lightbox-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale <= MIN_SCALE}
            onClick={() => updateScale(scale - SCALE_STEP)}
          >
            {t('chat.zoomOut')}
          </button>
          <span className="image-preview-scale-label" aria-live="polite">
            {scaleLabel}
          </span>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale === 1}
            onClick={resetView}
          >
            {t('chat.zoomReset')}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!preview || scale >= MAX_SCALE}
            onClick={() => updateScale(scale + SCALE_STEP)}
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

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampTranslate(
  translate: { x: number; y: number },
  scale: number,
  stage: HTMLDivElement | null,
  image: HTMLImageElement | null,
): { x: number; y: number } {
  if (scale <= 1 || !stage || !image) {
    return { x: 0, y: 0 };
  }

  const stageRect = stage.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  const baseWidth = imageRect.width / scale;
  const baseHeight = imageRect.height / scale;
  const maxX = Math.max(0, (baseWidth * scale - stageRect.width) / 2 + 80);
  const maxY = Math.max(0, (baseHeight * scale - stageRect.height) / 2 + 80);

  return {
    x: clampNumber(translate.x, -maxX, maxX),
    y: clampNumber(translate.y, -maxY, maxY),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safelyReleasePointerCapture(element: HTMLImageElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Pointer capture may already be lost when the pointer leaves the webview edge.
  }
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
