export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (typeof body.message === 'string' && body.message) return body.message;
  } catch {
    // body is not JSON
  }
  return `Request failed with status ${response.status}`;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(
    url,
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
}
