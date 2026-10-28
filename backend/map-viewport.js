const { createHash } = require("node:crypto");
const { groupMapIndex } = require("./map-geography");
const DAY = 86400000,
  STEP = 0.05;
const GROUP_FIELDS = [
  "title",
  "location",
  "venueName",
  "latitude",
  "longitude",
  "startsAt",
  "endsAt",
  "status",
  "interests",
  "timeZone",
  "mapCell",
];
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const iso = (value) => {
  const ms =
    typeof value?.toMillis === "function"
      ? value.toMillis()
      : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};
function viewportOptions(query) {
  const number = (name, min, max, fallback) => {
    const text = query[name] ?? fallback;
    const value = typeof text === "string" && text.trim() ? Number(text) : NaN;
    if (!Number.isFinite(value) || value < min || value > max)
      throw fail("Check the visible map area.");
    return value;
  };
  const bounds = {
    north: number("north", -90, 90),
    south: number("south", -90, 90),
    east: number("east", -180, 180),
    west: number("west", -180, 180),
  };
  if (bounds.north <= bounds.south || bounds.east === bounds.west)
    throw fail("Check the visible map area.");
  const days = number("days", 1, 31, "31");
  if (!Number.isInteger(days)) throw fail("Check the date range.");
  let interests;
  try {
    interests = JSON.parse(query.interests ?? "[]");
  } catch {
    throw fail("Check the activity filters.");
  }
  if (
    !Array.isArray(interests) ||
    interests.length > 150 ||
    interests.some((v) => typeof v !== "string" || !v.trim() || v.length > 80)
  )
    throw fail("Check the activity filters.");
  interests = [...new Set(interests)].sort();
  return {
    bounds,
    days,
    interests,
    diagnostics: query.diagnostics === "1",
    key: hash(JSON.stringify([bounds, days, interests])),
  };
}
const longitudeRanges = (bounds) =>
  bounds.west < bounds.east
    ? [[bounds.west, bounds.east]]
    : [
        [bounds.west, 180],
        [-180, bounds.east],
      ];
function contains(bounds, latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= bounds.south &&
    latitude <= bounds.north &&
    longitudeRanges(bounds).some(
      ([low, high]) => longitude >= low && longitude <= high,
    )
  );
}
function cellIntersects(cell, bounds) {
  if (!/^\d{1,4}:\d{1,4}$/.test(cell)) return false;
  const [y, x] = cell.split(":").map(Number),
    south = y * STEP - 90,
    west = x * STEP - 180;
  return (
    south <= bounds.north &&
    south + STEP >= bounds.south &&
    longitudeRanges(bounds).some(
      ([low, high]) => west <= high && west + STEP >= low,
    )
  );
}
function groupRows(bounds) {
  // ReIdentify's group-event coverage is Ontario. Restrict empty index-row reads
  // to its geographic envelope when the user zooms out to Canada/the world.
  const south = Math.max(41.5, bounds.south),
    north = Math.min(57, bounds.north);
  if (south > north) return [];
  const jobs = [];
  for (const [left, right] of longitudeRanges(bounds)) {
    const west = Math.max(-95.5, left),
      east = Math.min(-74, right);
    if (west > east) continue;
    const x0 = Math.floor((west + 180) / STEP),
      x1 = Math.floor((east + 180) / STEP);
    if (west === -95.5 && east === -74) {
      // A province-wide view can use one continuous index range instead of
      // hundreds of empty per-row queries. Exact bounds are still checked.
      jobs.push({
        kind: "group",
        low: Math.floor((south + 90) / STEP) + ":" + x0,
        high: Math.floor((north + 90) / STEP) + ":" + x1,
      });
      continue;
    }
    for (
      let y = Math.floor((south + 90) / STEP);
      y <= Math.floor((north + 90) / STEP);
      y++
    )
      jobs.push({ kind: "group", low: y + ":" + x0, high: y + ":" + x1 });
  }
  return jobs;
}
function decodeCursor(raw, options, version, now, jobs) {
  if (!raw)
    return { at: now, job: 0, last: "", cell: "", key: options.key, version };
  let cursor;
  try {
    if (
      typeof raw !== "string" ||
      raw.length > 1000 ||
      !/^[A-Za-z0-9_-]+$/.test(raw)
    )
      throw Error();
    cursor = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      !cursor ||
      !Number.isInteger(cursor.job) ||
      cursor.job < 0 ||
      typeof cursor.last !== "string" ||
      !/^[A-Za-z0-9_.-]{0,250}$/.test(cursor.last) ||
      typeof cursor.cell !== "string" ||
      cursor.cell.length > 30 ||
      !Number.isFinite(cursor.at) ||
      cursor.at > now + 5000
    )
      throw Error();
  } catch {
    throw fail("Invalid map page. Refresh the map.");
  }
  if (
    cursor.key !== options.key ||
    cursor.version !== version ||
    now - cursor.at > 10 * 60 * 1000
  )
    throw fail("The map results changed. Reload this view.", 409);
  if (cursor.job >= jobs.length)
    throw fail("Invalid map page. Refresh the map.");
  const job = jobs[cursor.job];
  if (
    job.kind === "group" &&
    cursor.last &&
    (cursor.cell < job.low || cursor.cell > job.high)
  )
    throw fail("Invalid map page.");
  return cursor;
}
function createViewportService(
  db,
  { now = Date.now, sources, index = groupMapIndex(db), logger = console } = {},
) {
  sources ||= require("./external-events").SOURCES;
  async function page(options, rawCursor) {
    index.ensure?.();
    const clock = now();
    const snapshots = await Promise.all(
      sources.map((source) =>
        db.collection("externalEventSources").doc(source.id).get(),
      ),
    );
    const statuses = [],
      jobs = [],
      versions = [];
    sources.forEach((source, i) => {
      const data = snapshots[i].data() || {},
        ready = Boolean(data.activeRunId) && data.mapSchemaVersion === 2;
      statuses.push({
        id: source.id,
        name: source.name,
        area: source.area,
        ready,
        refreshing: data.leaseUntil > clock || (!ready && !data.lastError),
        lastSuccessAt: data.lastSuccessAt
          ? new Date(data.lastSuccessAt).toISOString()
          : null,
        stale:
          Boolean(data.lastError) ||
          !data.lastSuccessAt ||
          clock - data.lastSuccessAt > DAY,
      });
      versions.push([
        source.id,
        data.activeRunId || "",
        data.mapSchemaVersion || 0,
      ]);
      if (!ready) return;
      if (!Array.isArray(data.mapCells))
        throw fail(
          "A saved calendar needs its map index refreshed. Please retry shortly.",
          503,
        );
      const cells = [...new Set(data.mapCells)]
        .filter(
          (cell) =>
            typeof cell === "string" && cellIntersects(cell, options.bounds),
        )
        .sort();
      for (let offset = 0; offset < cells.length; offset += 20)
        jobs.push({
          kind: "external",
          source: source.id,
          run: data.activeRunId,
          cells: cells.slice(offset, offset + 20),
        });
    });
    jobs.push(...groupRows(options.bounds));
    const version = hash(JSON.stringify(versions));
    const cursor = decodeCursor(rawCursor, options, version, clock, jobs);
    const start = cursor.at,
      end = start + options.days * DAY;
    const entries = new Map();
    let docs = 0,
      queries = 0,
      bytes = 0;
    const add = (event, place, sourceKey) => {
      const begins = Date.parse(event.startsAt),
        ends = Date.parse(event.endsAt);
      if (
        !event.id ||
        !event.title ||
        !place.location ||
        !contains(options.bounds, place.latitude, place.longitude) ||
        !(ends > Math.max(start, begins)) ||
        !(begins < end) ||
        (options.interests.length &&
          !event.interests?.some((v) => options.interests.includes(v)))
      )
        return;
      const id =
        "place-" +
        hash(place.latitude.toFixed(5) + "," + place.longitude.toFixed(5));
      let item = entries.get(id);
      if (!item) {
        item = {
          id,
          title: place.venueName || place.location,
          location: place.location,
          coordinate: { latitude: place.latitude, longitude: place.longitude },
          sessionCount: 0,
          activityKeys: new Set(),
          nextSession: null,
        };
        entries.set(id, item);
      }
      item.sessionCount++;
      item.activityKeys.add(sourceKey + ":" + (event.seriesId || event.id));
      const next = {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timeZone: event.timeZone || "America/Toronto",
      };
      if (!item.nextSession || next.startsAt < item.nextSession.startsAt)
        item.nextSession = next;
    };
    while (
      cursor.job < jobs.length &&
      docs < 120 &&
      queries < 8 &&
      bytes < 2 * 1024 * 1024
    ) {
      const job = jobs[cursor.job],
        limit = Math.min(job.kind === "external" ? 8 : 30, 120 - docs);
      let query;
      if (job.kind === "external") {
        const collection = db
          .collection("externalEventSources")
          .doc(job.source)
          .collection("runs")
          .doc(job.run)
          .collection("mapSummaries");
        query = collection.where("mapCell", "in", job.cells).limit(limit);
        if (cursor.last) {
          const previous = await collection.doc(cursor.last).get();
          if (!previous.exists)
            throw fail("The map results changed. Reload this view.", 409);
          query = query.startAfter(previous);
        }
      } else {
        query = db
          .collection("events")
          .where("mapCell", ">=", job.low)
          .where("mapCell", "<=", job.high)
          .orderBy("mapCell")
          .orderBy("__name__")
          .select(...GROUP_FIELDS)
          .limit(limit);
        if (cursor.last) query = query.startAfter(cursor.cell, cursor.last);
      }
      const found = await query.get();
      queries++;
      let stopped = false;
      for (const doc of found.docs) {
        const value = doc.data(),
          size = Buffer.byteLength(JSON.stringify(value), "utf8");
        if (size > 2 * 1024 * 1024)
          throw fail("A calendar map record exceeds its supported size.", 503);
        if (bytes + size > 2 * 1024 * 1024 && docs) {
          stopped = true;
          break;
        }
        bytes += size;
        docs++;
        if (job.kind === "external") {
          for (const event of value.sessions || [])
            add(event, value, job.source);
        } else if (value.status === "published") {
          add(
            {
              ...value,
              id: doc.id,
              startsAt: iso(value.startsAt),
              endsAt: iso(value.endsAt),
            },
            value,
            "group",
          );
        }
        cursor.last = doc.id;
        cursor.cell = job.kind === "group" ? value.mapCell : "";
      }
      if (stopped) break;
      if (found.docs.length < limit) {
        cursor.job++;
        cursor.last = "";
        cursor.cell = "";
      }
    }
    const venues = [...entries.values()].map((item) => ({
      ...item,
      activityKeys: [...item.activityKeys],
      activityCount: item.activityKeys.size,
      distance: 0,
    }));
    const nextCursor =
      cursor.job < jobs.length
        ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
        : null;
    if (options.diagnostics)
      logger.log(
        "[maps-debug] " +
          JSON.stringify({
            mode: "viewport",
            bounds: options.bounds,
            pageDocuments: docs,
            pageQueries: queries,
            returnedPlaces: venues.length,
            morePages: nextCursor !== null,
            imported: sources.map((source, i) => ({
              id: source.id,
              venues: snapshots[i].data()?.stats?.venues || 0,
              sessions: snapshots[i].data()?.stats?.sessions || 0,
            })),
          }),
      );
    return {
      venues,
      sources: statuses,
      nextCursor,
      windowDays: options.days,
      indexing: !index.ready,
    };
  }
  return { page };
}
function installViewportRoute(app, db, dependencies = {}) {
  const service = createViewportService(db, dependencies);
  app.get("/api/map/viewport", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(
        await service.page(viewportOptions(req.query), req.query.cursor),
      );
    } catch (error) {
      error.status
        ? res.status(error.status).json({ message: error.message })
        : next(error);
    }
  });
}
module.exports = {
  viewportOptions,
  contains,
  cellIntersects,
  groupRows,
  createViewportService,
  installViewportRoute,
};