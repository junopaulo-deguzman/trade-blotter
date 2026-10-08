import type { Session } from "@/types/auth";

export const SESSION_KEY = "trading-platform.session.v1";

export function parseSession(value: string | null): Session | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value);
    if (
      session.tokenType !== "Bearer" ||
      typeof session.accessToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(session.accessToken) ||
      typeof session.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= Date.now() ||
      !Number.isInteger(session.user?.id) ||
      session.user.id < 1 ||
      typeof session.user?.username !== "string" ||
      typeof session.user?.name !== "string"
    )
      return null;
    return {
      accessToken: session.accessToken,
      tokenType: "Bearer",
      expiresAt: session.expiresAt,
      user: { id: session.user.id, username: session.user.username, name: session.user.name },
    };
  } catch {
    return null;
  }
}
