// News chosen from the signed-in member's interests.
//
// activities.activity is the interest shown in the app; activities.api_topic
// is the FreeNewsAPI topic that returns related news. The provider accepts one
// topic per request, so a member with several interests needs one listing per
// distinct topic. Listings are merged newest-first and served ten at a time.
// Article URLs and images come only from the details endpoint, so details
// are fetched just for the ten stories in the requested page.

const { FreeNewsError, sharedFreeNewsClient } = require("./free-news-client");

const PAGE = 10;
const MAX_LISTING_PAGES_PER_TOPIC = 5;

function topicLabel(topic) {
  const words = String(topic)
    .replace(/-/g, " & ")
    .replace(/_/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function safeImageUrl(value) {
  const url = safeHttpsUrl(value);
  if (!url || /\.svg(?:$|[?#])/i.test(url)) return null;
  return url;
}

// Interests mapped to provider topics, in the member's catalogue order.
async function topicsForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT a.api_topic AS topic, a.activity
       FROM user_activities ua
       JOIN activities a ON a.activity_id = ua.activity_id
      WHERE ua.user_id = $1::uuid
        AND a.api_topic IS NOT NULL
        AND btrim(a.api_topic) <> ''
      ORDER BY a.groupid, a.activity`,
    [userId],
  );
  const byTopic = new Map();
  for (const row of rows) {
    const topic = row.topic.trim();
    const entry = byTopic.get(topic) || {
      topic,
      label: topicLabel(topic),
      interests: [],
    };
    if (!entry.interests.includes(row.activity)) entry.interests.push(row.activity);
    byTopic.set(topic, entry);
  }
  return [...byTopic.values()];
}

// Merge enough listing pages from every topic to cover [offset, offset+PAGE).
async function mergedListing(client, topics, offset) {
  const needed = offset + PAGE;
  const pagesNeeded = Math.min(
    MAX_LISTING_PAGES_PER_TOPIC,
    Math.ceil(needed / client.pageSize),
  );
  const seen = new Set();
  const merged = [];
  let anyMore = false;
  const failures = [];

  for (const entry of topics) {
    let pageOffset = 0;
    for (let page = 0; page < pagesNeeded; page++) {
      let listing;
      try {
        listing = await client.listTopic(entry.topic, pageOffset);
      } catch (error) {
        failures.push({ topic: entry.topic, error });
        break;
      }
      for (const article of listing.articles) {
        if (seen.has(article.uuid)) continue;
        seen.add(article.uuid);
        merged.push({ ...article, topicEntry: entry });
      }
      if (!listing.hasMore || listing.nextOffset == null) break;
      pageOffset = listing.nextOffset;
      if (page === pagesNeeded - 1) anyMore = true;
    }
  }

  merged.sort((a, b) => b.publishedAt - a.publishedAt || a.uuid.localeCompare(b.uuid));
  return { merged, anyMore, failures };
}

function installInterestNewsRoutes(app, db, { client = sharedFreeNewsClient() } = {}) {
  app.get("/api/news/for-you", async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const rawOffset = req.query.offset ?? "0";
      const offset = Number(rawOffset);
      if (
        typeof rawOffset !== "string" ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > PAGE * MAX_LISTING_PAGES_PER_TOPIC * 10
      ) {
        return res.status(400).json({ message: "Check the news page." });
      }

      const topics = await topicsForUser(db, req.userId);
      if (!topics.length) {
        return res.json({
          articles: [],
          offset,
          nextOffset: null,
          topics: [],
          generatedAt: new Date().toISOString(),
          notice: "Add interests in Search to see news picked for you.",
        });
      }

      const { merged, anyMore, failures } = await mergedListing(
        client,
        topics,
        offset,
      );
      if (failures.length === topics.length) throw failures[0].error;

      const slice = merged.slice(offset, offset + PAGE);
      const articles = [];
      for (const item of slice) {
        let detail;
        try {
          detail = await client.articleDetails(item.uuid);
        } catch (error) {
          // Keep serving the rest of the page; this story has no link yet.
          if (error instanceof FreeNewsError && error.status === 503) throw error;
          continue;
        }
        const url = safeHttpsUrl(detail.url);
        if (!url) continue;
        articles.push({
          id: item.uuid,
          title: detail.title || item.title,
          summary: detail.summary.slice(0, 240),
          url,
          source: detail.publisher || item.publisher || "News",
          publishedAt: detail.publishedAt || item.publishedAt || null,
          imageUrl: safeImageUrl(detail.thumbnail),
          scope: "interest",
          areaLabel: item.topicEntry.label,
          topics: detail.topics.length ? detail.topics : [item.topic],
          interests: item.topicEntry.interests,
          stale: false,
        });
      }

      const hasMore = merged.length > offset + PAGE || anyMore;
      res.json({
        articles,
        offset,
        nextOffset: hasMore ? offset + PAGE : null,
        topics,
        generatedAt: new Date().toISOString(),
        notice: failures.length
          ? `Some interests could not be checked right now (${failures
              .map((item) => topicLabel(item.topic))
              .join(", ")}).`
          : null,
      });
    } catch (error) {
      if (error instanceof FreeNewsError) {
        return res.status(error.status).json({ message: error.message });
      }
      next(error);
    }
  });
}

module.exports = {
  installInterestNewsRoutes,
  topicsForUser,
  mergedListing,
  topicLabel,
  PAGE,
};
