const { installViewportRoute } = require("./map-viewport");
const { createHash } = require("node:crypto");
const {
  groupEventScope,
  readMemberEvents,
  cellsFor,
  busyArea,
  groupMapIndex,
} = require("./map-geography");
const DAY = 86400000,
  PAGE = 60,
  MAX_VENUES = 2000;
const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 24);
const iso = (value) => {
  const ms =
    typeof value?.toMillis === "function"
      ? value.toMillis()
      : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};
function distanceKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function mapOptions(query, now) {
  const number = (key, min, max, fallback) => {
    const input = query[key] ?? String(fallback);
    const n = typeof input === "string" && input.trim() ? Number(input) : NaN;
    if (!Number.isFinite(n) || n < min || n > max)
      throw Object.assign(
        new Error("Check the map location and choose a distance up to 10 km."),
        { status: 400 },
      );
    return n;
  };
  let interests = [];
  if (query.interests !== undefined) {
    try {
      interests = JSON.parse(query.interests);
    } catch {
      interests = null;
    }
    if (
      !Array.isArray(interests) ||
      interests.length > 150 ||
      interests.some((v) => typeof v !== "string" || !v.trim() || v.length > 80)
    )
      throw Object.assign(new Error("Check your activity filters."), {
        status: 400,
      });
  }
  interests = [...new Set(interests)].sort();
  const days = number("days", 1, 31, 31);
  const options = {
    center: {
      latitude: number("latitude", -90, 90, 43.6532),
      longitude: number("longitude", -180, 180, -79.3832),
    },
    radiusKm: number("radiusKm", 0.5, 10, 10),
    days,
    start: now,
    end: now + days * DAY,
    interests,
    fresh: query.fresh === "1",
    diagnostics: query.diagnostics === "1",
  };
  options.cells = cellsFor(options.center, options.radiusKm);
  options.key = JSON.stringify([
    options.center,
    options.radiusKm,
    days,
    interests,
  ]);
  return options;
}
function eligible(event, place, options) {
  return rejectionReason(event, place, options) === null;
}
function rejectionReason(event, place, options) {
  const start = Date.parse(event.startsAt),
    end = Date.parse(event.endsAt);
  if (
    !event.title ||
    !place.location ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(place.latitude) ||
    !Number.isFinite(place.longitude) ||
    Math.abs(place.latitude) > 90 ||
    Math.abs(place.longitude) > 180
  )
    return "invalid";
  if (end <= options.start || start >= options.end) return "dates";
  if (distanceKm(options.center, place) > options.radiusKm) return "distance";
  if (
    options.interests.length &&
    !event.interests?.some((v) => options.interests.includes(v))
  )
    return "interests";
  return null;
}
function groupEvent(d) {
  if (d.status !== "published") return null;
  return {
    id: d.id,
    seriesId: d.id,
    title: d.title,
    location: d.location,
    venueName: d.venueName || d.location,
    coordinate: { latitude: d.latitude, longitude: d.longitude },
    startsAt: iso(d.startsAt),
    endsAt: iso(d.endsAt),
    description: d.description || "",
    interests: d.interests || [],
    origin: "group",
    groupId: d.groupId || null,
    sourceName: "ReIdentify group",
    timeZone: d.timeZone || "America/Toronto",
    sourceUrl: "",
  };
}

function createMapService(
  db,
  { external, now = Date.now, index, logger = console } = {},
) {
  index ||= groupMapIndex(db);
  const cache = new Map();
  async function load(options, uid) {
    const scope = await groupEventScope(db, uid);
    index.ensure?.();
    const cacheKey = options.cells.join("|");
    const old = cache.get(cacheKey);
    let raw;
    if (!options.fresh && old && old.expires > now()) raw = await old.promise;
    else {
      const promise = (async () => {
        const budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 };
        const out = await external.readMapSummaries(
          options,
          options.cells,
          budget,
        );
        const item = cache.get(cacheKey);
        if (item) item.bytes = 6 * 1024 * 1024 - budget.remainingBytes;
        let totalBytes = [...cache.values()].reduce(
          (sum, value) => sum + (value.bytes || 0),
          0,
        );
        while (totalBytes > 16 * 1024 * 1024 && cache.size) {
          const first = cache.keys().next().value;
          totalBytes -= cache.get(first).bytes || 0;
          cache.delete(first);
        }
        return {
          out,
          remainingDocs: budget.remainingDocs,
          remainingBytes: budget.remainingBytes,
        };
      })().catch((error) => {
        cache.delete(cacheKey);
        throw error;
      });
      cache.set(cacheKey, { expires: now() + 45000, promise });
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      raw = await promise;
    }
    const { out } = raw;
    // Only public source records share the area cache. Group events are read
    // afresh for this account so new events and membership changes take effect.
    const groupEvents = await readMemberEvents(
      db,
      scope,
      [
        "title",
        "location",
        "venueName",
        "latitude",
        "longitude",
        "startsAt",
        "endsAt",
        "status",
        "groupId",
        "interests",
        "timeZone",
      ],
      { remainingDocs: raw.remainingDocs, remainingBytes: raw.remainingBytes },
    );
    const entries = new Map();
    const counters = new Map();
    function counter(sourceId) {
      if (!counters.has(sourceId))
        counters.set(sourceId, {
          sourceId,
          candidateSessions: 0,
          matchedSessions: 0,
          invalid: 0,
          dates: 0,
          distance: 0,
          interests: 0,
          places: new Set(),
        });
      return counters.get(sourceId);
    }
    function add(event, place, reference, origin) {
      const count = counter(reference?.sourceId || "group");
      count.candidateSessions++;
      const reason = rejectionReason(event, place, options);
      if (reason) {
        count[reason]++;
        return;
      }
      const position =
        place.latitude.toFixed(5) + "," + place.longitude.toFixed(5);
      const id = "place-" + hash(position);
      let entry = entries.get(id);
      if (!entry) {
        entry = {
          id,
          title: place.venueName || place.location,
          location: place.location,
          coordinate: { latitude: place.latitude, longitude: place.longitude },
          distance: distanceKm(options.center, {
            latitude: place.latitude,
            longitude: place.longitude,
          }),
          activityIds: new Set(),
          sessionIds: new Set(),
          refs: new Map(),
          groupIds: new Set(),
          nextSession: null,
        };
        entries.set(id, entry);
      }
      const identity =
        origin + ":" + (reference?.sourceId || "group") + ":" + event.id;
      if (entry.sessionIds.has(identity)) return;
      count.matchedSessions++;
      count.places.add(id);
      entry.sessionIds.add(identity);
      entry.activityIds.add(origin + ":" + (event.seriesId || event.id));
      const next = {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timeZone: event.timeZone || "America/Toronto",
      };
      if (!entry.nextSession || next.startsAt < entry.nextSession.startsAt)
        entry.nextSession = next;
      if (origin === "external")
        entry.refs.set(JSON.stringify(reference), {
          ...reference,
          stale: place.stale,
        });
      else entry.groupIds.add(event.id);
    }
    for (const record of out.records)
      for (const event of record.sessions || [])
        add(event, record, record.ref, "external");
    for (const eventRow of groupEvents) {
      const event = groupEvent(eventRow);
      if (event && scope.allows(event))
        add(
          event,
          { ...eventRow, venueName: event.venueName },
          null,
          "group",
        );
    }
    // Reject overly broad requests explicitly; never truncate venue results.
    if (entries.size > MAX_VENUES) throw busyArea();
    const venues = [...entries.values()].sort(
      (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
    );
    const diagnostics = {
      center: options.center,
      radiusKm: options.radiusKm,
      interests: options.interests,
      cells: options.cells.length,
      returnedPlaces: venues.length,
      sources: (out.sources || []).map((source) => {
        const count = counter(source.id);
        return {
          sourceId: source.id,
          ready: source.ready,
          stale: source.stale,
          lastSuccessAt: source.lastSuccessAt,
          importRevision: source.importRevision,
          imported: source.stats || null,
          mapState: source.mapState,
          mapDocuments: source.mapDocuments,
          candidateSessions: count.candidateSessions,
          matchedSessions: count.matchedSessions,
          matchedPlaces: count.places.size,
          rejected: {
            invalid: count.invalid,
            dates: count.dates,
            distance: count.distance,
            interests: count.interests,
          },
        };
      }),
    };
    return {
      entries,
      venues,
      sources: out.sources,
      indexing: !index.ready,
      diagnostics,
      scope,
    };
  }

  async function summaries(options, uid) {
    const data = await load(options, uid);
    if (options.diagnostics)
      logger.log("[maps-debug] " + JSON.stringify(data.diagnostics));
    return {
      venues: data.venues.map((v) => ({
        id: v.id,
        title: v.title,
        location: v.location,
        coordinate: v.coordinate,
        distance: v.distance,
        activityCount: v.activityIds.size,
        sessionCount: v.sessionIds.size,
        nextSession: v.nextSession,
      })),
      sources: data.sources,
      indexing: data.indexing,
      windowDays: options.days,
      ...(options.diagnostics ? { diagnostics: data.diagnostics } : {}),
    };
  }
  async function schedule(options, id, cursor, uid) {
    const data = await load(options, uid),
      entry = data.entries.get(id);
    if (!entry)
      throw Object.assign(
        new Error(
          "This place is no longer in the current results. Refresh the map.",
        ),
        { status: 404 },
      );
    let scheduleBytes = 0;
    const events = [],
      references = [...entry.refs.values()];
    // Schedule documents are read only for the selected venue, not every pin.
    for (let i = 0; i < references.length; i += 8) {
      const pages = await Promise.all(
        references.slice(i, i + 8).map(async (ref) =>
          (await external.loadMapSessions(ref)).map((e) => ({
            ...e,
            stale: ref.stale,
          })),
        ),
      );
      scheduleBytes += Buffer.byteLength(JSON.stringify(pages), "utf8");
      if (scheduleBytes > 8 * 1024 * 1024) throw busyArea();
      events.push(...pages.flat());
    }
    const groupIds = [...entry.groupIds];
    for (let i = 0; i < groupIds.length; i += 20) {
      const { rows } = await db.query(
        `SELECT id, title, location, description, latitude, longitude,
                starts_at AS "startsAt", ends_at AS "endsAt", status,
                interests, group_id::text AS "groupId",
                time_zone AS "timeZone"
           FROM group_events
          WHERE id = ANY($1::text[]) AND status = 'published'`,
        [groupIds.slice(i, i + 20)],
      );
      for (const row of rows) {
        const event = groupEvent(row);
        if (event && data.scope.allows(event)) events.push(event);
      }
    }
    const seen = new Set();
    const filtered = events
      .filter((e) => {
        const place = {
          latitude: e.coordinate?.latitude,
          longitude: e.coordinate?.longitude,
          location: e.location,
        };
        if (
          (e.origin === "group" && !data.scope.allows(e)) ||
          !eligible(e, place, options) ||
          seen.has(e.id)
        )
          return false;
        seen.add(e.id);
        return true;
      })
      .sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
      );
    const version = hash(JSON.stringify([data.scope.key, filtered]));
    let offset = 0;
    if (cursor) {
      let value;
      try {
        if (typeof cursor !== "string" || cursor.length > 200)
          throw new Error();
        value = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        throw Object.assign(new Error("Invalid schedule page. Try again."), {
          status: 400,
        });
      }
      if (value.v !== version)
        throw Object.assign(
          new Error("The schedule changed. Tap Try again to reload its dates."),
          { status: 409 },
        );
      if (
        !Number.isInteger(value.o) ||
        value.o < 0 ||
        value.o > filtered.length
      )
        throw Object.assign(new Error("Invalid schedule page."), {
          status: 400,
        });
      offset = value.o;
    }
    const page = filtered.slice(offset, offset + PAGE);
    const next = offset + page.length;
    return {
      events: page,
      total: filtered.length,
      nextCursor:
        next < filtered.length
          ? Buffer.from(JSON.stringify({ v: version, o: next })).toString(
              "base64url",
            )
          : null,
    };
  }
  return { summaries, schedule };
}
function installMapRoutes(app, db, dependencies) {
  const index = dependencies.index || groupMapIndex(db, dependencies);
  dependencies.index = index;
  installViewportRoute(app, db, {
    now: dependencies.now,
    logger: dependencies.logger,
    sources: dependencies.sources,
    index,
  });
  const service = createMapService(db, dependencies);
  const handle = (fn) => async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(
        await fn(req, mapOptions(req.query, (dependencies.now || Date.now)())),
      );
    } catch (error) {
      error.status
        ? res.status(error.status).json({ message: error.message })
        : next(error);
    }
  };
  app.get(
    "/api/map/venues",
    handle((req, options) => service.summaries(options, req.userId)),
  );
  app.get(
    "/api/map/venues/:id/events",
    handle((req, options) =>
      service.schedule(
        options,
        req.params.id,
        req.query.cursor,
        req.userId,
      ),
    ),
  );
}
module.exports = {
  createMapService,
  installMapRoutes,
  mapOptions,
  eligible,
  distanceKm,
};