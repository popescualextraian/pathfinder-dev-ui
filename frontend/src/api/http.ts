export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Where a definition rule was broken (400 of the workflow routes). */
    readonly location?: { stepId?: string; stepIndex?: number; field?: string },
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function errorInfo(response: Response): Promise<{ message: string; location?: ApiError['location'] }> {
  try {
    const body = (await response.json()) as { message?: string | string[]; location?: unknown; field?: unknown };
    const location =
      body.location && typeof body.location === 'object'
        ? (body.location as ApiError['location'])
        : typeof body.field === 'string'
          ? { field: body.field }
          : undefined;
    if (Array.isArray(body.message)) return { message: body.message.join(', '), location };
    if (typeof body.message === 'string' && body.message) return { message: body.message, location };
  } catch {
    // body is not JSON
  }
  return { message: `Request failed with status ${response.status}` };
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const { message, location } = await errorInfo(response);
    throw new ApiError(response.status, message, location);
  }
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
