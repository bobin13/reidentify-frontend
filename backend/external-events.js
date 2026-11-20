const { transaction } = require("./postgres");
const { createHash, randomUUID } = require("node:crypto");
const { decodeHTML } = require("entities");
const { mapCellFor } = require("./map-geography");
const {
  EXTRA_SOURCES,
  collectAdditionalSource,
} = require("./calendar-importers");

const DAY = 86400000;
const IMPORT_REVISION = 4;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/";
const services = new WeakMap();
// New adapters version themselves; adding one must not force every old source
// to download again or invalidate its saved successful snapshot.
const revisionFor = (source) => source.importRevision ?? IMPORT_REVISION;
async function limitedSettled(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operation(items[index]),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
const SOURCES = [
  { id: "tpl", name: "Toronto Public Library", area: "Toronto", type: "tpl" },
  { id: "bayshore", name: "Bay Shore Seniors", area: "Tiny", type: "bayshore" },
  ...EXTRA_SOURCES,
];

function key(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

function plain(value, maximum = 1800) {
  return decodeHTML(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(?:p|div|li)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim()
    .slice(0, maximum);
}

function normalized(value) {
  return plain(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

const formatters = new Map();
function localParts(ms, zone) {
  if (!formatters.has(zone))
    formatters.set(
      zone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  const p = Object.fromEntries(
    formatters
      .get(zone)
      .formatToParts(new Date(ms))
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, item.value]),
  );
  return (
    p.year +
    "-" +
    p.month +
    "-" +
    p.day +
    "T" +
    p.hour +
    ":" +
    p.minute +
    ":" +
    p.second
  );
}

// Source timestamps without an offset are venue-local, never server-local.
// Ambiguous/nonexistent daylight-saving times are held back for verification.
function localToISO(value, zone = "America/Toronto") {
  const text = String(value || "")
    .trim()
    .replace(" ", "T");
  if (/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const wall = match[1] + ":" + (match[2] || "00");
  const approximate = Date.parse(wall + "Z");
  if (
    !Number.isFinite(approximate) ||
    new Date(approximate).toISOString().slice(0, 19) !== wall
  )
    return null;
  try {
    const offsets = new Set(
      [-36, 0, 36].map((hours) => {
        const sample = approximate + hours * 3600000;
        return Date.parse(localParts(sample, zone) + "Z") - sample;
      }),
    );
    const candidates = [...offsets]
      .map((offset) => approximate - offset)
      .filter((ms) => localParts(ms, zone) === wall);
    return candidates.length === 1
      ? new Date(candidates[0]).toISOString()
      : null;
  } catch {
    return null;
  }
}

function windowFor(now) {
  const date = localParts(now, "America/Toronto").slice(0, 10);
  const endDate = new Date(Date.parse(date + "T12:00:00Z") + 31 * DAY)
    .toISOString()
    .slice(0, 10);
  return {
    start: now,
    end: Date.parse(localToISO(endDate + "T00:00:00")),
    startDate: date,
    endDate,
  };
}

async function fetchJSON(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ReIdentify-CommunityEvents/1.0",
      },
    });
    if (!response.ok)
      throw new Error("Source returned HTTP " + response.status);
    if (!(response.headers.get("content-type") || "").includes("json")) {
      throw new Error("Source returned a page instead of an event feed");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2500000) {
        await reader.cancel();
        throw new Error("Source page is too large");
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

async function ckanRecords(resource, fetchImpl, requiredFields) {
  const records = [];
  let total = null;
  for (let offset = 0; offset < 30000; offset = records.length) {
    const url = new URL(CKAN + "datastore_search");
    url.search = new URLSearchParams({
      resource_id: resource,
      limit: "1000",
      offset: String(offset),
      sort: "_id asc",
    }).toString();
    const data = await fetchJSON(url.toString(), fetchImpl);
    const result = data.result;
    if (
      data.success !== true ||
      !Array.isArray(result?.records) ||
      !Number.isInteger(result.total) ||
      result.total < 0 ||
      result.total > 30000 ||
      result.total_was_estimated === true ||
      !requiredFields.every((field) =>
        result.fields?.some((item) => item.id === field),
      )
    ) {
      throw new Error(
        "Library feed format changed; retained the last successful import",
      );
    }
    if (total !== null && total !== result.total)
      throw new Error("Library feed changed during pagination");
    total = result.total;
    records.push(...result.records);
    if (records.length === total) return records;
    if (!result.records.length || records.length > total)
      throw new Error("Incomplete library feed");
  }
  throw new Error("Library feed exceeded the import limit");
}

// Conservative labels from the existing activity catalogue; this is keyword
// matching, not a machine-learning model. Unlabelled events remain visible.
const INTEREST_RULES = [
  ["Walking", /\bwalk(?:ing|ers)?\b/i],
  ["Hiking", /\bhik(?:ing|e)\b/i],
  ["Cycling", /\bcycl(?:ing|e)|\bbik(?:ing|e)\b/i],
  ["Yoga", /\byoga\b/i],
  ["Tai Chi", /\btai\s*chi\b/i],
  ["Fitness/exercise", /\bfitness|exercise\b/i],
  ["Stretching", /\bstretch/i],
  ["Pickleball", /\bpickleball\b/i],
  ["Gardening", /\bgarden/i],
  ["Birdwatching", /\bbird(?:ing|watch)/i],
  ["Nature outings", /\bnature\b/i],
  ["Cards", /\beuchre|bridge|canasta|cribbage|card games?\b/i],
  ["Chess", /\bchess\b/i],
  ["Mahjong", /\bmah[ -]?jong/i],
  ["Bingo", /\bbingo\b/i],
  ["Board games", /\bboard games?\b/i],
  ["Puzzles", /\bpuzzle/i],
  ["Trivia", /\btrivia\b/i],
  ["Billiards/pool", /\bbilliards|pool\/billiards\b/i],
  ["Darts", /\bdarts\b/i],
  ["Painting/drawing", /\bpaint|drawing|access art\b/i],
  ["Knitting/crochet", /\bknit|crochet\b/i],
  ["Sewing/quilting", /\bsew|quilt\b/i],
  ["Woodworking", /\bwoodwork|wood carv/i],
  ["Pottery/ceramics", /\bpottery|ceramic/i],
  ["Photography", /\bphotograph/i],
  ["General crafts", /\bcrafts?\b/i],
  ["Choir", /\bchoir\b/i],
  ["Singing", /\bsing(?:ing|along)\b/i],
  ["Concerts", /\bconcert\b/i],
  ["Movies", /\bmovie|film screening\b/i],
  ["Theatre", /\btheat(?:re|er)\b/i],
  ["Dancing/social dance", /\bdanc(?:e|ing)\b/i],
  ["Coffee/tea", /\bcoffee|tea social\b/i],
  ["Cooking", /\bcook/i],
  ["Baking", /\bbak/i],
  ["Book clubs", /\bbook club|book discussion\b/i],
  ["Reading", /\breading\b/i],
  ["Writing", /\bwrit(?:ing|ers)\b/i],
  ["History", /\bhistory\b/i],
  [
    "Languages",
    /\blanguage learning|english conversation|french conversation\b/i,
  ],
  [
    "Computers/technology",
    /\bcomputer|technology|digital|coding|artificial intelligence\b/i,
  ],
  ["Genealogy", /\bgenealog/i],
  ["Lectures/classes", /\blecture|workshop|class(?:es)?\b/i],
  ["Volunteering", /\bvolunteer/i],
  ["Meditation", /\bmeditat/i],
  [
    "Conversation/social meetups",
    /\bconversation circle|social meetup|social club\b/i,
  ],
];
function interestsFor(title, categories = "") {
  const text = title + " " + categories;
  return INTEREST_RULES.filter(([, regex]) => regex.test(text)).map(
    ([label]) => label,
  );
}

function session(source, rawId, title, startsAt, endsAt, extra = {}) {
  return {
    id: source.id + "-" + key(rawId),
    sourceId: source.id,
    sourceName: source.name,
    origin: "external",
    title: plain(title, 180),
    startsAt,
    endsAt,
    timeZone: "America/Toronto",
    ...extra,
  };
}

function addSession(venues, venue, item, window, stats) {
  const start = Date.parse(item.startsAt),
    end = Date.parse(item.endsAt);
  if (
    !item.title ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    stats.unverified++;
    return;
  }
  if (end <= window.start || start >= window.end) {
    stats.outsideWindow++;
    return;
  }
  if (!validCoordinate(venue.latitude, venue.longitude) || !venue.location) {
    stats.unverified++;
    return;
  }
  const previous = venues.get(venue.id) || { ...venue, sessions: [] };
  previous.sessions.push(item);
  venues.set(venue.id, previous);
}

async function collectTPL(source, window, fetchImpl) {
  const [records, branches] = await Promise.all([
    ckanRecords("c73bbe54-3a48-4ada-8eef-a1a2864021e4", fetchImpl, [
      "EventID",
      "Title",
      "StartTime",
      "EndTime",
      "LocationName",
      "Audiences",
      "Status",
    ]),
    ckanRecords("7420a950-e62b-41da-826c-32d31c46e8f8", fetchImpl, [
      "BranchCode",
      "BranchName",
      "Address",
      "Lat",
      "Long",
      "PhysicalBranch",
    ]),
  ]);
  if (!branches.length)
    throw new Error("Library branch locations are unavailable");
  const locations = new Map();
  for (const branch of branches) {
    if (
      Number(branch.PhysicalBranch) !== 1 ||
      /\bclosed\b/i.test(branch.BranchName)
    )
      continue;
    const name = normalized(branch.BranchName);
    // An ambiguous branch name is withheld rather than guessed.
    locations.set(name, locations.has(name) ? null : branch);
  }
  const stats = {
    fetched: records.length,
    outsideWindow: 0,
    excluded: 0,
    unverified: 0,
    duplicates: 0,
  };
  const venues = new Map(),
    seen = new Map();
  for (const record of records) {
    if (!record.EventID) throw new Error("Library feed is missing event IDs");
    if (
      !/^(ACTIVE|UPCOMING)$/i.test(record.Status) ||
      !/\badults\b|\bseniors\b|\bolder adults\b/i.test(record.Audiences || "")
    ) {
      stats.excluded++;
      continue;
    }
    if (/\bclosed\b|\bonline\b|\bvirtual\b/i.test(record.LocationName || "")) {
      stats.unverified++;
      continue;
    }
    const branch = locations.get(normalized(record.LocationName));
    if (!branch) {
      stats.unverified++;
      continue;
    }
    const title = plain(record.Title, 180);
    const startsAt = localToISO(record.StartTime),
      endsAt = localToISO(record.EndTime);
    if (
      startsAt &&
      endsAt &&
      (Date.parse(endsAt) <= window.start || Date.parse(startsAt) >= window.end)
    ) {
      stats.outsideWindow++;
      continue;
    }
    // The feed also carries month-long exhibits with midnight placeholders.
    // They do not provide a usable meeting time, so do not invent one.
    if (
      String(record.StartTime).endsWith("T00:00:00") &&
      String(record.EndTime).endsWith("T00:00:00")
    ) {
      stats.unverified++;
      continue;
    }
    const identity = [branch.BranchCode, title, startsAt, endsAt].join("|");
    if (seen.has(record.EventID)) {
      if (seen.get(record.EventID) !== identity)
        throw new Error("Library event has conflicting times or venues");
      stats.duplicates++;
      continue;
    }
    seen.set(record.EventID, identity);
    const full = [record.IsFull, record.RegistrationIsFull].some((v) =>
      /^(true|1)$/i.test(String(v)),
    );
    const closed = /^(true|1)$/i.test(String(record.RegistrationClosed));
    addSession(
      venues,
      {
        id: "tpl-" + key(branch.BranchCode),
        venueName: plain(branch.BranchName) + " Library",
        location: plain(branch.Address, 300),
        latitude: Number(branch.Lat),
        longitude: Number(branch.Long),
      },
      session(source, record.EventID, title, startsAt, endsAt, {
        seriesId: "tpl-" + key(branch.BranchCode + "|" + normalized(title)),
        sourceUrl:
          "https://tpl.bibliocommons.com/v2/events/" +
          encodeURIComponent(record.EventID),
        description:
          "Library programme. See the organizer's listing for details and registration.",
        interests: interestsFor(title, record.EventTypes),
        availability: full
          ? "Full — check organizer"
          : closed
            ? "Registration closed — check organizer"
            : "",
        cost: "",
        room: "",
        allDay: false,
      }),
      window,
      stats,
    );
  }
  return finish(source, venues, stats);
}

async function collectBayShore(source, window, fetchImpl) {
  const records = [];
  let expected = null,
    pages = null;
  for (let page = 1; page <= 100; page++) {
    const url = new URL(
      "https://www.bayshoreseniors.ca/wp-json/tribe/events/v1/events/",
    );
    url.search = new URLSearchParams({
      page: String(page),
      per_page: "50",
      start_date: window.startDate + " 00:00:00",
      end_date: window.endDate + " 00:00:00",
      status: "publish",
    }).toString();
    const data = await fetchJSON(url.toString(), fetchImpl);
    if (
      !Array.isArray(data.events) ||
      !Number.isInteger(data.total) ||
      data.total < 0 ||
      !Number.isInteger(data.total_pages) ||
      data.total_pages > 100 ||
      (expected !== null &&
        (expected !== data.total || pages !== data.total_pages))
    ) {
      throw new Error(
        "Seniors' calendar format changed or pagination is incomplete",
      );
    }
    expected = data.total;
    pages = data.total_pages;
    records.push(...data.events);
    if (page >= pages) break;
    if (!data.events.length) throw new Error("Incomplete seniors' calendar");
  }
  if (records.length !== expected)
    throw new Error("Incomplete seniors' calendar");
  const stats = {
    fetched: records.length,
    outsideWindow: 0,
    excluded: 0,
    unverified: 0,
  };
  const venues = new Map(),
    seen = new Set();
  // These are the club's verified rooms at its public hall, NOT every venue
  // used by this organizer. Unknown/off-site venues are withheld.
  const rooms = new Set([2490, 2542, 2525, 8899]);
  for (const record of records) {
    if (!record.id || seen.has(record.id))
      throw new Error("Seniors' calendar has duplicate/missing IDs");
    seen.add(record.id);
    if (
      record.status !== "publish" ||
      record.hide_from_listings === true ||
      record.event_status === "canceled" ||
      record.event_status === "cancelled"
    ) {
      stats.excluded++;
      continue;
    }
    if (
      !rooms.has(Number(record.venue?.id)) ||
      record.timezone !== "America/Toronto" ||
      record.all_day === true
    ) {
      stats.unverified++;
      continue;
    }
    const startsAt = localToISO(String(record.utc_start_date || "") + "Z");
    const endsAt = localToISO(String(record.utc_end_date || "") + "Z");
    if (
      !startsAt ||
      !endsAt ||
      localParts(Date.parse(startsAt), record.timezone) !==
        String(record.start_date).replace(" ", "T") ||
      localParts(Date.parse(endsAt), record.timezone) !==
        String(record.end_date).replace(" ", "T")
    ) {
      stats.unverified++;
      continue;
    }
    const title = plain(record.title, 180),
      description = plain(record.description);
    let sourceUrl;
    try {
      const link = new URL(record.url);
      if (
        link.protocol !== "https:" ||
        link.hostname !== "www.bayshoreseniors.ca"
      )
        throw new Error();
      sourceUrl = link.toString();
    } catch {
      stats.unverified++;
      continue;
    }
    // An empty cost field does not mean "free". Use explicit cost text only.
    const cost =
      plain(record.cost, 100) ||
      description.match(/\bCost:\s*([^\n]{1,80})/i)?.[1] ||
      "";
    addSession(
      venues,
      {
        id: "bayshore-hall",
        venueName: "Bay Shore Seniors Club",
        location: "2000 Tiny Beaches Road South, Tiny, ON L0L 1P1",
        latitude: 44.584603,
        longitude: -79.989,
      },
      session(source, record.id, title, startsAt, endsAt, {
        seriesId: "bayshore-" + key(normalized(title) + "|" + record.venue.id),
        sourceUrl,
        description,
        interests: interestsFor(title),
        cost,
        room: plain(record.venue.venue, 100),
        allDay: false,
        availability: "",
      }),
      window,
      stats,
    );
  }
  return finish(source, venues, stats);
}

function finish(source, venues, stats) {
  const output = [...venues.values()].map((venue) => ({
    ...venue,
    sessions: venue.sessions.sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    ),
  }));
  return {
    source,
    venues: output,
    stats: {
      ...stats,
      venues: output.length,
      sessions: output.reduce(
        (count, venue) => count + venue.sessions.length,
        0,
      ),
    },
  };
}

async function collectSource(
  source,
  { now = Date.now(), fetchImpl = fetch, venueCoordinates, readerOptions } = {},
) {
  const window = windowFor(now);
  let result;
  if (source.type === "tpl")
    result = await collectTPL(source, window, fetchImpl);
  else if (source.type === "bayshore")
    result = await collectBayShore(source, window, fetchImpl);
  else
    result = await collectAdditionalSource(source, {
      window,
      fetchImpl,
      venueCoordinates,
      readerOptions,
      key,
      plain,
      normalized,
      localToISO,
      session,
      addSession,
      finish,
      interestsFor,
    });
  return { ...result, windowEnd: new Date(window.end).toISOString() };
}

const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const millis = (value) =>
  value == null ? 0 : value instanceof Date ? value.getTime() : Date.parse(value);
const iso = (value) =>
  value == null || !Number.isFinite(millis(value))
    ? null
    : new Date(millis(value)).toISOString();
const sourceMap = (row) =>
  new Map((row || []).map((source) => [source.id, source]));

function sourceStatus(source, row, clock) {
  const active = row?.active_run_id;
  const lastSuccess = iso(row?.last_success_at);
  const ready =
    Boolean(active) && Number(row?.map_schema_version) === 2;
  const savedStats = json(row?.stats || {});
  const revision = row?.import_revision;
  return {
    id: source.id,
    name: source.name,
    area: source.area,
    ready: Boolean(active),
    refreshing: millis(row?.lease_until) > clock,
    lastSuccessAt: lastSuccess,
    stale:
      Boolean(row?.last_error) ||
      !lastSuccess ||
      clock - millis(row?.last_success_at) > DAY,
    stats:
      savedStats && Object.keys(savedStats).length ? savedStats : null,
    importRevision:
      revision == null || revision === ""
        ? null
        : Number.isNaN(Number(revision))
          ? revision
          : Number(revision),
    mapReady: ready,
  };
}

// A complete source snapshot is published atomically through one pointer.
// Failed/partial downloads never replace the last successful schedule.
function createExternalEventService(
  pool,
  { now = Date.now, fetchImpl = fetch, logger = console, readerOptions } = {},
) {
  const venueCoordinates = {
    async get(id) {
      const { rows } = await pool.query(
        "SELECT value FROM external_venue_coordinates WHERE id = $1",
        [id],
      );
      return rows[0]?.value || null;
    },
    async set(id, value) {
      await pool.query(
        `INSERT INTO external_venue_coordinates (id, value, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [id, JSON.stringify(value)],
      );
    },
  };
  let mapMetadata = null;
  let timer = null,
    running = null;

  async function syncOne(source, force) {
    const owner = randomUUID(),
      startedAt = now();
    const claimed = await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO external_event_sources (id, name, area)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [source.id, source.name, source.area],
      );
      const { rows } = await client.query(
        "SELECT * FROM external_event_sources WHERE id = $1 FOR UPDATE",
        [source.id],
      );
      const previous = rows[0];
      if (
        millis(previous.lease_until) > startedAt ||
        (!force &&
          previous.import_revision === String(revisionFor(source)) &&
          millis(previous.next_attempt_at) > startedAt)
      )
        return { claimed: false, previous };
      await client.query(
        `UPDATE external_event_sources
            SET name = $2, area = $3, lease_owner = $4,
                lease_until = $5, last_attempt_at = $6
          WHERE id = $1`,
        [
          source.id,
          source.name,
          source.area,
          owner,
          new Date(startedAt + LEASE_MS),
          new Date(startedAt),
        ],
      );
      return { claimed: true, previous };
    });
    if (!claimed.claimed) {
      const saved = claimed.previous;
      if (source.id === "ottawa-library")
        logger.log(
          "[events-debug] " +
            JSON.stringify({
              source: source.id,
              action: "usingSavedSnapshot",
              stats: saved.stats || null,
              importRevision: saved.import_revision ?? null,
              lastSuccessAt: iso(saved.last_success_at),
              importRunning: millis(saved.lease_until) > now(),
              nextAttemptAt: iso(saved.next_attempt_at),
            }),
        );
      return;
    }

    let runCreated = false,
      published = false;
    try {
      const collected = await collectSource(source, {
        now: startedAt,
        fetchImpl,
        venueCoordinates,
        readerOptions,
      });
      await pool.query(
        `INSERT INTO external_event_runs (source_id, id, created_at, status)
         VALUES ($1, $2, $3, 'building')`,
        [source.id, owner, new Date(startedAt)],
      );
      runCreated = true;
      const chunks = [];
      for (const venue of collected.venues) {
        let current = [],
          size = 0,
          part = 0;
        for (const item of venue.sessions) {
          const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
          if (current.length && size + bytes > 350000) {
            chunks.push({
              ...venue,
              id: venue.id + "-" + part++,
              sessions: current,
            });
            current = [];
            size = 0;
          }
          current.push(item);
          size += bytes;
        }
        if (current.length)
          chunks.push({
            ...venue,
            id: venue.id + "-" + part,
            sessions: current,
          });
      }
      for (let offset = 0; offset < chunks.length; offset += 100) {
        const batch = chunks.slice(offset, offset + 100);
        const values = [],
          params = [];
        batch.forEach((chunk, index) => {
          const base = index * 10;
          params.push(
            source.id,
            owner,
            chunk.id,
            chunk.id.replace(/-\d+$/, ""),
            chunk.venueName,
            chunk.location,
            chunk.latitude,
            chunk.longitude,
            mapCellFor(chunk.latitude, chunk.longitude),
            JSON.stringify(chunk.sessions),
          );
          values.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ` +
              `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, ` +
              `$${base + 9}, $${base + 10}::jsonb)`,
          );
        });
        await pool.query(
          `INSERT INTO external_event_venues
             (source_id, run_id, chunk_id, venue_id, venue_name, location,
              latitude, longitude, map_cell, sessions)
           VALUES ${values.join(", ")}`,
          params,
        );
      }

      const committed = await transaction(pool, async (client) => {
        const { rows } = await client.query(
          "SELECT * FROM external_event_sources WHERE id = $1 FOR UPDATE",
          [source.id],
        );
        const latest = rows[0];
        if (
          latest.lease_owner !== owner ||
          millis(latest.lease_until) <= now()
        )
          return false;
        await client.query(
          `UPDATE external_event_runs
              SET status = 'complete', stats = $3::jsonb
            WHERE source_id = $1 AND id = $2`,
          [source.id, owner, JSON.stringify(collected.stats)],
        );
        await client.query(
          `UPDATE external_event_sources
              SET active_run_id = $2, map_schema_version = 2,
                  map_cells = $3::text[], import_revision = $4,
                  consecutive_failures = 0, last_success_at = $5,
                  window_end = $6, next_attempt_at = $7,
                  lease_owner = NULL, lease_until = NULL, last_error = '',
                  stats = $8::jsonb
            WHERE id = $1`,
          [
            source.id,
            owner,
            [...new Set(
              chunks.map((chunk) =>
                mapCellFor(chunk.latitude, chunk.longitude),
              ),
            )],
            String(revisionFor(source)),
            new Date(now()),
            new Date(collected.windowEnd),
            new Date(
              now() +
                (collected.stats.coordinateFailures ? RETRY_MS : REFRESH_MS),
            ),
            JSON.stringify(collected.stats),
          ],
        );
        return true;
      });
      if (!committed)
        throw new Error("Import lease expired; retained the previous schedule");
      published = true;
      mapMetadata = null;
      logger.log(
        "[events] " +
          source.name +
          ": " +
          collected.stats.sessions +
          " sessions at " +
          collected.stats.venues +
          " venues",
      );
      if (source.id === "ottawa-library")
        logger.log(
          "[events-debug] " +
            JSON.stringify({
              source: source.id,
              revision: IMPORT_REVISION,
              activeRunId: owner,
              windowEnd: collected.windowEnd,
              stats: collected.stats,
            }),
        );
      for (const warning of collected.stats.warnings || [])
        logger.warn("[events] " + source.name + " venue lookup: " + warning);
      await pool.query(
        `DELETE FROM external_event_runs
          WHERE source_id = $1 AND id <> $2 AND created_at < $3`,
        [source.id, owner, new Date(now() - DAY)],
      );
    } catch (error) {
      const message = String(error.message || "Import failed").slice(0, 900);
      if (published) {
        logger.warn(
          "[events] " + source.name + " snapshot published; cleanup deferred: " + message,
        );
        return;
      }
      const hadSavedListings = Boolean(claimed.previous.active_run_id);
      await transaction(pool, async (client) => {
        await client.query(
          `UPDATE external_event_sources
              SET lease_owner = NULL, lease_until = NULL, last_error = $3,
                  import_revision = $4,
                  consecutive_failures = consecutive_failures + 1,
                  next_attempt_at = $5
            WHERE id = $1 AND lease_owner = $2`,
          [
            source.id,
            owner,
            message,
            String(revisionFor(source)),
            new Date(
              now() +
                Math.min(
                  RETRY_MS,
                  5 * 60 * 1000 * 2 ** Math.min(
                    claimed.previous.consecutive_failures || 0,
                    3,
                  ),
                ),
            ),
          ],
        );
        if (runCreated)
          await client.query(
            "DELETE FROM external_event_runs WHERE source_id = $1 AND id = $2",
            [source.id, owner],
          );
      });
      logger.warn(
        "[events] " +
          source.name +
          ": " +
          message +
          (hadSavedListings
            ? ". Saved listings retained."
            : ". No successful import yet; will retry automatically."),
      );
    }
  }

  async function sync({ force = false } = {}) {
    if (running) return running;
    running = limitedSettled(SOURCES, 3, (source) => syncOne(source, force))
      .then((results) => {
        for (const result of results)
          if (result.status === "rejected")
            logger.warn("[events] Refresh unavailable: " + result.reason.message);
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  async function read(bounds) {
    const { rows } = await pool.query(
      "SELECT * FROM external_event_sources WHERE id = ANY($1::text[])",
      [SOURCES.map((source) => source.id)],
    );
    const saved = sourceMap(rows),
      events = [],
      statuses = [];
    for (const [index, source] of SOURCES.entries()) {
      const row = saved.get(source.id),
        status = sourceStatus(source, row, now());
      statuses[index] = {
        id: status.id,
        name: status.name,
        area: status.area,
        ready: status.ready,
        refreshing: status.refreshing,
        lastSuccessAt: status.lastSuccessAt,
        stale: status.stale,
        stats: status.stats,
      };
      if (!row?.active_run_id) continue;
      const { rows: venues } = await pool.query(
        `SELECT venue_id, venue_name, location, latitude, longitude, sessions
           FROM external_event_venues
          WHERE source_id = $1 AND run_id = $2
            AND latitude BETWEEN $3 AND $4
          ORDER BY chunk_id`,
        [source.id, row.active_run_id, bounds.minLat, bounds.maxLat],
      );
      for (const venue of venues) {
        for (const item of json(venue.sessions) || [])
          events.push({
            ...item,
            venueId: venue.venue_id,
            venueName: venue.venue_name,
            location: venue.location,
            coordinate: {
              latitude: venue.latitude,
              longitude: venue.longitude,
            },
            refreshedAt: status.lastSuccessAt,
            stale: status.stale,
          });
      }
    }
    return { events, sources: statuses };
  }

  async function readMapSummaries(
    bounds,
    cells,
    budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 },
  ) {
    if (bounds.fresh || !mapMetadata || mapMetadata.expires <= now()) {
      const promise = pool
        .query(
          "SELECT * FROM external_event_sources WHERE id = ANY($1::text[])",
          [SOURCES.map((source) => source.id)],
        )
        .then(({ rows }) => sourceMap(rows));
      mapMetadata = { expires: now() + 40000, promise };
      promise.catch(() => {
        mapMetadata = null;
      });
    }
    const saved = await mapMetadata.promise,
      sources = [],
      records = [];
    for (const source of SOURCES) {
      const row = saved.get(source.id),
        base = sourceStatus(source, row, now()),
        ready = Boolean(row?.active_run_id) && base.mapReady,
        status = {
          id: base.id,
          name: base.name,
          area: base.area,
          ready,
          refreshing: base.refreshing || (!ready && !row?.last_error),
          lastSuccessAt: base.lastSuccessAt,
          stale: base.stale,
          stats: base.stats
            ? {
                venues: base.stats.venues ?? null,
                sessions: base.stats.sessions ?? null,
                unverified: base.stats.unverified ?? null,
              }
            : null,
          importRevision: base.importRevision,
          mapDocuments: 0,
          mapState: ready ? "outsideCells" : "notReady",
        };
      sources.push(status);
      if (
        !ready ||
        !(row.map_cells || []).some((cell) => cells.includes(cell))
      )
        continue;
      let after = "";
      for (;;) {
        const size = Math.min(100, budget.remainingDocs + 1);
        const { rows } = await pool.query(
          `SELECT chunk_id, venue_id, venue_name, location, latitude,
                  longitude, map_cell, sessions
             FROM external_event_venues
            WHERE source_id = $1 AND run_id = $2
              AND map_cell = ANY($3::text[]) AND chunk_id > $4
            ORDER BY chunk_id
            LIMIT $5`,
          [
            source.id,
            row.active_run_id,
            cells,
            after,
            Math.max(1, size),
          ],
        );
        let stop = false;
        for (const record of rows) {
          const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
          budget.remainingDocs--;
          budget.remainingBytes -= bytes;
          if (budget.remainingDocs < 0 || budget.remainingBytes < 0)
            throw Object.assign(
              new Error(
                "There are too many places in this area. Choose 2 km or 500 m, or move the map and search again.",
              ),
              { status: 422 },
            );
          status.mapDocuments++;
          records.push({
            venueId: record.venue_id,
            venueName: record.venue_name,
            location: record.location,
            latitude: record.latitude,
            longitude: record.longitude,
            mapCell: record.map_cell,
            sessions: json(record.sessions) || [],
            sourceId: source.id,
            sourceName: source.name,
            stale: status.stale,
            ref: {
              sourceId: source.id,
              runId: row.active_run_id,
              chunkId: record.chunk_id,
            },
          });
          after = record.chunk_id;
        }
        if (rows.length < size) break;
        if (budget.remainingDocs <= 0 || budget.remainingBytes <= 0) {
          stop = true;
          break;
        }
        if (stop) break;
      }
      status.mapState = status.mapDocuments ? "loaded" : "noMapDocuments";
    }
    return { records, sources };
  }

  async function loadMapSessions(reference) {
    if (!SOURCES.some((source) => source.id === reference.sourceId))
      throw new Error("Unknown community calendar.");
    const { rows } = await pool.query(
      `SELECT venue_id, venue_name, location, latitude, longitude, sessions
         FROM external_event_venues
        WHERE source_id = $1 AND run_id = $2 AND chunk_id = $3`,
      [reference.sourceId, reference.runId, reference.chunkId],
    );
    const venue = rows[0];
    if (!venue)
      throw Object.assign(
        new Error(
          "This calendar has updated. Refresh the map and select the place again.",
        ),
        { status: 409 },
      );
    return (json(venue.sessions) || []).map((item) => ({
      ...item,
      venueId: venue.venue_id,
      venueName: venue.venue_name,
      location: venue.location,
      coordinate: { latitude: venue.latitude, longitude: venue.longitude },
    }));
  }

  function start() {
    if (timer) return () => {};
    void sync();
    timer = setInterval(() => void sync(), 5 * 60 * 1000);
    timer.unref?.();
    return () => {
      clearInterval(timer);
      timer = null;
    };
  }
  return { sync, read, start, readMapSummaries, loadMapSessions };
}

function externalEventService(db) {
  if (!services.has(db)) services.set(db, createExternalEventService(db));
  return services.get(db);
}
function startExternalEventSync(db) {
  return externalEventService(db).start();
}

module.exports = {
  SOURCES,
  collectSource,
  createExternalEventService,
  externalEventService,
  startExternalEventSync,
  localToISO,
  interestsFor,
  windowFor,
  limitedSettled,
};