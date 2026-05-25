export interface ApiErrorPayload {
  code?: string;
  message?: string;
  requestId?: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message ?? `HTTP ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.requestId;
  }
}

let baseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api');
let accessToken: string | null = null;
let sessionRevokedHandler: (() => void) | null = null;

export function setApiBaseUrl(nextBaseUrl: string): void {
  baseUrl = normalizeBaseUrl(nextBaseUrl);
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

export function setAccessToken(nextAccessToken: string | null): void {
  accessToken = nextAccessToken;
}

export function setSessionRevokedHandler(handler: (() => void) | null): void {
  sessionRevokedHandler = handler;
}

export async function apiRequest<TResponse>(
  path: string,
  options: RequestInit = {},
): Promise<TResponse> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  if (hasBody && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${baseUrl}${normalizePath(path)}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    notifySessionRevoked(response.status, payload);
    throw new ApiClientError(response.status, payload);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

export async function apiBlobRequest(path: string, options: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(options.headers);

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${baseUrl}${normalizePath(path)}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    notifySessionRevoked(response.status, payload);
    throw new ApiClientError(response.status, payload);
  }

  return response.blob();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

async function parseErrorPayload(response: Response): Promise<ApiErrorPayload> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return { message: response.statusText };
  }
}

function notifySessionRevoked(status: number, payload: ApiErrorPayload): void {
  if (status !== 401 || payload.message !== 'Session is no longer active') {
    return;
  }

  sessionRevokedHandler?.();
}
