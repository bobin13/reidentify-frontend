const test = require("node:test");
const assert = require("node:assert/strict");
const { createFreeNewsClient, SPACING_MS } = require("../free-news-client");
const { installInterestNewsRoutes, topicLabel } = require("../interest-news-routes");

const userId = "00000000-0000-4000-8000-000000000001";

// Virtual clock: sleep() advances time instead of waiting.
function virtualTime() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    advance: (ms) => {
      clock += ms;
    },
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function listing(topic, count, { hasMore = false, startMs = 1_700_000_000_000, step = 60_000 } = {}) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      uuid: `${topic}-${i}`,
      title: `${topic} story ${i}`,
      published_at: new Date(startMs - i * step).toISOString(),
      publisher: "Publisher",
    })),
    meta: { has_more: hasMore, next_offset: hasMore ? count : null },
  };
}

test("provider requests are serialized at least 500ms apart, even when fired together", async () => {
  const time = virtualTime();
  const starts = [];
  const client = createFreeNewsClient({
    now: time.now,
    sleep: time.sleep,
    getApiKey: () => "key",
    fetchImpl: async (url) => {
      starts.push(time.now());
      return jsonResponse(listing(new URL(url).searchParams.get("topic"), 1));
    },
  });

  await Promise.all([
    client.listTopic("cycling"),
    client.listTopic("food"),
    client.listTopic("music"),
  ]);

  assert.deepEqual(starts, [0, SPACING_MS, SPACING_MS * 2]);
});

test("a failed provider call does not block the requests queued behind it", async () => {
  const time = virtualTime();
  let calls = 0;
  const client = createFreeNewsClient({
    now: time.now,
    sleep: time.sleep,
    getApiKey: () => "key",
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      return jsonResponse(listing("food", 2));
    },
  });

  const [first, second] = await Promise.allSettled([
    client.listTopic("cycling"),
    client.listTopic("food"),
  ]);
  assert.equal(first.status, "rejected");
  assert.equal(first.reason.status, 502);
  assert.equal(second.status, "fulfilled");
  assert.equal(second.value.articles.length, 2);
});

test("topic listings and article details are cached and de-duplicated in flight", async () => {
  const time = virtualTime();
  const urls = [];
  const client = createFreeNewsClient({
    now: time.now,
    sleep: time.sleep,
    getApiKey: () => "key",
    fetchImpl: async (url) => {
      urls.push(url.pathname + url.search);
      if (url.pathname.endsWith("/details")) {
        return jsonResponse({
          data: {
            uuid: url.searchParams.get("uuid"),
            title: "Detail",
            original_url: "https://example.com/story",
            thumbnail: "https://example.com/pic.jpg",
            incipit: "Lead paragraph",
            publisher: "Publisher",
            published_at: "2026-01-01T00:00:00.000Z",
            topics: ["cycling"],
          },
        });
      }
      return jsonResponse(listing("cycling", 3));
    },
  });

  await Promise.all([client.listTopic("cycling"), client.listTopic("cycling")]);
  await client.listTopic("cycling");
  await Promise.all([client.articleDetails("a"), client.articleDetails("a")]);
  const detail = await client.articleDetails("a");

  assert.equal(urls.filter((u) => u.startsWith("/v1/news")).length, 1);
  assert.equal(urls.filter((u) => u.startsWith("/v1/details")).length, 1);
  assert.equal(detail.url, "https://example.com/story");
  assert.equal(detail.summary, "Lead paragraph");
});

test("a 429 from the provider becomes a 503 and pushes the next request back a second", async () => {
  const time = virtualTime();
  const starts = [];
  let calls = 0;
  const client = createFreeNewsClient({
    now: time.now,
    sleep: time.sleep,
    getApiKey: () => "key",
    fetchImpl: async () => {
      starts.push(time.now());
      calls++;
      return calls === 1 ? jsonResponse({}, 429) : jsonResponse(listing("food", 1));
    },
  });
  const [limited, ok] = await Promise.allSettled([
    client.listTopic("cycling"),
    client.listTopic("food"),
  ]);
  assert.equal(limited.reason.status, 503);
  assert.equal(ok.status, "fulfilled");
  assert.equal(starts[1] - starts[0], 1000);
});

function fakeApp() {
  const routes = new Map();
  return { routes, get: (path, handler) => routes.set(path, handler) };
}

async function invoke(handler, query = {}) {
  const res = {
    code: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(v) { this.value = v; return this; },
  };
  let failure;
  await handler({ userId, account: { uid: "firebase-viewer" }, query }, res, (e) => { failure = e; });
  if (failure) throw failure;
  return res;
}

function fakeDb(rows) {
  return {
    async query(sql, values) {
      assert.match(sql, /JOIN activities a/);
      assert.deepEqual(values, [userId]);
      return { rows };
    },
  };
}

function fakeClient({ perTopic, hasMore = {} }) {
  const listCalls = [];
  const detailCalls = [];
  return {
    listCalls,
    detailCalls,
    pageSize: 10,
    async listTopic(topic, offset = 0) {
      listCalls.push([topic, offset]);
      const total = perTopic[topic] ?? 0;
      const page = listing(topic, Math.max(0, Math.min(10, total - offset)), {
        hasMore: !!hasMore[topic] && offset + 10 < total,
        // Interleave topics by date: cycling stories are newer than food stories.
        startMs: 1_700_000_000_000 - (topic === "food" ? 30_000 : 0) - offset * 60_000,
      });
      return {
        topic,
        offset,
        articles: page.data.map((item) => ({
          uuid: item.uuid,
          title: item.title,
          publisher: item.publisher,
          publishedAt: Date.parse(item.published_at),
          topic,
        })),
        hasMore: page.meta.has_more,
        nextOffset: page.meta.next_offset,
      };
    },
    async articleDetails(uuid) {
      detailCalls.push(uuid);
      return {
        uuid,
        title: `Detail ${uuid}`,
        publisher: "Publisher",
        publishedAt: 0,
        url: `https://example.com/${uuid}`,
        thumbnail: "https://example.com/pic.jpg",
        summary: "Lead",
        topics: [],
      };
    },
  };
}

test("for-you merges one listing per topic newest-first and serves ten with details", async () => {
  const app = fakeApp();
  const client = fakeClient({ perTopic: { cycling: 10, food: 10 } });
  installInterestNewsRoutes(
    app,
    fakeDb([
      { topic: "cycling", activity: "Cycling" },
      { topic: "food", activity: "Baking" },
      { topic: "food", activity: "Cooking" },
    ]),
    { client },
  );

  const res = await invoke(app.routes.get("/api/news/for-you"));

  assert.equal(res.code, 200);
  assert.equal(res.value.articles.length, 10);
  assert.equal(res.value.nextOffset, 10);
  assert.deepEqual(client.listCalls, [["cycling", 0], ["food", 0]]);
  assert.equal(client.detailCalls.length, 10, "details only for the page shown");
  const dates = res.value.articles.map((a) => a.publishedAt);
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  assert.deepEqual(
    res.value.articles.slice(0, 2).map((a) => a.areaLabel),
    ["Cycling", "Food"],
  );
  assert.deepEqual(res.value.topics[1], {
    topic: "food",
    label: "Food",
    interests: ["Baking", "Cooking"],
  });
  assert.equal(res.value.articles[0].scope, "interest");
  assert.equal(res.value.articles[0].url, "https://example.com/cycling-0");
});

test("for-you offset 10 fetches the next listing page only where the provider has more", async () => {
  const app = fakeApp();
  const client = fakeClient({ perTopic: { cycling: 25, food: 10 }, hasMore: { cycling: true } });
  installInterestNewsRoutes(
    app,
    fakeDb([{ topic: "cycling", activity: "Cycling" }, { topic: "food", activity: "Baking" }]),
    { client },
  );

  const res = await invoke(app.routes.get("/api/news/for-you"), { offset: "10" });

  assert.equal(res.value.articles.length, 10);
  assert.equal(res.value.offset, 10);
  assert.equal(res.value.nextOffset, 20);
  assert.deepEqual(client.listCalls, [["cycling", 0], ["cycling", 10], ["food", 0]]);
});

test("for-you with no mapped interests returns a notice and never calls the provider", async () => {
  const app = fakeApp();
  const client = fakeClient({ perTopic: {} });
  installInterestNewsRoutes(app, fakeDb([]), { client });

  const res = await invoke(app.routes.get("/api/news/for-you"));

  assert.deepEqual(res.value.articles, []);
  assert.equal(res.value.nextOffset, null);
  assert.match(res.value.notice, /Add interests/);
  assert.equal(client.listCalls.length, 0);
});

test("for-you rejects a malformed offset", async () => {
  const app = fakeApp();
  installInterestNewsRoutes(app, fakeDb([]), { client: fakeClient({ perTopic: {} }) });
  const res = await invoke(app.routes.get("/api/news/for-you"), { offset: "ten" });
  assert.equal(res.code, 400);
});

test("topic labels read naturally", () => {
  assert.equal(topicLabel("arts-design"), "Arts & design");
  assert.equal(topicLabel("mental health"), "Mental health");
  assert.equal(topicLabel("cycling"), "Cycling");
});
