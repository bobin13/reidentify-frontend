const { decodeHTML } = require("entities");

// Some feeds ship stories without a photo. Their article pages usually name
// one in <meta property="og:image">. Looking it up here (instead of on each
// phone) reads each page once for every member, reads only the <head>, and
// keeps mobile data use down.

const HEAD_LIMIT = 512 * 1024;
const PREVIEW_TAGS = [
  "og:image:secure_url",
  "og:image",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
];

function attributes(tag) {
  const result = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    result[match[1].toLowerCase()] = decodeHTML(
      match[2] ?? match[3] ?? match[4] ?? "",
    ).trim();
  }
  return result;
}

// `imageUrl(value, base)` is the feed parser's URL check, so page photos
// follow the same rules as feed photos.
function imageFromArticlePage(html, base, imageUrl) {
  const head = html
    .split(/<\/head\s*>/i, 1)[0]
    .slice(0, HEAD_LIMIT)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const found = [];
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const data = attributes(tag);
    const name = (data.property || data.name || "").toLowerCase();
    if (PREVIEW_TAGS.includes(name)) found.push({ name, value: data.content });
  }
  // Prefer the publisher's article-preview image over a Twitter fallback.
  found.sort(
    (a, b) =>
      Number(a.name.startsWith("twitter:")) -
      Number(b.name.startsWith("twitter:")),
  );
  for (const image of found) {
    const url = imageUrl(image.value, base);
    if (url) return url;
  }
  return null;
}

function createPageImageFinder({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  imageUrl,
  publisherHosts,
  budgetMs = 1500,
  timeoutMs = 5000,
  concurrency = 3,
  maxRedirects = 3,
} = {}) {
  const cache = new Map();
  let active = 0;
  const waiting = [];

  async function bounded(task) {
    if (active >= concurrency) await new Promise((r) => waiting.push(r));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }

  function publisherPage(value) {
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

  // Follows redirects by hand so every hop is checked against the publisher
  // list before it is requested.
  async function readHead(pageUrl, signal) {
    let url = pageUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!publisherPage(url)) return null;
      const response = await fetchImpl(url, {
        signal,
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ReIdentify/1.0 (community news reader)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return null;
        url = new URL(location, url).href;
        continue;
      }
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(type)) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      let tail = "";
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          const bytes = Buffer.from(part.value);
          chunks.push(bytes);
          size += bytes.length;
          const text = tail + bytes.toString("latin1");
          if (size >= HEAD_LIMIT || /<\/head\s*>/i.test(text)) break;
          tail = text.slice(-16);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return { html: Buffer.concat(chunks).toString("utf8"), url };
    }
    return null;
  }

  function lookup(pageUrl) {
    const saved = cache.get(pageUrl);
    if (saved && saved.expires > now()) return saved;
    const record = { ready: false, value: null, expires: Infinity };
    cache.delete(pageUrl);
    cache.set(pageUrl, record);
    record.promise = bounded(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const page = await readHead(pageUrl, controller.signal);
        if (page) record.value = imageFromArticlePage(page.html, page.url, imageUrl);
      } catch {
        // A missing or blocked photo must never make the news feed fail.
      } finally {
        clearTimeout(timer);
        record.ready = true;
        // Found photos keep for a day; misses are retried after 10 minutes.
        record.expires = now() + (record.value ? 24 * 3600000 : 10 * 60000);
        while (cache.size > 500) cache.delete(cache.keys().next().value);
      }
    });
    return record;
  }

  return {
    // Adds `previewImageUrl` to stories without a feed photo. Waits up to
    // `budgetMs`; lookups still running carry on in the background and
    // `pending` tells the app to ask again shortly.
    async fill(articles) {
      const records = new Map();
      for (const article of articles) {
        if (!article.imageUrl && publisherPage(article.url)) {
          records.set(article.url, lookup(article.url));
        }
      }
      const unfinished = [...records.values()].filter((r) => !r.ready);
      if (unfinished.length) {
        let timer;
        try {
          await Promise.race([
            Promise.all(unfinished.map((record) => record.promise)),
            new Promise((resolve) => {
              timer = setTimeout(resolve, budgetMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      return {
        articles: articles.map((article) => ({
          ...article,
          previewImageUrl: records.get(article.url)?.value ?? null,
        })),
        pending: [...records.values()].some((record) => !record.ready),
      };
    },
  };
}

module.exports = { createPageImageFinder, imageFromArticlePage };
