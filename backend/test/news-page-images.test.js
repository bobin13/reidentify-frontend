const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPageImageFinder,
  imageFromArticlePage,
} = require("../news-page-images");

const imageUrl = (value, base) => {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && !/logo/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

function page(html, { status = 200, headers = {} } = {}) {
  const bytes = Buffer.from(html);
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(
      Object.entries({ "content-type": "text/html", ...headers }),
    ),
    body: {
      cancel: async () => {},
      getReader: () => ({
        read: async () =>
          sent ? { done: true } : ((sent = true), { done: false, value: bytes }),
        cancel: async () => {},
      }),
    },
  };
}

const article = (url, imageUrl = null) => ({ id: url, url, imageUrl });

test("prefers og:image over twitter:image and skips unusable images", () => {
  const html = `<html><head>
    <meta name="twitter:image" content="https://news.example/twitter.jpg">
    <meta property="og:image" content="/img/logo.png">
    <meta property="og:image" content="/img/story.jpg">
  </head><body><meta property="og:image" content="https://news.example/body.jpg"></body>`;
  assert.equal(
    imageFromArticlePage(html, "https://news.example/a", imageUrl),
    "https://news.example/img/story.jpg",
  );
});

test("fills previewImageUrl only for stories without a feed photo on publisher sites", async () => {
  const fetched = [];
  const finder = createPageImageFinder({
    imageUrl,
    publisherHosts: ["news.example"],
    fetchImpl: async (url) => {
      fetched.push(url);
      return page(`<head><meta property="og:image" content="https://news.example/p.jpg"></head>`);
    },
  });
  const result = await finder.fill([
    article("https://www.news.example/a"),
    article("https://news.example/b", "https://news.example/feed.jpg"),
    article("https://elsewhere.example/c"),
  ]);
  assert.deepEqual(fetched, ["https://www.news.example/a"]);
  assert.deepEqual(
    result.articles.map((a) => a.previewImageUrl),
    ["https://news.example/p.jpg", null, null],
  );
  assert.equal(result.pending, false);
});

test("redirects are followed only while they stay on publisher sites", async () => {
  const fetched = [];
  const finder = createPageImageFinder({
    imageUrl,
    publisherHosts: ["news.example"],
    fetchImpl: async (url) => {
      fetched.push(url);
      if (url.endsWith("/moved")) {
        return page("", { status: 301, headers: { location: "/final" } });
      }
      if (url.endsWith("/escape")) {
        return page("", {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        });
      }
      return page(`<head><meta property="og:image" content="https://news.example/f.jpg"></head>`);
    },
  });
  const result = await finder.fill([
    article("https://news.example/moved"),
    article("https://news.example/escape"),
  ]);
  assert.deepEqual(fetched, [
    "https://news.example/moved",
    "https://news.example/escape",
    "https://news.example/final",
  ]);
  assert.deepEqual(
    result.articles.map((a) => a.previewImageUrl),
    ["https://news.example/f.jpg", null],
  );
});

test("slow pages finish in the background and are cached for the next request", async () => {
  let release;
  let calls = 0;
  const finder = createPageImageFinder({
    imageUrl,
    publisherHosts: ["news.example"],
    budgetMs: 5,
    fetchImpl: async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
      return page(`<head><meta property="og:image" content="https://news.example/s.jpg"></head>`);
    },
  });
  const stories = [article("https://news.example/slow")];

  const first = await finder.fill(stories);
  assert.equal(first.pending, true);
  assert.equal(first.articles[0].previewImageUrl, null);

  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await finder.fill(stories);
  assert.equal(second.pending, false);
  assert.equal(second.articles[0].previewImageUrl, "https://news.example/s.jpg");
  assert.equal(calls, 1, "the page is read once");
});

test("a failing page never breaks the feed", async () => {
  const finder = createPageImageFinder({
    imageUrl,
    publisherHosts: ["news.example"],
    fetchImpl: async () => {
      throw new Error("socket hang up");
    },
  });
  const result = await finder.fill([article("https://news.example/a")]);
  assert.equal(result.articles[0].previewImageUrl, null);
  assert.equal(result.pending, false);
});
