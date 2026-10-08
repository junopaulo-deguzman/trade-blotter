export interface RequestError {
  message: string;
  status?: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
}

export class ApiError extends Error {
  constructor(readonly detail: RequestError) {
    super(detail.message);
  }
}

export function requestError(error: unknown): RequestError {
  if (error instanceof ApiError) return error.detail;
  return { message: error instanceof Error ? error.message : "Request failed. Please try again." };
}

export interface HttpOptions {
  getAccessToken?: () => string | null;
  onUnauthorized?: (token: string) => void;
}

export function createHttpClient(baseUrl: string, options: HttpOptions = {}) {
  const root = baseUrl.replace(/\/$/, "");
  return async function request<T>(
    path: string,
    init: RequestInit = {},
    tokenOverride?: string,
  ): Promise<T> {
    const token = tokenOverride ?? options.getAccessToken?.();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail: RequestError = {
        message:
          typeof body?.error === "string"
            ? body.error
            : `Request failed (${response.status}). Please try again.`,
        status: response.status,
        code: typeof body?.code === "string" ? body.code : undefined,
        fieldErrors: body?.fieldErrors,
      };
      if (detail.code === "UNAUTHORIZED" && token) options.onUnauthorized?.(token);
      throw new ApiError(detail);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  };
}
