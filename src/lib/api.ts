import type { User } from "firebase/auth";

const API_URL = (
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
): Promise<T> {
  const token = await account.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        typeof data?.message === "string"
          ? data.message
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