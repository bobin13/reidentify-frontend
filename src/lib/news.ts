export type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  imageUrl: string | null;
  imageGroupKey?: string | null;
  scope: "local" | "regional" | "ontario";
  areaLabel: string;
  topics: string[];
  stale: boolean;
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