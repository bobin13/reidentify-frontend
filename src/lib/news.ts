import type { User } from "firebase/auth";
import { apiRequest } from "./api";

export type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  imageUrl: string | null;
  // Photo the server found on the article page when the feed had none.
  previewImageUrl?: string | null;
  imageGroupKey?: string | null;
  scope: "local" | "regional" | "ontario" | "interest";
  areaLabel: string;
  topics: string[];
  interests?: string[];
  stale: boolean;
};

export type InterestTopic = {
  topic: string;
  label: string;
  interests: string[];
};

export type InterestNewsResult = {
  articles: NewsArticle[];
  offset: number;
  nextOffset: number | null;
  topics: InterestTopic[];
  generatedAt: string;
  notice: string | null;
};

export type NewsResult = {
  city: string | null;
  cityId: string | null;
  district: string | null;
  coverage: "local-and-regional" | "ontario-only";
  articles: NewsArticle[];
  checkedAt: string | null;
  generatedAt: string;
  sources: { name: string; available: boolean; stale: boolean }[];
  notice: string | null;
  imageGroupingPending?: boolean;
};

const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

// News matched to the signed-in member's interests, ten stories per page.
// The backend calls the news provider once per interest topic with a
// half-second gap, so a first page can take several seconds.
export const INTEREST_PAGE = 10;

// `limit` (1-10) lets the first request return a couple of stories quickly.
export function fetchInterestNews(
  account: User,
  offset = 0,
  limit = INTEREST_PAGE,
) {
  const query = new URLSearchParams();
  if (offset > 0) query.set("offset", String(offset));
  if (limit !== INTEREST_PAGE) query.set("limit", String(limit));
  const search = query.toString();
  return apiRequest<InterestNewsResult>(
    account,
    "GET",
    undefined,
    `/api/news/for-you${search ? `?${search}` : ""}`,
    { timeoutMs: 45000 },
  );
}

class NewsResponseError extends Error {}

export async function fetchAreaNews(
  cityId: string | null,
  districtId: string | null,
  signal: AbortSignal,
): Promise<NewsResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel);
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 20000);
  const query = cityId
    ? `?cityId=${encodeURIComponent(cityId)}${districtId ? `&districtId=${encodeURIComponent(districtId)}` : ""}`
    : "";
  try {
    const response = await fetch(`${API_URL}/news${query}`, {
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new NewsResponseError(
        typeof data?.message === "string"
          ? data.message
          : "News is unavailable. Please try again.",
      );
    if (!data || !Array.isArray(data.articles))
      throw new NewsResponseError("News is unavailable. Please try again.");
    return data as NewsResult;
  } catch (error) {
    if (signal.aborted) throw error;
    if (controller.signal.aborted)
      throw new Error("News took too long to load. Please try again.");
    if (error instanceof NewsResponseError) throw error;
    throw new Error("News is temporarily unavailable. Please try again.");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}