const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let csrfToken: string | null = null;

export interface ApiErrorPayload {
  error: string;
  code?: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public payload: ApiErrorPayload,
  ) {
    super(payload.error);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
    headers.set('x-csrf-token', await getCsrfToken());
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      error: 'Request failed'
    }))) as ApiErrorPayload;
    throw new ApiClientError(response.status, payload);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/auth/csrf`, {
    credentials: 'include'
  });
  const data = (await response.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function downloadUrl(path: string) {
  return `${API_URL}${path}`;
}

export { API_URL };
