/**
 * Minimal fetch wrapper: attaches the bearer token, parses JSON, and throws on
 * any non-2xx response.
 *
 * The thrown ApiError keeps `status` and the parsed `body`, because the useful
 * part of a failure is in the body rather than the message. Some failures
 * explain themselves and some do not - worth knowing which is which.
 */
const TOKEN = import.meta.env.VITE_API_TOKEN ?? 'lyric-align-dev-token-7f3a91';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body != null && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const raw = await res.text();
  let body: unknown = undefined;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, body, `${init.method ?? 'GET'} ${path} -> ${res.status}`);
  }

  return body as T;
}
