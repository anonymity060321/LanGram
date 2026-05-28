import { getApiBaseUrl } from '../api/http';
import { useNetworkStore } from '../stores/network.store';

const SERVER_HEALTH_TIMEOUT_MS = 2500;

export async function probeServerHealth(signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SERVER_HEALTH_TIMEOUT_MS);

  function handleAbort(): void {
    controller.abort();
  }

  if (signal?.aborted) {
    window.clearTimeout(timeoutId);
    return false;
  }

  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    await fetch(getApiBaseUrl(), {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleAbort);
  }
}

export function isNetworkRequestError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
}

export function reportAuthNetworkError(error: unknown): boolean {
  if (!isNetworkRequestError(error)) {
    return false;
  }

  useNetworkStore.getState().setStatus('reconnecting');
  return true;
}
