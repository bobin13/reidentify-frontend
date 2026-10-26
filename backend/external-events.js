const { createHash, randomUUID } = require("node:crypto");
const { decodeHTML } = require("entities");
const { mapCellFor, readCells } = require("./map-geography");

const DAY = 86400000;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;
const SOURCE_COLLECTION = "externalEventSources";
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/";
const services = new WeakMap();
const SOURCES = [
  { id: "tpl", name: "Toronto Public Library", area: "Toronto", type: "tpl" },
  { id: "bayshore", name: "Bay Shore Seniors", area: "Tiny", type: "bayshore" },
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
  { now = Date.now(), fetchImpl = fetch } = {},
) {
  const window = windowFor(now);
  const result = await (source.type === "tpl" ? collectTPL : collectBayShore)(
    source,
    window,
    fetchImpl,
  );
  return { ...result, windowEnd: new Date(window.end).toISOString() };
}

function mapSummaryFor(chunk) {
  return {
    venueId: chunk.venueId || chunk.id.replace(/-\d+$/, ""),
    venueName: chunk.venueName,
    location: chunk.location,
    latitude: chunk.latitude,
    longitude: chunk.longitude,
    mapCell: mapCellFor(chunk.latitude, chunk.longitude),
    sessions: (chunk.sessions || []).map((item) => ({
      id: item.id,
      seriesId: item.seriesId || item.id,
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      interests: item.interests || [],
      timeZone: item.timeZone || "America/Toronto",
    })),
  };
}

// A complete source snapshot is published atomically through one pointer.
// Failed/partial downloads never replace the last successful schedule.
function createExternalEventService(
  db,
  { now = Date.now, fetchImpl = fetch, logger = console } = {},
) {
  const sourceRefs = db.collection(SOURCE_COLLECTION);
  let mapMetadata = null;
  let timer = null,
    running = null;
  async function syncOne(source, force) {
    const reference = sourceRefs.doc(source.id),
      owner = randomUUID(),
      startedAt = now();
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(reference),
        previous = snap.data() || {};
      if (
        previous.leaseUntil > startedAt ||
        (!force &&
          previous.mapSchemaVersion === 2 &&
          previous.nextAttemptAt > startedAt)
      )
        return false;
      tx.set(
        reference,
        {
          name: source.name,
          area: source.area,
          leaseOwner: owner,
          leaseUntil: startedAt + LEASE_MS,
          lastAttemptAt: startedAt,
        },
        { merge: true },
      );
      return true;
    });
    if (!claimed) return;
    const run = reference.collection("runs").doc(owner);
    try {
      // Index the existing successful snapshot before contacting the publisher.
      // Saved activities remain usable even if that publisher is offline today.
      const legacy = (await reference.get()).data() || {};
      if (legacy.activeRunId && legacy.mapSchemaVersion !== 2) {
        const legacyRun = reference.collection("runs").doc(legacy.activeRunId);
        const old = await legacyRun.collection("venues").get();
        const mapCells = new Set();
        for (let offset = 0; offset < old.docs.length; offset += 200) {
          const batch = db.batch();
          for (const doc of old.docs.slice(offset, offset + 200)) {
            const summary = mapSummaryFor({ ...doc.data(), id: doc.id });
            mapCells.add(summary.mapCell);
            batch.set(
              legacyRun.collection("mapSummaries").doc(doc.id),
              summary,
            );
          }
          await batch.commit();
        }
        await db.runTransaction(async (tx) => {
          const latest = (await tx.get(reference)).data() || {};
          if (
            latest.leaseOwner !== owner ||
            latest.leaseUntil <= now() ||
            latest.activeRunId !== legacy.activeRunId
          )
            throw new Error("Saved map index changed; retrying.");
          tx.set(
            reference,
            { mapSchemaVersion: 2, mapCells: [...mapCells] },
            { merge: true },
          );
        });
        mapMetadata = null;
      }
      const collected = await collectSource(source, {
        now: startedAt,
        fetchImpl,
      });
      await run.set({ createdAt: startedAt, status: "building" });
      // Chunk large venue schedules well below Firestore's 1 MiB document limit.
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
      for (let offset = 0; offset < chunks.length; offset += 200) {
        const batch = db.batch();
        for (const chunk of chunks.slice(offset, offset + 200)) {
          batch.set(run.collection("venues").doc(chunk.id), {
            ...chunk,
            venueId: chunk.id.replace(/-\d+$/, ""),
            sourceId: source.id,
          });
          batch.set(
            run.collection("mapSummaries").doc(chunk.id),
            mapSummaryFor(chunk),
          );
        }
        await batch.commit();
      }
      const committed = await db.runTransaction(async (tx) => {
        const latest = (await tx.get(reference)).data() || {};
        if (latest.leaseOwner !== owner || latest.leaseUntil <= now())
          return false;
        tx.set(
          run,
          { status: "complete", stats: collected.stats },
          { merge: true },
        );
        tx.set(
          reference,
          {
            activeRunId: owner,
            mapSchemaVersion: 2,
            mapCells: [
              ...new Set(
                chunks.map((chunk) =>
                  mapCellFor(chunk.latitude, chunk.longitude),
                ),
              ),
            ],
            lastSuccessAt: now(),
            windowEnd: collected.windowEnd,
            nextAttemptAt: now() + REFRESH_MS,
            leaseOwner: "",
            leaseUntil: 0,
            lastError: "",
            stats: collected.stats,
          },
          { merge: true },
        );
        return true;
      });
      if (committed) mapMetadata = null;
      if (!committed)
        throw new Error("Import lease expired; retained the previous schedule");
      logger.log(
        "[events] " +
          source.name +
          ": " +
          collected.stats.sessions +
          " sessions at " +
          collected.stats.venues +
          " venues",
      );
      // Older snapshots remain for a day so in-flight readers can finish.
      const old = await reference
        .collection("runs")
        .where("createdAt", "<", now() - DAY)
        .get();
      for (const doc of old.docs) {
        if (doc.id !== owner) await db.recursiveDelete(doc.ref);
      }
    } catch (error) {
      const message = String(error.message || "Import failed").slice(0, 250);
      await db.runTransaction(async (tx) => {
        const latest = (await tx.get(reference)).data() || {};
        if (latest.leaseOwner === owner)
          tx.set(
            reference,
            {
              leaseOwner: "",
              leaseUntil: 0,
              lastError: message,
              nextAttemptAt: now() + RETRY_MS,
            },
            { merge: true },
          );
      });
      logger.warn(
        "[events] " +
          source.name +
          ": " +
          message +
          ". Saved listings retained.",
      );
    }
  }
  async function sync({ force = false } = {}) {
    if (running) return running;
    running = Promise.allSettled(
      SOURCES.map((source) => syncOne(source, force)),
    )
      .then((results) => {
        for (const result of results)
          if (result.status === "rejected") {
            logger.warn(
              "[events] Refresh unavailable: " + result.reason.message,
            );
          }
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  async function read(bounds) {
    const snapshots = await Promise.all(
      SOURCES.map((source) => sourceRefs.doc(source.id).get()),
    );
    const events = [],
      statuses = [];
    await Promise.all(
      snapshots.map(async (snapshot, index) => {
        const source = SOURCES[index],
          data = snapshot.data() || {};
        statuses[index] = {
          id: source.id,
          name: source.name,
          area: source.area,
          ready: Boolean(data.activeRunId),
          refreshing: data.leaseUntil > now(),
          lastSuccessAt: data.lastSuccessAt
            ? new Date(data.lastSuccessAt).toISOString()
            : null,
          stale:
            Boolean(data.lastError) ||
            !data.lastSuccessAt ||
            now() - data.lastSuccessAt > 24 * 60 * 60 * 1000,
          stats: data.stats || null,
        };
        if (!data.activeRunId) return;
        const venues = await sourceRefs
          .doc(source.id)
          .collection("runs")
          .doc(data.activeRunId)
          .collection("venues")
          .where("latitude", ">=", bounds.minLat)
          .where("latitude", "<=", bounds.maxLat)
          .get();
        for (const doc of venues.docs) {
          const venue = doc.data();
          if (!Array.isArray(venue.sessions)) continue;
          for (const item of venue.sessions)
            events.push({
              ...item,
              venueId: venue.venueId,
              venueName: venue.venueName,
              location: venue.location,
              coordinate: {
                latitude: venue.latitude,
                longitude: venue.longitude,
              },
              refreshedAt: statuses[index].lastSuccessAt,
              stale: statuses[index].stale,
            });
        }
      }),
    );
    return { events, sources: statuses };
  }
  async function readMapSummaries(
    bounds,
    cells,
    budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 },
  ) {
    if (!mapMetadata || mapMetadata.expires <= now()) {
      const promise = Promise.all(
        SOURCES.map((source) => sourceRefs.doc(source.id).get()),
      );
      mapMetadata = { expires: now() + 40000, promise };
      promise.catch(() => {
        mapMetadata = null;
      });
    }
    const snapshots = await mapMetadata.promise;
    const sources = [],
      records = [];
    // Sequential sources keep the database read budget bounded across providers.
    for (let index = 0; index < SOURCES.length; index++) {
      const source = SOURCES[index],
        data = snapshots[index].data() || {};
      const ready = Boolean(data.activeRunId) && data.mapSchemaVersion === 2;
      const status = {
        id: source.id,
        name: source.name,
        area: source.area,
        ready,
        refreshing: data.leaseUntil > now() || (!ready && !data.lastError),
        lastSuccessAt: data.lastSuccessAt
          ? new Date(data.lastSuccessAt).toISOString()
          : null,
        stale:
          Boolean(data.lastError) ||
          !data.lastSuccessAt ||
          now() - data.lastSuccessAt > 24 * 60 * 60 * 1000,
      };
      sources.push(status);
      if (
        !ready ||
        (Array.isArray(data.mapCells) &&
          !data.mapCells.some((cell) => cells.includes(cell)))
      )
        continue;
      const docs = await readCells(
        sourceRefs
          .doc(source.id)
          .collection("runs")
          .doc(data.activeRunId)
          .collection("mapSummaries"),
        cells,
        null,
        budget,
      );
      for (const doc of docs)
        records.push({
          ...doc.data(),
          sourceId: source.id,
          sourceName: source.name,
          stale: status.stale,
          ref: {
            sourceId: source.id,
            runId: data.activeRunId,
            chunkId: doc.id,
          },
        });
    }
    return { records, sources };
  }
  async function loadMapSessions(reference) {
    if (!SOURCES.some((source) => source.id === reference.sourceId))
      throw new Error("Unknown community calendar.");
    const snapshot = await sourceRefs
      .doc(reference.sourceId)
      .collection("runs")
      .doc(reference.runId)
      .collection("venues")
      .doc(reference.chunkId)
      .get();
    if (!snapshot.exists)
      throw Object.assign(
        new Error(
          "This calendar has updated. Refresh the map and select the place again.",
        ),
        { status: 409 },
      );
    const venue = snapshot.data();
    return (venue.sessions || []).map((item) => ({
      ...item,
      venueId: venue.venueId,
      venueName: venue.venueName,
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
};