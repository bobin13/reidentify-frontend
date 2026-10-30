// Live Ontario venue/address suggestions. No Firestore or paid Places API calls.
const { setTimeout: pause } = require("node:timers/promises");

const BOUNDS = { west: -95.5, south: 41.6, east: -74, north: 57 };
const ATTRIBUTION = "© OpenStreetMap contributors · Photon";
const plain = (value, max = 200) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
const keyFor = (value) => value.normalize("NFKC").toLowerCase();
const inside = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= BOUNDS.south &&
  latitude <= BOUNDS.north &&
  longitude >= BOUNDS.west &&
  longitude <= BOUNDS.east;
const failure = (status, message, retryAfter) =>
  Object.assign(new Error(message), { status, retryAfter });

function suggestionsFrom(data) {
  if (!data || !Array.isArray(data.features))
    throw failure(
      503,
      "Venue suggestions are temporarily unavailable. Try again or choose a point on the map.",
    );
  const seen = new Set(),
    suggestions = [];
  for (const feature of data.features.slice(0, 20)) {
    const p = feature?.properties || {};
    const point = feature?.geometry;
    if (point?.type !== "Point" || !Array.isArray(point.coordinates)) continue;
    const [longitude, latitude] = point.coordinates;
    if (!inside(latitude, longitude)) continue;
    if (
      plain(p.countrycode).toUpperCase() !== "CA" &&
      keyFor(plain(p.country)) !== "canada"
    )
      continue;
    if (!["ontario", "on"].includes(keyFor(plain(p.state)))) continue;
    if (
      [
        "country",
        "state",
        "county",
        "city",
        "district",
        "postcode",
        "street",
      ].includes(p.type)
    )
      continue;
    if (["construction", "demolished", "abandoned"].includes(p.osm_value))
      continue;
    const street = [plain(p.housenumber, 20), plain(p.street, 120)]
      .filter(Boolean)
      .join(" ");
    const name = plain(p.name, 120) || street;
    const city = plain(p.city || p.locality || p.district || p.county, 100);
    if (!name || !city || (!street && !plain(p.name))) continue;
    const address = [street, city, "ON", plain(p.postcode, 12)]
      .filter(Boolean)
      .join(", ");
    // Never invent a street number missing from the source.
    const combined =
      plain(p.name) && keyFor(name) !== keyFor(street)
        ? `${name}, ${address}`
        : address;
    const location = combined.length <= 200 ? combined : address;
    if (location.length > 200) continue;
    const duplicateKey = keyFor(`${name}|${address}`);
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    suggestions.push({
      id: `${plain(p.osm_type, 4)}:${String(p.osm_id || latitude + ":" + longitude).slice(0, 80)}`,
      name,
      address:
        street && keyFor(name) === keyFor(street)
          ? [city, "ON", plain(p.postcode, 12)].filter(Boolean).join(", ")
          : address,
      location,
      coordinate: { latitude, longitude },
    });
    if (suggestions.length === 5) break;
  }
  return suggestions;
}

function createPlaceSearch({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  wait = pause,
  gapMs = 1100,
  timeoutMs = 8000,
  maxPerMinute = 30,
  maxPerDay = 500,
  maxPerUserMinute = 12,
} = {}) {
  const cache = new Map(),
    pending = new Map(),
    users = new Map();
  let queue = Promise.resolve(),
    nextStart = 0,
    queued = 0,
    cooldownUntil = 0;
  let minute = -1,
    minuteCalls = 0,
    day = "",
    dayCalls = 0;

  function checkUser(uid) {
    const bucket = Math.floor(now() / 60000);
    for (const [id, counter] of users)
      if (counter.minute !== bucket) users.delete(id);
    const counter = users.get(uid) || { minute: bucket, calls: 0 };
    if (
      counter.calls >= maxPerUserMinute ||
      (!users.has(uid) && users.size >= 2000)
    )
      throw failure(
        429,
        "Please pause before searching again, or choose a point on the map.",
        60,
      );
    counter.calls++;
    users.set(uid, counter);
  }

  function reserve() {
    const current = now(),
      currentMinute = Math.floor(current / 60000);
    const currentDay = new Date(current).toISOString().slice(0, 10);
    if (minute !== currentMinute) {
      minute = currentMinute;
      minuteCalls = 0;
    }
    if (day !== currentDay) {
      day = currentDay;
      dayCalls = 0;
    }
    if (current < cooldownUntil)
      throw failure(
        503,
        "Venue suggestions are taking a break. Try again shortly or choose a point on the map.",
        30,
      );
    if (minuteCalls >= maxPerMinute || dayCalls >= maxPerDay)
      throw failure(
        429,
        "Venue suggestions have reached their request limit. Please try later or choose a point on the map.",
        60,
      );
    minuteCalls++;
    dayCalls++;
  }

  async function fetchSuggestions(input, center) {
    if (queued >= 3)
      throw failure(429, "Venue search is busy. Please try again shortly.", 3);
    queued++;
    const deadline = now() + 12000;
    const task = queue.then(async () => {
      const delay = Math.max(0, nextStart - now());
      if (now() + delay >= deadline)
        throw failure(503, "Venue search is busy. Please try again shortly.");
      if (delay) await wait(delay);
      reserve();
      nextStart = now() + gapMs;
      const url = new URL("https://photon.komoot.io/api/");
      url.search = new URLSearchParams({
        q: input,
        limit: "8",
        lang: "en",
        countrycode: "CA",
        bbox: `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`,
        lat: String(center.latitude),
        lon: String(center.longitude),
      }).toString();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.min(timeoutMs, deadline - now())),
      );
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "ReIdentify/1.0 (Ontario community venue search)",
          },
        });
        if (!response.ok) {
          cooldownUntil = now() + 30000;
          throw failure(
            503,
            "Venue suggestions are temporarily unavailable. Try again shortly or choose a point on the map.",
            30,
          );
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > 262144)
          throw new Error("Large provider response");
        return {
          suggestions: suggestionsFrom(JSON.parse(text)),
          attribution: ATTRIBUTION,
        };
      } catch (error) {
        cooldownUntil = Math.max(cooldownUntil, now() + 15000);
        if (error.status) throw error;
        throw failure(
          503,
          "Venue suggestions could not load. Try again or choose a point on the map.",
          15,
        );
      } finally {
        clearTimeout(timer);
      }
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await task;
    } finally {
      queued--;
    }
  }

  return async function search(uid, input, center) {
    if (typeof uid !== "string" || !uid) throw failure(401, "Please sign in.");
    if (
      typeof input !== "string" ||
      input.length > 200 ||
      /[\u0000-\u001f]/.test(input)
    )
      throw failure(400, "Enter a venue or address of up to 200 characters.");
    input = plain(input);
    if (input.length < 3) return { suggestions: [], attribution: ATTRIBUTION };
    if (!inside(center?.latitude, center?.longitude))
      throw failure(400, "Choose an Ontario search area.");
    checkUser(uid);
    const cacheKey = `${keyFor(input)}|${center.latitude.toFixed(2)}|${center.longitude.toFixed(2)}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now()) return cached.value;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const operation = fetchSuggestions(input, center).then((value) => {
      for (const [key, entry] of cache)
        if (entry.expires <= now()) cache.delete(key);
      while (cache.size >= 300) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { value, expires: now() + 10 * 60000 });
      return value;
    });
    pending.set(cacheKey, operation);
    try {
      return await operation;
    } finally {
      pending.delete(cacheKey);
    }
  };
}

function installPlaceRoutes(app, options) {
  const search = createPlaceSearch(options);
  // Install after server.js's existing Firebase authentication middleware.
  app.get("/api/places/suggestions", async (req, res) => {
    try {
      const result = await search(req.account?.uid, req.query.q, {
        latitude:
          typeof req.query.latitude === "string" && req.query.latitude.trim()
            ? Number(req.query.latitude)
            : NaN,
        longitude:
          typeof req.query.longitude === "string" && req.query.longitude.trim()
            ? Number(req.query.longitude)
            : NaN,
      });
      res.set("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
      res
        .status(error.status || 503)
        .json({
          message: error.status
            ? error.message
            : "Venue suggestions are temporarily unavailable.",
        });
    }
  });
}

module.exports = { installPlaceRoutes, createPlaceSearch, suggestionsFrom };