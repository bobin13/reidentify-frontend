const { createHash } = require("node:crypto");
const jpeg = require("jpeg-js");

// Presentation settings do not change the identity of an original photograph.
function imageIdentity(value) {
  try {
    let url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (/^i[0-3]\.wp\.com$/i.test(url.hostname)) {
      url = new URL("https://" + url.pathname.slice(1) + url.search);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(
      /-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)$)/i,
      "",
    );
    for (const name of [...url.searchParams.keys()]) {
      if (
        /^(?:w|h|width|height|resize|fit|crop|quality|q|strip|dpr|auto|format|ssl|zoom|fbclid)$/i.test(
          name,
        ) ||
        /^utm_/i.test(name)
      )
        url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function photoKey(identity) {
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function thumbnail(image, rect, columns, rows) {
  const cells = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      let r = 0,
        g = 0,
        b = 0;
      // Average a grid inside each cell to tolerate resized/recompressed copies.
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = Math.min(
            image.width - 1,
            Math.floor(rect.x + ((x + (sx + 0.5) / 4) * rect.width) / columns),
          );
          const py = Math.min(
            image.height - 1,
            Math.floor(rect.y + ((y + (sy + 0.5) / 4) * rect.height) / rows),
          );
          const i = (py * image.width + px) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
        }
      r /= 16;
      g /= 16;
      b /= 16;
      cells.push({ r, g, b, gray: 0.299 * r + 0.587 * g + 0.114 * b });
    }
  return cells;
}

function bits(values) {
  let low = 0,
    high = 0;
  values.forEach((value, i) => {
    if (value) {
      if (i < 32) low |= 1 << i;
      else high |= 1 << (i - 32);
    }
  });
  return [low >>> 0, high >>> 0];
}

function fingerprint(bytes) {
  const exact = createHash("sha256").update(bytes).digest("hex");
  const image = jpeg.decode(bytes, {
    useTArray: true,
    maxResolutionInMP: 2,
    maxMemoryUsageInMB: 64,
  });
  if (image.width < 120 || image.height < 80) return { exact, variants: [] };
  const variants = [];
  const crops = [
    [1, 1],
    [0.9, 1],
    [0.8, 1],
    [1, 0.9],
    [1, 0.8],
    [0.9, 0.9],
    [0.8, 0.8],
    [0.8, 0.9],
    [0.9, 0.8],
  ];
  for (const [fx, fy] of crops) {
    for (const x of fx === 1 ? [0] : [0, 0.5, 1]) {
      for (const y of fy === 1 ? [0] : [0, 0.5, 1]) {
        const rect = {
          x: image.width * (1 - fx) * x,
          y: image.height * (1 - fy) * y,
          width: image.width * fx,
          height: image.height * fy,
        };
        const difference = thumbnail(image, rect, 9, 8);
        const average = thumbnail(image, rect, 8, 8);
        const mean = average.reduce((sum, p) => sum + p.gray, 0) / 64;
        const variance =
          average.reduce((sum, p) => sum + (p.gray - mean) ** 2, 0) / 64;
        // Flat logos/sky/blank images must not match just because both are flat.
        if (variance < 144) continue;
        const d = [];
        for (let row = 0; row < 8; row++)
          for (let col = 0; col < 8; col++) {
            d.push(
              difference[row * 9 + col + 1].gray >
                difference[row * 9 + col].gray,
            );
          }
        variants.push({
          d: bits(d),
          a: bits(average.map((p) => p.gray > mean)),
          color: ["r", "g", "b"].map(
            (channel) => average.reduce((sum, p) => sum + p[channel], 0) / 64,
          ),
        });
      }
    }
  }
  return { exact, variants };
}

function countBits(n) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function difference(a, b) {
  return countBits(a[0] ^ b[0]) + countBits(a[1] ^ b[1]);
}

// A conservative visual duplicate check, not a topic/face classifier or ML.
function samePhoto(a, b) {
  if (!a || !b) return false;
  if (a.exact === b.exact) return true;
  for (const x of a.variants)
    for (const y of b.variants) {
      if (
        x.color.reduce(
          (sum, value, i) => sum + Math.abs(value - y.color[i]),
          0,
        ) > 24
      )
        continue;
      const d = difference(x.d, y.d);
      if (d > 3) continue;
      const h = difference(x.a, y.a);
      if (h <= 4 && d + h <= 5) return true;
    }
  return false;
}

function inspectable(value) {
  try {
    const url = new URL(value);
    // Visual fetching is deliberately restricted to the affected publisher's
    // verified upload host/path. Other publishers still get URL de-duplication.
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^(?:www\.)?globalnews\.ca$/i.test(url.hostname) &&
      url.pathname.startsWith("/wp-content/uploads/") &&
      /\.jpe?g$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function createPhotoGrouper({
  fetchImpl = fetch,
  now = Date.now,
  budgetMs = 2500,
  timeoutMs = 4000,
} = {}) {
  const cache = new Map();
  let active = 0;
  const waiting = [];
  async function bounded(task) {
    if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  function inspect(url) {
    const saved = cache.get(url);
    if (saved && saved.expires > now()) return saved;
    const record = { ready: false, value: null, expires: now() + 6 * 3600000 };
    cache.set(url, record);
    record.promise = bounded(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // This publisher already exposes these thumbnail parameters in RSS.
        // Compare small copies so original press photos cannot stall decoding.
        const thumbnailURL = new URL(url);
        thumbnailURL.searchParams.set("w", "480");
        thumbnailURL.searchParams.set("quality", "60");
        thumbnailURL.searchParams.set("strip", "all");
        const response = await fetchImpl(thumbnailURL.toString(), {
          signal: controller.signal,
          redirect: "error",
          headers: {
            Accept: "image/jpeg",
            "User-Agent": "ReIdentify-NewsPreview/1.0",
          },
        });
        if (
          !response.ok ||
          !/^image\/jpe?g/i.test(response.headers.get("content-type") || "") ||
          Number(response.headers.get("content-length")) > 900000
        )
          return;
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 900000) return;
            chunks.push(Buffer.from(part.value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const bytes = Buffer.concat(chunks);
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
        record.value = fingerprint(bytes);
      } catch {
        // Photo grouping must never turn a working news feed into an error.
      } finally {
        clearTimeout(timer);
        record.ready = true;
        record.expires = now() + (record.value ? 6 * 3600000 : 10 * 60000);
        if (cache.size > 250)
          for (const [key, value] of cache) {
            if (value.ready && key !== url) {
              cache.delete(key);
              break;
            }
          }
      }
    });
    return record;
  }
  return {
    async group(articles) {
      const identities = [
        ...new Set(
          articles.map((a) => imageIdentity(a.imageUrl)).filter(Boolean),
        ),
      ];
      const records = new Map(
        identities
          .filter(inspectable)
          .slice(0, 20)
          .map((url) => [url, inspect(url)]),
      );
      let timer;
      try {
        await Promise.race([
          Promise.all([...records.values()].map((record) => record.promise)),
          new Promise((resolve) => {
            timer = setTimeout(resolve, budgetMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const representatives = [],
        keys = new Map();
      for (const identity of identities) {
        const current = records.get(identity)?.value;
        const previous =
          current &&
          representatives.find((item) => samePhoto(item.value, current));
        const key = previous?.key || photoKey(identity);
        keys.set(identity, key);
        if (current && !previous) representatives.push({ key, value: current });
      }
      return {
        articles: articles.map((article) => ({
          ...article,
          imageGroupKey: keys.get(imageIdentity(article.imageUrl)) || null,
        })),
        imageGroupingPending: [...records.values()].some(
          (record) => !record.ready,
        ),
      };
    },
  };
}

module.exports = { createPhotoGrouper, imageIdentity, fingerprint, samePhoto };