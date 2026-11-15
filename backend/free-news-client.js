// FreeNewsAPI client shared by every route that talks to the provider.
//
// The provider allows 2 requests per second per API key and 5,000 per day.
// All requests go through one process-wide queue that starts them at least
// SPACING_MS apart, so concurrent users cannot exceed the limit together.
// Exactly 500ms still drew occasional 429s (three starts can fall inside one
// second), so the spacing has headroom and a 429 is retried after a pause.
// Topic listings and article details are cached to keep the daily budget low.

const API_BASE_URL = "https://api.freenewsapi.io/v1";
const SPACING_MS = 550;
const RATE_LIMIT_PAUSE_MS = 1000;
const RATE_LIMIT_RETRIES = 2;
const LISTING_TTL_MS = 15 * 60 * 1000;
const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const DETAILS_CACHE_MAX = 2000;
const LISTING_CACHE_MAX = 400;
const PAGE_SIZE = 10;

class FreeNewsError extends Error {
  constructor(status, message, { rateLimited = false } = {}) {
    super(message);
    this.name = "FreeNewsError";
    this.status = status;
    // True when the provider kept answering 429 after every retry.
    this.rateLimited = rateLimited;
  }
}

function createFreeNewsClient({
  fetchImpl = globalThis.fetch,
  getApiKey = () => process.env.NEWS_API_KEY,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  spacingMs = SPACING_MS,
  country = "ca",
  language = "en",
} = {}) {
  let chain = Promise.resolve();
  let lastStart = -Infinity;
  const listings = new Map();
  const details = new Map();
  const inFlight = new Map();

  // Serialize provider calls so each starts >= spacingMs after the previous.
  function schedule(work) {
    const turn = chain.then(async () => {
      const wait = lastStart + spacingMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return work();
    });
    // Keep the queue alive after failures; callers see their own rejection.
    chain = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  async function request(endpoint, params) {
    const apiKey = getApiKey();
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new FreeNewsError(503, "Interest news is not configured.");
    }
    const url = new URL(`${API_BASE_URL}/${endpoint}`);
    url.search = new URLSearchParams(params).toString();

    return schedule(async () => {
      let response;
      // Retries stay inside this queue turn, so nothing else jumps ahead
      // while the provider's rate window clears.
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetchImpl(url, {
            headers: { Accept: "application/json", "x-api-key": apiKey.trim() },
            signal: AbortSignal.timeout(10000),
          });
        } catch (error) {
          const timedOut = error?.name === "TimeoutError";
          throw new FreeNewsError(
            timedOut ? 504 : 502,
            timedOut
              ? "The news provider took too long. Please try again."
              : "The news provider is unavailable. Please try again.",
          );
        }
        if (response.status !== 429) break;
        if (attempt >= RATE_LIMIT_RETRIES) {
          // Back off a full second before the next queued request.
          lastStart = now() + RATE_LIMIT_PAUSE_MS - spacingMs;
          throw new FreeNewsError(
            503,
            "News is busy right now. Please try again in a moment.",
            { rateLimited: true },
          );
        }
        await sleep(RATE_LIMIT_PAUSE_MS);
        lastStart = now();
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new FreeNewsError(
          502,
          "The news provider returned an unreadable response.",
        );
      }
      if (!response.ok) {
        throw new FreeNewsError(
          response.status === 401 || response.status === 403 ? 503 : 502,
          response.status === 401 || response.status === 403
            ? "Interest news is not configured."
            : "The news provider request failed. Please try again.",
        );
      }
      return data;
    });
  }

  function remember(cache, key, value, ttl, max) {
    if (cache.size >= max) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + ttl });
    return value;
  }

  function recall(cache, key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  // Collapse identical concurrent requests into one provider call.
  function once(key, work) {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = work().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  // One page of the newest articles for a single provider topic.
  async function listTopic(topic, offset = 0) {
    const key = `${topic}|${offset}`;
    const cached = recall(listings, key);
    if (cached) return cached;
    return once(`list:${key}`, async () => {
      const again = recall(listings, key);
      if (again) return again;
      const data = await request("news", {
        topic,
        country,
        language,
        ...(offset ? { offset: String(offset) } : {}),
      });
      const items = Array.isArray(data?.data) ? data.data : [];
      const page = {
        topic,
        offset,
        articles: items
          .filter(
            (item) =>
              item &&
              typeof item.uuid === "string" &&
              typeof item.title === "string",
          )
          .map((item) => ({
            uuid: item.uuid,
            title: item.title.trim(),
            publisher:
              typeof item.publisher === "string" ? item.publisher.trim() : "",
            publishedAt: Date.parse(item.published_at) || 0,
            topic,
          })),
        hasMore: data?.meta?.has_more === true,
        nextOffset: Number.isInteger(data?.meta?.next_offset)
          ? data.meta.next_offset
          : null,
      };
      return remember(listings, key, page, LISTING_TTL_MS, LISTING_CACHE_MAX);
    });
  }

  // Full article record: the only place the provider exposes the URL.
  async function articleDetails(uuid) {
    const cached = recall(details, uuid);
    if (cached) return cached;
    return once(`details:${uuid}`, async () => {
      const again = recall(details, uuid);
      if (again) return again;
      const data = await request("details", { uuid });
      const item = data?.data && typeof data.data === "object" ? data.data : {};
      const record = {
        uuid,
        title: typeof item.title === "string" ? item.title.trim() : "",
        publisher:
          typeof item.publisher === "string" ? item.publisher.trim() : "",
        publishedAt: Date.parse(item.published_at) || 0,
        url: typeof item.original_url === "string" ? item.original_url : null,
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null,
        summary: typeof item.incipit === "string" ? item.incipit.trim() : "",
        topics: Array.isArray(item.topics)
          ? item.topics.filter((value) => typeof value === "string")
          : [],
      };
      return remember(details, uuid, record, DETAILS_TTL_MS, DETAILS_CACHE_MAX);
    });
  }

  return {
    request,
    listTopic,
    articleDetails,
    pageSize: PAGE_SIZE,
    // Exposed for tests and diagnostics.
    cacheSizes: () => ({ listings: listings.size, details: details.size }),
  };
}

let shared;
function sharedFreeNewsClient() {
  if (!shared) shared = createFreeNewsClient();
  return shared;
}

module.exports = {
  FreeNewsError,
  createFreeNewsClient,
  sharedFreeNewsClient,
  SPACING_MS,
  PAGE_SIZE,
};
