import type { User } from "firebase/auth";

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  account: User,
  method: "GET" | "PUT" | "POST",
  body?: unknown,
  path = "/api/me",
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const token = await account.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(45000, options.timeoutMs ?? 10000)),
  );

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    // A proxy or crashed server can answer with an HTML error page. That is
    // a server problem, not a connection problem, so report it as one.
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      throw new ApiError(
        response.ok
          ? "ReIdentify sent an unexpected response. Please try again."
          : `ReIdentify is having trouble right now (error ${response.status}). Please try again.`,
        response.status,
      );
    }

    if (!response.ok) {
      const message = (data as { message?: unknown } | undefined)?.message;
      throw new ApiError(
        typeof message === "string"
          ? message
          : "The server could not complete your request.",
        response.status,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    throw new ApiError(
      controller.signal.aborted
        ? "The connection took too long. Please try again."
        : "Cannot connect to ReIdentify. Please try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
