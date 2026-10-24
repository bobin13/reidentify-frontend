import { decodeHTML } from "entities";

const {
  feeds,
}: {
  feeds: { url: string; enabled: boolean }[];
} = require("../../shared/news-sources.json");
const publisherHosts = [
  ...new Set(
    feeds
      .filter((source) => source.enabled)
      .map((source) => new URL(source.url).hostname.replace(/^www\./, "")),
  ),
];

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    result[match[1].toLowerCase()] = decodeHTML(
      match[2] ?? match[3] ?? match[4] ?? "",
    ).trim();
  }
  return result;
}

export function usableNewsImage(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(decodeHTML(value.trim()), base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(
        url.hostname,
      ) ||
      url.hostname.includes(":") ||
      /(?:\.svg|\.ico)(?:$|[?#])/i.test(url.href) ||
      /(?:\/emoji\/|wp-smiley|gravatar|favicon|share_toronto_twitter|(?:^|\/)(?:site[-_])?(?:logo|placeholder|pixel|spacer)(?:[-_.\/]|$))/i.test(
        url.pathname,
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function photoSize(width: unknown, height: unknown) {
  const w = Number(width),
    h = Number(height);
  return !((w > 0 && w < 120) || (h > 0 && h < 80));
}

function embeddedPhoto(html: unknown, base: string): string | null {
  if (typeof html !== "string") return null;
  const tags =
    html.slice(0, 500000).match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  for (const tag of tags.slice(0, 30)) {
    const data = attributes(tag);
    if (!photoSize(data.width, data.height)) continue;
    for (const value of [data["data-src"], data["data-original"], data.src]) {
      const url = usableNewsImage(value, base);
      if (url) return url;
    }
  }
  return null;
}

export function imageFromFeedItem(
  item: RecordValue,
  base: string,
): string | null {
  const groups = [item, ...[item["media:group"]].flat().map(record)];
  for (const group of groups) {
    for (const name of ["media:content", "media:thumbnail", "enclosure"]) {
      const values = [group[name]].flat().slice(0, 12);
      for (const value of values) {
        const data = record(value);
        const type = String(data["@_type"] ?? "").toLowerCase();
        const medium = String(data["@_medium"] ?? "").toLowerCase();
        if (
          (type && !type.startsWith("image/")) ||
          (medium && medium !== "image")
        )
          continue;
        if (!photoSize(data["@_width"], data["@_height"])) continue;
        const url = usableNewsImage(data["@_url"], base);
        if (
          url &&
          (name === "media:thumbnail" ||
            type.startsWith("image/") ||
            medium === "image" ||
            /\.(?:jpe?g|png|webp|avif|gif)(?:$|\?)/i.test(url))
        )
          return url;
      }
    }
  }
  return (
    embeddedPhoto(item["content:encoded"], base) ??
    embeddedPhoto(item.description, base)
  );
}

export function imageFromArticlePage(
  html: string,
  base: string,
): string | null {
  const head = html
    .split(/<\/head\s*>/i, 1)[0]
    .slice(0, 200000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const tags = head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  const images: { name: string; value: string }[] = [];
  for (const tag of tags) {
    const data = attributes(tag);
    const name = (data.property || data.name || "").toLowerCase();
    if (
      [
        "og:image:secure_url",
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src",
      ].includes(name)
    ) {
      images.push({ name, value: data.content });
    }
  }
  // Prefer the publisher's article-preview image over a Twitter fallback.
  images.sort(
    (a, b) =>
      Number(a.name.startsWith("twitter:")) -
      Number(b.name.startsWith("twitter:")),
  );
  for (const image of images) {
    const url = usableNewsImage(image.value, base);
    if (url) return url;
  }
  return null;
}

function publisherPage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      publisherHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

const cache = new Map<string, { image: string | null; expires: number }>();

// Used after headlines appear. The screen limits lookups to two at a time.
export async function articlePreviewImage(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted || !publisherPage(url)) return null;
  const saved = cache.get(url);
  if (saved && saved.expires > Date.now()) return saved.image;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel);
  if (signal.aborted) cancel();
  const timer = setTimeout(cancel, 5000);
  let image: string | null = null;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (!response.ok || (response.url && !publisherPage(response.url)))
      return null;
    const type = response.headers.get("content-type");
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) return null;
    if (Number(response.headers.get("content-length")) > 2000000) return null;
    const html = await response.text();
    if (html.length <= 2000000)
      image = imageFromArticlePage(html, response.url || url);
    return image;
  } catch {
    // A missing/blocked/timed-out photo must never make the news feed fail.
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (!signal.aborted) {
      cache.delete(url);
      cache.set(url, {
        image,
        expires: Date.now() + (image ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000),
      });
      while (cache.size > 120) cache.delete(cache.keys().next().value!);
    }
  }
}