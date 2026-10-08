import type { AuthClient } from "@/types/auth";
import { createHttpClient, type HttpOptions } from "./http-client";

export function createAuthClient(baseUrl: string, options: HttpOptions = {}): AuthClient {
  const request = createHttpClient(baseUrl, options);
  return {
    login: (input) =>
      request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    me: (token, signal) => request("/auth/me", { signal }, token),
    logout: (token) => request("/auth/logout", { method: "POST" }, token),
  };
}
