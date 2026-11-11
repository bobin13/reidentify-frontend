const { externalEventService } = require("./external-events");
const { installMapRoutes } = require("./map-routes");
const { groupEventScope, readMemberEvents } = require("./map-geography");

function distanceKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function optionsFor(query, now) {
  function number(name, minimum, maximum, fallback) {
    const input = query[name];
    if (input == null && fallback !== undefined) return fallback;
    if (typeof input !== "string" || !input.trim())
      throw new Error("Check the event search location and distance.");
    const value = Number(input);
    if (!Number.isFinite(value) || value < minimum || value > maximum)
      throw new Error("Check the event search location and distance.");
    return value;
  }
  const center = {
    latitude: number("latitude", -90, 90, 43.6532),
    longitude: number("longitude", -180, 180, -79.3832),
  };
  const radiusKm = number("radiusKm", 0.5, 100, 10);
  const days = number("days", 1, 31, 31);
  return {
    center,
    radiusKm,
    start: now,
    end: now + days * 86400000,
    minLat: Math.max(-90, center.latitude - radiusKm / 110),
    maxLat: Math.min(90, center.latitude + radiusKm / 110),
  };
}

function serializeGroupEvent(d) {
  function time(v) {
    const ms = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (d.status !== "published") return null;
  return {
    id: d.id,
    title: typeof d.title === "string" ? d.title.trim() : "",
    venueName: typeof d.venueName === "string" ? d.venueName : d.location,
    location: typeof d.location === "string" ? d.location.trim() : "",
    coordinate: { latitude: d.latitude, longitude: d.longitude },
    startsAt: time(d.startsAt),
    endsAt: time(d.endsAt),
    description: typeof d.description === "string" ? d.description : "",
    interests: Array.isArray(d.interests)
      ? d.interests.filter((v) => typeof v === "string")
      : [],
    origin: "group",
    sourceName: "ReIdentify group",
    groupId: d.groupId || null,
    timeZone: typeof d.timeZone === "string" ? d.timeZone : "America/Toronto",
    seriesId: d.id,
    sourceUrl: "",
    availability: "",
    cost: "",
    room: "",
  };
}

function inArea(event, options) {
  const p = event.coordinate,
    start = Date.parse(event.startsAt),
    end = Date.parse(event.endsAt);
  return (
    event.title &&
    event.location &&
    Number.isFinite(p?.latitude) &&
    Math.abs(p.latitude) <= 90 &&
    Number.isFinite(p?.longitude) &&
    Math.abs(p.longitude) <= 180 &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    end > options.start &&
    start < options.end &&
    distanceKm(options.center, p) <= options.radiusKm
  );
}

function installEventRoutes(
  app,
  db,
  { now = Date.now, service = externalEventService(db) } = {},
) {
  if (typeof service.readMapSummaries === "function")
    installMapRoutes(app, db, { now, external: service });
  // Only public calendar records share the area cache. Membership and group
  // events are checked afresh for the authenticated account below.
  const cache = new Map();
  async function load(options) {
    const cacheKey = [
      options.center.latitude,
      options.center.longitude,
      options.radiusKm,
    ].join("|");
    const previous = cache.get(cacheKey);
    if (previous && previous.expires > now()) return previous.promise;
    const promise = (async () => {
      const external = await service.read(options);
      return {
        sources: external.sources,
        events: external.events,
      };
    })().catch((error) => {
      cache.delete(cacheKey);
      throw error;
    });
    cache.set(cacheKey, { expires: now() + 60000, promise });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return promise;
  }

  app.get("/api/events", async (req, res, next) => {
    let options;
    try {
      options = optionsFor(req.query, now());
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      const scope = await groupEventScope(db, req.userId);
      const [result, groupEvents] = await Promise.all([
        load(options),
        readMemberEvents(db, scope),
      ]);
      const seen = new Set();
      const events = [
        ...result.events,
        ...groupEvents.map(serializeGroupEvent).filter(Boolean),
      ]
        .filter((event) => {
          if (event.origin === "group" && !scope.allows(event)) return false;
          if (!inArea(event, options) || seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        })
        .sort(
          (a, b) =>
            a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
        );
      // No global 200-event cap: a busy Toronto source cannot hide Tiny/Ottawa.
      res.set("Cache-Control", "no-store");
      res.json({
        events,
        sources: result.sources,
        windowDays: Number(req.query.days || 31),
      });
    } catch (error) {
      if (error.status)
        return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });
}

module.exports = { installEventRoutes, optionsFor, inArea, distanceKm };