const { createHash } = require("node:crypto");
const { groupEventScope } = require("./map-geography");
const DAY = 86400000,
  STEP = 0.05;
const SOURCE_CACHE_MS = 20000;
const PLAN_VERSION = 3;
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
    const y0 = Math.floor((south + 90) / STEP),
      y1 = Math.floor((north + 90) / STEP);
    if (y1 - y0 + 1 > 8) {
      // Coalesce wide/tall views even when they omit an edge of Ontario.
      // Interior rows also read other longitudes; contains() below filters
      // those records to the exact viewport. All matches remain paginated.
      jobs.push({
        kind: "group",
        low: y0 + ":" + x0,
        high: y1 + ":" + x1,
      });
      continue;
    }
    for (let y = y0; y <= y1; y++)
      jobs.push({ kind: "group", low: y + ":" + x0, high: y + ":" + x1 });
  }
  return jobs;
}
function decodeCursor(raw, options, version, now, jobs) {
  if (!raw)
    return {
      at: now,
      job: 0,
      last: "",
      cell: "",
      key: options.key,
      version,
      pages: 0,
      documents: 0,
      queries: 0,
    };
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
  if (
    [cursor.pages, cursor.documents, cursor.queries].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw fail("Invalid map page. Refresh the map.");
  if (cursor.job >= jobs.length)
    throw fail("Invalid map page. Refresh the map.");
  const job = jobs[cursor.job];
  if (job.kind === "group" && cursor.cell) throw fail("Invalid map page.");
  return cursor;
}
function createViewportService(
  db,
  { now = Date.now, sources, index = { ready: true }, logger = console } = {},
) {
  sources ||= require("./external-events").SOURCES;
  let sourceMetadata = null;
  let readBlockedUntil = 0,
    readFailure = null;
  function snapshotsForView() {
    if (sourceMetadata && sourceMetadata.expires > now())
      return sourceMetadata.promise;
    const entry = { expires: Infinity, promise: null };
    sourceMetadata = entry;
    entry.promise = db
      .query("SELECT * FROM external_event_sources WHERE id = ANY($1::text[])", [
        sources.map((source) => source.id),
      ])
      .then(({ rows }) => {
        entry.expires = now() + SOURCE_CACHE_MS;
        return new Map(rows.map((row) => [row.id, row]));
      })
      .catch((error) => {
        if (sourceMetadata === entry) sourceMetadata = null;
        throw error;
      });
    return entry.promise;
  }
  async function loadPage(options, rawCursor, userId) {
    const scope = await groupEventScope(db, userId);
    index.ensure?.();
    const clock = now();
    const saved = await snapshotsForView();
    const statuses = [],
      jobs = [],
      versions = [];
    sources.forEach((source) => {
      const data = saved.get(source.id) || {},
        ready =
          Boolean(data.active_run_id) &&
          Number(data.map_schema_version) === 2;
      statuses.push({
        id: source.id,
        name: source.name,
        area: source.area,
        ready,
        refreshing:
          (data.lease_until && new Date(data.lease_until).getTime() > clock) ||
          (!ready && !data.last_error),
        lastSuccessAt: data.last_success_at
          ? new Date(data.last_success_at).toISOString()
          : null,
        stale:
          Boolean(data.last_error) ||
          !data.last_success_at ||
          clock - new Date(data.last_success_at).getTime() > DAY,
      });
      versions.push([
        source.id,
        data.active_run_id || "",
        data.map_schema_version || 0,
      ]);
      if (!ready) return;
      if (!Array.isArray(data.map_cells))
        throw fail(
          "A saved calendar needs its map index refreshed. Please retry shortly.",
          503,
        );
      const cells = [...new Set(data.map_cells)]
        .filter(
          (cell) =>
            typeof cell === "string" && cellIntersects(cell, options.bounds),
        )
        .sort();
      for (let offset = 0; offset < cells.length; offset += 20)
        jobs.push({
          kind: "external",
          source: source.id,
          run: data.active_run_id,
          cells: cells.slice(offset, offset + 20),
        });
    });
    jobs.push(...scope.ids.map((groupId) => ({ kind: "group", groupId })));
    const version = hash(JSON.stringify([PLAN_VERSION, versions, scope.key]));
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
        limit = Math.min(job.kind === "external" ? 32 : 30, 120 - docs);
      let found;
      if (job.kind === "external") {
        const result = await db.query(
          `SELECT chunk_id AS id, venue_id AS "venueId",
                  venue_name AS "venueName", location, latitude, longitude,
                  map_cell AS "mapCell", sessions
             FROM external_event_venues
            WHERE source_id = $1 AND run_id = $2
              AND map_cell = ANY($3::text[]) AND chunk_id > $4
            ORDER BY chunk_id
            LIMIT $5`,
          [job.source, job.run, job.cells, cursor.last, limit],
        );
        found = result.rows;
      } else {
        const result = await db.query(
          `SELECT id, title, location, latitude, longitude,
                  starts_at AS "startsAt", ends_at AS "endsAt",
                  status, group_id::text AS "groupId", interests,
                  time_zone AS "timeZone"
             FROM group_events
            WHERE group_id = $1::uuid AND status = 'published' AND id > $2
            ORDER BY id
            LIMIT $3`,
          [job.groupId, cursor.last, limit],
        );
        found = result.rows;
      }
      queries++;
      let stopped = false;
      for (const value of found) {
        const docId = value.id,
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
        } else if (value.status === "published" && scope.allows(value)) {
          add(
            {
              ...value,
              startsAt: iso(value.startsAt),
              endsAt: iso(value.endsAt),
            },
            value,
            "group",
          );
        }
        cursor.last = docId;
        cursor.cell = "";
      }
      if (stopped) break;
      if (found.length < limit) {
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
    cursor.pages++;
    cursor.documents += docs;
    cursor.queries += queries;
    const nextCursor =
      cursor.job < jobs.length
        ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
        : null;
    if (options.diagnostics && nextCursor === null)
      logger.log(
        "[maps-debug] " +
          JSON.stringify({
            mode: "viewport",
            pages: cursor.pages,
            documents: cursor.documents,
            queries: cursor.queries,
            sourceCount: sources.length,
            unavailableSources: statuses.filter((source) => !source.ready)
              .length,
            elapsedMs: Math.max(0, now() - start),
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
  async function page(options, rawCursor, userId) {
    if (readFailure && now() < readBlockedUntil) throw readFailure;
    try {
      return await loadPage(options, rawCursor, userId);
    } catch (error) {
      if (
        [8, "8", "resource-exhausted", "RESOURCE_EXHAUSTED"].includes(
          error.code,
        )
      ) {
        // Repeated zoom/refresh requests must not immediately hammer a service
        // that has already reported a resource/quota limit. Do not cache a
        // partial successful page or turn the failure into an empty result.
        readFailure = error;
        readBlockedUntil = now() + 60000;
      }
      throw error;
    }
  }
  return { page };
}
function installViewportRoute(app, db, dependencies = {}) {
  const service = createViewportService(db, dependencies);
  app.get("/api/map/viewport", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(
        await service.page(
          viewportOptions(req.query),
          req.query.cursor,
          req.userId,
        ),
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