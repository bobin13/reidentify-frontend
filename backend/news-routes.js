const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { decodeHTML } = require("entities");
const { createPhotoGrouper } = require("./news-photo-groups");
const { cities } = require("../shared/ontario-areas.json");
const { feeds } = require("../shared/news-sources.json");

const cityIndex = new Map(cities.map((city) => [city.id, city]));
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});
const MINUTE = 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function plainText(value) {
  if (typeof value !== "string") return "";
  return decodeHTML(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function array(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function publicUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(decodeHTML(value.trim()), base);
    // A few current HTTPS feeds still emit old HTTP links to their own site.
    // Upgrade only that publisher's host; other insecure links stay excluded.
    if (
      url.protocol === "http:" &&
      new URL(base).hostname.replace(/^www\./, "") ===
        url.hostname.replace(/^www\./, "")
    ) {
      url.protocol = "https:";
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      url.hostname.includes(":") ||
      /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(
        url.hostname,
      )
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function imageUrl(value, base) {
  const url = publicUrl(value, base);
  if (
    !url ||
    /(?:\.svg|\.ico)(?:$|[?#])/i.test(url) ||
    /(?:gravatar|wp-smiley|favicon|(?:^|\/)(?:site[-_])?(?:logo|placeholder|pixel|spacer)(?:[-_.\/]|$))/i.test(
      new URL(url).pathname,
    )
  )
    return null;
  return url;
}

function itemImage(item, base) {
  for (const group of [item, ...array(item["media:group"])]) {
    if (!group || typeof group !== "object") continue;
    for (const name of ["media:content", "media:thumbnail", "enclosure"]) {
      for (const media of array(group[name]).slice(0, 12)) {
        if (!media || typeof media !== "object") continue;
        const type = String(media["@_type"] || "");
        const medium = String(media["@_medium"] || "");
        if (
          (type && !type.startsWith("image/")) ||
          (medium && medium !== "image")
        )
          continue;
        if (
          (Number(media["@_width"]) > 0 && Number(media["@_width"]) < 120) ||
          (Number(media["@_height"]) > 0 && Number(media["@_height"]) < 80)
        )
          continue;
        const url = imageUrl(media["@_url"], base);
        if (
          url &&
          (name === "media:thumbnail" ||
            type.startsWith("image/") ||
            medium === "image" ||
            /\.(?:jpe?g|png|webp|gif|avif)(?:$|\?)/i.test(url))
        )
          return url;
      }
    }
  }
  for (const html of [
    item["content:encoded"],
    item.description,
    item.summary,
  ]) {
    if (typeof html !== "string") continue;
    const tags =
      html.slice(0, 300000).match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || [];
    for (const tag of tags.slice(0, 20)) {
      const attributes = {};
      const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      let match;
      while ((match = pattern.exec(tag)))
        attributes[match[1].toLowerCase()] = match[2] || match[3] || match[4];
      if (
        (Number(attributes.width) > 0 && Number(attributes.width) < 120) ||
        (Number(attributes.height) > 0 && Number(attributes.height) < 80)
      )
        continue;
      for (const value of [
        attributes["data-src"],
        attributes["data-original"],
        attributes.src,
      ]) {
        const url = imageUrl(value, base);
        if (url) return url;
      }
    }
  }
  return null;
}

function parseFeed(xml, source, now = Date.now()) {
  if (Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported feed");
  const clean = xml.replace(/^\uFEFF/, "").trim();
  if (XMLValidator.validate(clean) !== true)
    throw new Error("Invalid feed XML");
  const feed = parser.parse(clean);
  const channel = feed.rss?.channel;
  const atom = feed.feed;
  if (!channel && !atom && !feed["rdf:RDF"]) throw new Error("Not a news feed");
  const items = array(channel?.item || atom?.entry || feed["rdf:RDF"]?.item);
  const articles = [];
  for (const item of items.slice(0, 100)) {
    const title = plainText(item.title?.["#text"] || item.title);
    const link =
      typeof item.link === "string"
        ? item.link
        : array(item.link).find((value) => value?.["@_rel"] !== "self")?.[
            "@_href"
          ];
    const url = publicUrl(link, source.url);
    const publishedAt = Date.parse(
      item.pubDate || item.published || item.updated || item["dc:date"] || "",
    );
    // Missing, old, or clearly future-dated news must not appear as fresh news.
    if (
      !title ||
      !url ||
      !Number.isFinite(publishedAt) ||
      publishedAt < now - 30 * 24 * 60 * MINUTE ||
      publishedAt > now + 24 * 60 * MINUTE
    )
      continue;
    const fullSummary = plainText(
      item.description || item.summary?.["#text"] || item.summary || "",
    );
    const categories = array(item.category)
      .map((c) =>
        typeof c === "string" ? c : c?.["#text"] || c?.["@_term"] || "",
      )
      .join(" ");
    articles.push({
      id: url,
      title: title.slice(0, 280),
      url,
      source: source.name,
      summary:
        fullSummary.length > 220
          ? `${fullSummary.slice(0, 217).trimEnd()}…`
          : fullSummary,
      publishedAt,
      imageUrl: itemImage(item, url),
      // Keep more text for server-side place matching; do not return full stories.
      searchText: normalize(`${title} ${fullSummary.slice(0, 3000)}`),
      categories: normalize(categories),
    });
  }
  return articles;
}

function chooseSources(city) {
  const candidates = feeds.filter(
    (source) =>
      source.enabled &&
      !source.provinceWide &&
      city &&
      (source.cityIds.includes(city.id) ||
        (city.region && source.regions.includes(city.region))),
  );
  candidates.sort(
    (a, b) =>
      Number(b.cityIds.includes(city.id)) - Number(a.cityIds.includes(city.id)),
  );
  return [
    ...candidates.slice(0, 4),
    ...feeds.filter((source) => source.enabled && source.provinceWide),
  ];
}

function mentions(text, place) {
  const term = normalize(place);
  return term.length >= 3 && ` ${text} `.includes(` ${term} `);
}

const COMMUNITY_TERMS = [
  "community",
  "volunteer",
  "recreation",
  "park",
  "garden",
  "housing",
  "transit",
  "neighbour",
  "neighborhood",
  "accessib",
];
const HEALTH_TERMS = [
  "health",
  "safety",
  "caregiver",
  "senior",
  "older adult",
  "wellbeing",
  "well being",
  "hospital",
  "vaccin",
];
const CULTURE_TERMS = [
  "library",
  "libraries",
  "book",
  "reading",
  "learning",
  "workshop",
  "museum",
  "music",
  "culture",
  "arts",
  "festival",
  "theatre",
];
function topicsFor(text) {
  return [
    ["community", COMMUNITY_TERMS],
    ["health", HEALTH_TERMS],
    ["culture", CULTURE_TERMS],
  ]
    .filter(([, words]) => words.some((word) => text.includes(word)))
    .map(([topic]) => topic);
}

function compileNews(city, district, results, now) {
  const localTerms = city
    ? [city.name, ...city.districts.map((d) => d.name)]
    : [];
  if (city?.name === "Prince Edward")
    localTerms.push("Prince Edward County", "Picton", "Wellington");
  if (city?.name === "Norfolk County")
    localTerms.push("Simcoe", "Port Dover", "Delhi", "Waterford");
  if (city?.name === "Madawaska Valley")
    localTerms.push("Barrys Bay", "Barry s Bay");
  if (city?.name === "New Tecumseth")
    localTerms.push("Alliston", "Beeton", "Tottenham");
  const articles = [];
  for (const result of results) {
    for (const article of result.articles) {
      const local =
        !!city &&
        localTerms.some((place) => mentions(article.searchText, place));
      const outside =
        /\b(?:world|international|national|entertainment gossip)\b/.test(
          article.categories,
        ) || /\/(?:world|national|international)\//i.test(article.url);
      if (!result.source.provinceWide && outside && !local) continue;
      const scope = local
        ? "local"
        : result.source.provinceWide
          ? "ontario"
          : "regional";
      const { searchText, categories, ...card } = article;
      articles.push({
        ...card,
        scope,
        topics: topicsFor(searchText),
        areaLabel:
          scope === "ontario"
            ? "Ontario"
            : scope === "local"
              ? city.name
              : "Regional news",
        stale: result.stale,
        // A district mention only changes ordering within its existing area tier.
        rank:
          (scope === "local" ? 20 : scope === "regional" ? 10 : 0) +
          (district && mentions(searchText, district.name) ? 2 : 0),
      });
    }
  }
  // Prefer supplied article photos; retain area and date ordering within each group.
  // This also keeps an illustrated copy when multiple feeds repeat a story.
  articles.sort(
    (a, b) =>
      Number(!!b.imageUrl) - Number(!!a.imageUrl) ||
      b.rank - a.rank ||
      b.publishedAt - a.publishedAt,
  );
  const seenUrls = new Set(),
    seenTitles = new Set();
  const unique = [];
  for (const article of articles) {
    const urlKey = article.url.replace(/\/$/, "");
    const titleKey = normalize(article.title);
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    const { rank, ...card } = article;
    unique.push(card);
  }
  const regional = unique.filter((a) => a.scope !== "ontario");
  const provincial = unique.filter((a) => a.scope === "ontario");
  const failed = results.filter((r) => !r.available);
  return {
    city: city?.name || null,
    cityId: city?.id || null,
    district: district?.name || null,
    coverage: regional.length ? "local-and-regional" : "ontario-only",
    articles: [
      ...regional.slice(0, 24),
      ...provincial.slice(0, city ? 6 : 18),
    ].sort((a, b) => Number(!!b.imageUrl) - Number(!!a.imageUrl)),
    checkedAt: results.some((r) => r.checkedAt)
      ? new Date(
          Math.max(...results.map((r) => r.checkedAt || 0)),
        ).toISOString()
      : null,
    generatedAt: new Date(now).toISOString(),
    sources: results.map((r) => ({
      name: r.source.name,
      available: r.available,
      stale: r.stale,
    })),
    notice: failed.length
      ? "Some publishers could not be refreshed. Available news is shown below."
      : null,
  };
}

function createNewsService({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 7000,
  photoBudgetMs = 2500,
} = {}) {
  const photos = createPhotoGrouper({
    fetchImpl,
    now,
    budgetMs: photoBudgetMs,
  });
  const cache = new Map(),
    inflight = new Map();
  let active = 0;
  const waiting = [];
  async function bounded(task) {
    if (active >= 8) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  async function download(source) {
    const saved = cache.get(source.id);
    if (saved && saved.expires > now()) return saved;
    if (inflight.has(source.id)) return inflight.get(source.id);
    const job = bounded(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(source.url, {
          signal: controller.signal,
          headers: {
            Accept:
              "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "User-Agent": "ReIdentify/1.0 (community news reader)",
          },
        });
        if (!response.ok)
          throw new Error(`Publisher returned ${response.status}`);
        if (Number(response.headers.get("content-length")) > MAX_BYTES)
          throw new Error("Feed too large");
        // Enforce the cap while reading, not only after allocating the whole feed.
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > MAX_BYTES) throw new Error("Feed too large");
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const articles = parseFeed(
          Buffer.concat(chunks).toString("utf8"),
          source,
          now(),
        );
        const record = {
          source,
          articles,
          checkedAt: now(),
          successAt: now(),
          available: true,
          stale: false,
          expires: now() + 15 * MINUTE,
        };
        cache.set(source.id, record);
        return record;
      } catch {
        const usable = saved && now() - saved.successAt < 24 * 60 * MINUTE;
        const record = {
          source,
          articles: usable
            ? saved.articles.filter(
                (a) => a.publishedAt >= now() - 30 * 24 * 60 * MINUTE,
              )
            : [],
          checkedAt: now(),
          successAt: saved?.successAt || 0,
          available: false,
          stale: !!usable,
          expires: now() + 2 * MINUTE,
        };
        cache.set(source.id, record);
        return record;
      } finally {
        clearTimeout(timer);
      }
    });
    inflight.set(source.id, job);
    try {
      return await job;
    } finally {
      inflight.delete(source.id);
    }
  }
  return {
    async load(city, district) {
      const results = await Promise.all(chooseSources(city).map(download));
      if (
        results.every((result) => !result.available && !result.articles.length)
      ) {
        const error = new Error(
          "News is unavailable right now. Please try again shortly.",
        );
        error.status = 503;
        throw error;
      }
      const news = compileNews(city, district, results, now());
      return { ...news, ...(await photos.group(news.articles)) };
    },
  };
}

function installNewsRoutes(app, options = {}) {
  const service = createNewsService(options);
  // Public read-only route: guests can see Ontario news without a Firebase login.
  // Only catalogue IDs are accepted. Clients cannot provide publisher URLs.
  app.get("/news", async (req, res, next) => {
    try {
      const { cityId, districtId } = req.query;
      if (
        (cityId !== undefined && typeof cityId !== "string") ||
        (districtId !== undefined && typeof districtId !== "string")
      ) {
        return res
          .status(400)
          .json({ message: "Choose a valid Ontario area." });
      }
      const city = cityId ? cityIndex.get(cityId) : null;
      if (
        (cityId !== undefined && !city) ||
        (districtId !== undefined && !city)
      ) {
        return res
          .status(400)
          .json({ message: "Choose a valid Ontario city." });
      }
      const district = districtId
        ? city.districts.find((d) => d.id === districtId)
        : null;
      if (districtId !== undefined && !district) {
        return res
          .status(400)
          .json({ message: "Choose a district belonging to this city." });
      }
      res.set("Cache-Control", "no-store");
      res.json(await service.load(city, district));
    } catch (error) {
      if (error.status === 503)
        return res.status(503).json({ message: error.message });
      next(error);
    }
  });
}

module.exports = {
  installNewsRoutes,
  createNewsService,
  parseFeed,
  chooseSources,
  compileNews,
};