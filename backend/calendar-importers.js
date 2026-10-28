// Public-calendar adapters. All dates/addresses come from their publishers.
// A failed or incomplete download throws, leaving the prior source snapshot active.
const { decodeHTML } = require("entities");
const {
  ONTARIO_SOURCES,
  collectOntarioSource,
} = require("./ontario-calendar-importers");
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/";
const SPRINT = "https://www.sprintseniorcare.org";
const OTTAWA = "https://booking.biblioottawalibrary.ca";
const ALLOWED = new Set([
  "ckan0.cf.opendata.inter.prod-toronto.ca",
  "www.sprintseniorcare.org",
  "booking.biblioottawalibrary.ca",
  "about.biblioottawalibrary.ca",
  ...ONTARIO_SOURCES.map((source) => new URL(source.url).hostname),
  "geogratis.gc.ca",
  "www.geolocator.api.geo.ca",
]);
const EXTRA_SOURCES = [
  {
    id: "toronto-recreation",
    name: "City of Toronto Recreation",
    area: "Toronto",
    type: "toronto-recreation",
  },
  { id: "sprint", name: "SPRINT Senior Care", area: "Toronto", type: "sprint" },
  {
    id: "ottawa-library",
    name: "Ottawa Public Library",
    area: "Ottawa",
    type: "ottawa-library",
  },
  ...ONTARIO_SOURCES,
];
// Initial venue catalogue: publisher addresses matched to Natural Resources Canada
// street-address estimates on 2026-10-26. These are not entrance-level GPS points.
// Matching requires both venue URL and address; changed/new addresses are resolved separately.
const SPRINT_VENUES = [
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/vibrant-healthcare-alliance/",
    name: "Vibrant Healthcare alliance",
    address: "2398 Yonge Street",
    latitude: 43.709586100000024,
    longitude: -79.39898160000001,
    location: "2398 Yonge Street, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=2398%20Yonge%20Street%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:41.579Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/joseph-brown-manor/",
    name: "Joseph Brown Manor",
    address: "3179 Yonge St.",
    latitude: 43.727331480000004,
    longitude: -79.40279206000001,
    location: "3179 Yonge Street, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=3179%20Yonge%20St.%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:41.805Z",
  },
  {
    venueUrl: "https://www.sprintseniorcare.org/mc-locations/mcmurrich-place/",
    name: "McMurrich Place",
    address: "18 Davenport Rd.",
    latitude: 43.672880296911025,
    longitude: -79.38874566913263,
    location: "18 Davenport Road, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=18%20Davenport%20Rd.%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:42.963Z",
  },
  {
    venueUrl: "https://www.sprintseniorcare.org/mc-locations/montgomery-place/",
    name: "Montgomery Place",
    address: "130 Eglington Avenue East",
    latitude: 43.707596000000024,
    longitude: -79.39412540000001,
    location: "130 Eglinton Avenue East, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=130%20Eglinton%20Avenue%20East%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:43.016Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/sherwood-apartments/",
    name: "Sherwood Apartments",
    address: "2567, Yonge Street",
    latitude: 43.71381603333333,
    longitude: -79.39985326666667,
    location: "2567 Yonge Street, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=2567%20Yonge%20Street%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:44.116Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/janet-magee-manor/",
    name: "Janet Magee Manor",
    address: "71 Merton St.",
    latitude: 43.69657603447083,
    longitude: -79.39399412237776,
    location: "71 Merton Street, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=71%20Merton%20St.%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:44.195Z",
  },
  {
    venueUrl: "https://www.sprintseniorcare.org/mc-locations/moore-place/",
    name: "Moore Place",
    address: "801 Mount Pleasant",
    latitude: 43.70841589999998,
    longitude: -79.39016149999998,
    location: "801 Mount Pleasant Road, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=801%20Mount%20Pleasant%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:45.286Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/george-barker-manor/",
    name: "George Barker Manor",
    address: "384 Mt Pleasant Road",
    latitude: 43.69826792187778,
    longitude: -79.38650118898913,
    location: "384 Mount Pleasant Road, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=384%20Mount%20Pleasant%20Road%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:45.557Z",
  },
  {
    venueUrl: "https://www.sprintseniorcare.org/mc-locations/brentwood-towers/",
    name: "Brentwood Towers",
    address: "19 Lascelles Blvd.",
    latitude: 43.69490354999999,
    longitude: -79.39947130000002,
    location: "19 Lascelles Boulevard, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=19%20Lascelles%20Blvd.%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:46.758Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/marjory-carton-apartments/",
    name: "Marjory Carton Apartments",
    address: "193 Wilson Ave.",
    latitude: 43.73944183571428,
    longitude: -79.42359980714285,
    location: "193 Wilson Avenue, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=193%20Wilson%20Ave.%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:46.776Z",
  },
  {
    venueUrl:
      "https://www.sprintseniorcare.org/mc-locations/sprint-senior-care/",
    name: "SPRINT Senior Care",
    address: "130 Merton Street",
    latitude: 43.69698447923232,
    longitude: -79.39200780364209,
    location: "130 Merton Street, City Of Toronto, Ontario",
    coordinateSource: "Natural Resources Canada street-address estimate",
    coordinateUrl:
      "https://geogratis.gc.ca/services/geolocation/en/locate?q=130%20Merton%20Street%2C%20Toronto%2C%20Ontario",
    verifiedAt: "2026-10-26T08:11:47.874Z",
  },
];
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function safeURL(value, base) {
  const url = new URL(value, base);
  if (
    url.protocol !== "https:" ||
    !ALLOWED.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Calendar linked to an unsupported source host.");
  return url;
}
function runReader(fetchImpl, options = {}) {
  const now = options.now || Date.now;
  const sleep =
    options.sleep ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.budgetMs ?? 7 * 60 * 1000);
  const requests = new Map();
  function failure(message, url, retryable = false) {
    const address = safeURL(url);
    const error = new Error(
      message +
        " at " +
        (address.host + address.pathname + address.search).slice(0, 180),
    );
    error.retryable = retryable;
    return error;
  }
  async function get(value, kind = "html", maximum = 2000000) {
    const original = safeURL(value).toString();
    const key = kind + "|" + maximum + "|" + original;
    if (requests.has(key)) return requests.get(key);
    const pending = (async () => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        let url = original,
          retryAfter = 0;
        try {
          for (let redirect = 0; redirect < 5; redirect++) {
            const remaining = deadline - now();
            if (remaining <= 0)
              throw failure("Source refresh time budget exhausted", url);
            const timeoutMs = Math.min(
              remaining,
              maximum > 6000000
                ? (options.largeTimeoutMs ?? 120000)
                : (options.requestTimeoutMs ?? 45000),
            );
            const controller = new AbortController();
            let timedOut = false,
              response,
              reader;
            const timer = setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs);
            try {
              response = await fetchImpl(url, {
                signal: controller.signal,
                redirect: "manual",
                headers: {
                  "User-Agent": "ReIdentify-CommunityCalendars/1.1",
                  Accept:
                    kind === "json"
                      ? "application/json"
                      : kind === "ics"
                        ? "text/calendar"
                        : "text/html",
                },
              });
              if (response.status >= 300 && response.status < 400) {
                const target = response.headers.get("location");
                if (!target) throw failure("Redirect has no destination", url);
                url = safeURL(target, url).toString();
                continue;
              }
              if (!response.ok) {
                const header = response.headers.get("retry-after");
                retryAfter = header
                  ? /^\d+$/.test(header)
                    ? Number(header) * 1000
                    : Date.parse(header) - now()
                  : 0;
                throw failure(
                  "HTTP " + response.status,
                  url,
                  response.status === 429 || response.status >= 500,
                );
              }
              const mime = response.headers.get("content-type") || "";
              if (kind === "html" && !/html/i.test(mime))
                throw failure("Unexpected calendar page format", url);
              if (kind === "ics" && !/calendar|plain|octet-stream/i.test(mime))
                throw failure("Expected iCalendar data", url);
              if (Number(response.headers.get("content-length")) > maximum)
                throw failure("Download exceeds size limit", url);
              if (!response.body)
                throw failure("Empty response body", url, true);
              reader = response.body.getReader();
              const chunks = [];
              let bytes = 0;
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > maximum)
                  throw failure("Download exceeds size limit", url);
                chunks.push(Buffer.from(value));
              }
              const body = Buffer.concat(chunks).toString("utf8");
              if (kind !== "json") return body;
              try {
                return JSON.parse(body);
              } catch {
                throw failure("Invalid or incomplete JSON download", url, true);
              }
            } catch (error) {
              if (error.retryable !== undefined) throw error;
              // Unsafe redirects are permanent failures, including before a new fetch.
              if (/unsupported source host/.test(error.message || ""))
                throw failure(error.message, url);
              throw failure(
                timedOut
                  ? "Request timed out after " +
                      Math.ceil(timeoutMs / 1000) +
                      "s"
                  : "Network/download error: " +
                      (error.cause?.code ||
                        error.code ||
                        error.message ||
                        "connection lost"),
                url,
                true,
              );
            } finally {
              clearTimeout(timer);
              controller.abort();
              if (reader) {
                try {
                  await reader.cancel();
                } catch {}
              } else {
                try {
                  await response?.body?.cancel();
                } catch {}
              }
            }
          }
          throw failure("Too many calendar redirects", url);
        } catch (error) {
          lastError = error;
          if (!error.retryable || attempt === 2) throw error;
          const pause = Math.max(
            attempt === 0 ? 1500 : 4000,
            Number.isFinite(retryAfter)
              ? Math.min(30000, Math.max(0, retryAfter))
              : 0,
          );
          if (deadline - now() <= pause)
            throw failure("Source refresh time budget exhausted", url);
          await sleep(pause);
        }
      }
      throw lastError;
    })();
    requests.set(key, pending);
    return pending;
  }
  return get;
}
async function pool(items, concurrency, operation) {
  let cursor = 0,
    failure;
  const results = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = await operation(items[index], index);
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  if (failure) throw failure;
  return results;
}

// A small HTML tree reader for the semantic fields used by these two calendars.
// It ignores script/style content. No page scripts are executed.
function parseHTML(input) {
  const root = { tag: "#root", attrs: {}, children: [] },
    stack = [root];
  let index = 0,
    count = 0;
  while (index < input.length) {
    if (++count > 250000)
      throw new Error("Calendar page has too many HTML elements.");
    if (input.startsWith("<!--", index)) {
      const end = input.indexOf("-->", index + 4);
      index = end < 0 ? input.length : end + 3;
      continue;
    }
    if (input[index] !== "<") {
      const end = input.indexOf("<", index),
        stop = end < 0 ? input.length : end;
      stack.at(-1).children.push({
        tag: "#text",
        value: decodeHTML(input.slice(index, stop)),
      });
      index = stop;
      continue;
    }
    let end = index + 1,
      quote = "";
    for (; end < input.length; end++) {
      const ch = input[end];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    const token = input.slice(index + 1, end);
    index = end + 1;
    if (/^[!?]/.test(token)) continue;
    const match = /^\s*(\/?)\s*([\w:-]+)/.exec(token);
    if (!match) continue;
    const tag = match[2].toLowerCase();
    if (match[1]) {
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      continue;
    }
    if (tag === "script" || tag === "style") {
      const close = new RegExp("</" + tag + "\\s*>", "ig");
      close.lastIndex = index;
      const m = close.exec(input);
      index = m ? close.lastIndex : input.length;
      continue;
    }
    const attrs = {},
      body = token.slice(match[0].length);
    const expression =
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const a of body.matchAll(expression))
      attrs[a[1].toLowerCase()] = decodeHTML(a[2] ?? a[3] ?? a[4] ?? "");
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(token)) stack.push(node);
    if (stack.length > 200) throw new Error("Calendar HTML nesting changed.");
  }
  return root;
}
function all(root, test) {
  if (!root) return [];
  const found = [],
    stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (test(node)) found.push(node);
    if (node.children)
      for (let i = node.children.length - 1; i >= 0; i--)
        stack.push(node.children[i]);
  }
  return found;
}
function first(root, test) {
  return all(root, test)[0] || null;
}
const has = (node, name) =>
  Boolean(node?.attrs?.class?.split(/\s+/).includes(name));
function text(node) {
  return node
    ? (node.tag === "#text"
        ? node.value
        : (node.children || []).map(text).join(" ")
      )
        .replace(/\s+/g, " ")
        .trim()
    : "";
}
const field = (root, names) =>
  first(root, (n) => names.some((name) => has(n, name)));
function jsonScripts(html) {
  const output = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/application\/(?:ld\+)?json/i.test(m[1])) continue;
    try {
      output.push(JSON.parse(m[2]));
    } catch {
      /* Ignore unrelated broken analytics/schema scripts. */
    }
  }
  return output;
}
function walkJSON(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walkJSON(child, visit);
}
function pointOf(geometry) {
  if (typeof geometry === "string") {
    try {
      geometry = JSON.parse(geometry);
    } catch {
      return null;
    }
  }
  const pair =
    geometry?.type === "Point"
      ? geometry.coordinates
      : geometry?.type === "MultiPoint" && geometry.coordinates?.length === 1
        ? geometry.coordinates[0]
        : null;
  if (!pair || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]))
    return null;
  // This adapter accepts only the intended Ontario city bounds.
  if (pair[1] < 43.4 || pair[1] > 44.1 || pair[0] < -80 || pair[0] > -78.8)
    return null;
  return { latitude: pair[1], longitude: pair[0] };
}
const cleanCell = (value) =>
  value == null || /^(none|null)$/i.test(String(value))
    ? ""
    : String(value).trim();
function streetKey(value, normalize) {
  return normalize(value)
    .replace(/\beglington\b/g, "eglinton")
    .replace(/\bmt\b/g, "mount")
    .replace(
      /\b(street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|court|crt|ct|crescent|cres|lane|ln|parkway|pkwy|terrace|ter|place|pl)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}
async function cityAddressLookup(get, normalize) {
  let resource;
  const cache = new Map();
  return async (rawAddress) => {
    const address = String(rawAddress)
      .replace(/^(\d+[a-z]?),\s*/i, "$1 ")
      .split(/,\s*(?:suite|unit|Toronto|ON\b)/i)[0];
    const match = /^(\d+[a-z]?)\s+(.+)$/i.exec(address.trim());
    if (!match) return null;
    const number = match[1],
      street = streetKey(match[2], normalize),
      key = number + "|" + street;
    if (cache.has(key)) return cache.get(key);
    const pending = (async () => {
      if (!resource) {
        const meta = await get(
          CKAN +
            "package_show?id=address-points-municipal-toronto-one-address-repository",
          "json",
        );
        resource = meta.result?.resources?.find(
          (r) => r.datastore_active && /address points/i.test(r.name),
        )?.id;
        if (!resource)
          throw new Error("Toronto address-point resource changed.");
      }
      const records = [];
      let total = null;
      while (total === null || records.length < total) {
        const query = new URLSearchParams({
          resource_id: resource,
          filters: JSON.stringify({ ADDRESS_NUMBER: number }),
          fields:
            "ADDRESS_NUMBER,LINEAR_NAME_FULL,ADDRESS_FULL,geometry,ADDRESS_POINT_ID",
          limit: "1000",
          offset: String(records.length),
          sort: "_id asc",
        });
        const data = await get(CKAN + "datastore_search?" + query, "json");
        const result = data.result;
        if (
          !data.success ||
          !Array.isArray(result?.records) ||
          !Number.isInteger(result.total) ||
          result.total > 15000 ||
          result.total_was_estimated === true ||
          (total !== null && result.total !== total)
        )
          throw new Error("Incomplete Toronto address lookup.");
        total = result.total;
        records.push(...result.records);
        if (
          records.length > total ||
          (!result.records.length && records.length < total)
        )
          throw new Error("Incomplete Toronto address lookup.");
      }
      const matches = records
        .filter(
          (r) =>
            cleanCell(r.ADDRESS_NUMBER) === number &&
            streetKey(r.LINEAR_NAME_FULL, normalize) === street,
        )
        .map((r) => ({ row: r, point: pointOf(r.geometry) }))
        .filter((r) => r.point);
      if (!matches.length) return null;
      const distinctAddresses = new Set(
        matches.map((m) => normalize(m.row.ADDRESS_FULL)),
      );
      if (distinctAddresses.size !== 1) return null;
      const firstPoint = matches[0].point;
      if (
        matches.some(
          (m) =>
            Math.abs(m.point.latitude - firstPoint.latitude) > 0.0005 ||
            Math.abs(m.point.longitude - firstPoint.longitude) > 0.0007,
        )
      )
        return null;
      matches.sort((a, b) =>
        String(a.row.ADDRESS_POINT_ID).localeCompare(
          String(b.row.ADDRESS_POINT_ID),
        ),
      );
      return {
        ...matches[0].point,
        location: matches[0].row.ADDRESS_FULL + ", Toronto, ON",
      };
    })();
    cache.set(key, pending);
    return pending;
  };
}
function stats() {
  return {
    fetched: 0,
    outsideWindow: 0,
    excluded: 0,
    unverified: 0,
    duplicates: 0,
  };
}
function downloadResource(metadata, name) {
  const r = metadata.result?.resources?.find(
    (r) =>
      /json/i.test(r.format || "") &&
      r.name?.toLowerCase() === name.toLowerCase(),
  );
  if (!metadata.success || !r?.url)
    throw new Error("City calendar download format changed: " + name);
  return safeURL(r.url).toString();
}
async function cityTable(
  metadata,
  name,
  get,
  maximumRows,
  maximumBytes,
  fields,
) {
  const resource = metadata.result?.resources?.find(
    (r) => r.datastore_active && r.name?.toLowerCase() === name.toLowerCase(),
  );
  if (metadata.success && resource?.id) {
    try {
      const records = [],
        seen = new Set();
      let total = null;
      do {
        const params = new URLSearchParams({
          resource_id: resource.id,
          limit: "1000",
          offset: String(records.length),
          sort: "_id asc",
        });
        if (fields) params.set("fields", ["_id", ...fields].join(","));
        const data = await get(
          CKAN + "datastore_search?" + params,
          "json",
          4000000,
        );
        const result = data.result;
        if (
          !data.success ||
          !Array.isArray(result?.records) ||
          !Number.isInteger(result.total) ||
          result.total < 0 ||
          result.total > maximumRows ||
          result.total_was_estimated === true ||
          (total !== null && result.total !== total)
        )
          throw new Error("Incomplete " + name + " API total");
        total = result.total;
        if (!result.records.length && records.length < total)
          throw new Error("Missing " + name + " API page");
        for (const row of result.records) {
          if (!Number.isInteger(row._id) || seen.has(row._id))
            throw new Error("Duplicate/invalid " + name + " API page");
          seen.add(row._id);
          records.push(row);
        }
        if (records.length > total)
          throw new Error("Inconsistent " + name + " API page size");
      } while (records.length < total);
      return records;
    } catch (error) {
      // A complete official file is an alternative to a failing/paginated API.
      // Never combine a partial API response with a different file snapshot.
      try {
        return await get(
          downloadResource(metadata, name + ".json"),
          "json",
          maximumBytes,
        );
      } catch (fallback) {
        throw new Error(
          name + " API and file download failed: " + fallback.message,
        );
      }
    }
  }
  return get(downloadResource(metadata, name + ".json"), "json", maximumBytes);
}
function cityTime(date, hour, minute, localToISO) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    hour < 0 ||
    hour > 24 ||
    (hour === 24 && minute !== 0)
  )
    return null;
  if (hour === 24) {
    const value = Date.parse(date + "T12:00:00Z");
    if (!Number.isFinite(value)) return null;
    date = new Date(value + 86400000).toISOString().slice(0, 10);
    hour = 0;
  }
  return localToISO(
    date +
      "T" +
      String(hour).padStart(2, "0") +
      ":" +
      String(minute).padStart(2, "0") +
      ":00",
  );
}
async function torontoRecreation(source, h, get) {
  const [meta, geoMeta] = await Promise.all([
    get(
      CKAN + "package_show?id=registered-programs-and-drop-in-courses-offering",
      "json",
    ),
    get(CKAN + "package_show?id=parks-and-recreation-facilities", "json"),
  ]);
  const geoResource = geoMeta.result?.resources?.find((r) =>
    /4326\.geojson$/i.test(r.name || ""),
  );
  if (!geoResource)
    throw new Error("Toronto recreation coordinates are unavailable.");
  const [records, locations, geography] = await Promise.all([
    cityTable(meta, "Drop-in", get, 100000, 25000000, [
      "Course_ID",
      "Course Title",
      "Location ID",
      "Age Min",
      "Age Max",
      "First Date",
      "Last Date",
      "Start Hour",
      "Start Minute",
      "End Hour",
      "End Min",
      "Section",
    ]),
    cityTable(meta, "Locations", get, 15000, 6000000),
    get(geoResource.url, "json", 8000000),
  ]);
  if (
    !Array.isArray(records) ||
    records.length > 100000 ||
    !Array.isArray(locations) ||
    !locations.length ||
    !Array.isArray(geography.features) ||
    !geography.features.length
  )
    throw new Error("Toronto recreation download is incomplete.");
  const required = [
    "Course_ID",
    "Course Title",
    "Location ID",
    "Age Min",
    "Age Max",
    "First Date",
    "Last Date",
    "Start Hour",
    "Start Minute",
    "End Hour",
    "End Min",
  ];
  if (records.length && !required.every((k) => k in records[0]))
    throw new Error("Toronto recreation schedule fields changed.");
  const byLocation = new Map(
    locations.map((r) => [String(r["Location ID"]), r]),
  );
  const coordinates = new Map();
  for (const feature of geography.features) {
    const id = String(feature.properties?.LOCATIONID),
      point = pointOf(feature.geometry);
    if (point) coordinates.set(id, { ...point, url: feature.properties.URL });
  }
  const counts = stats(),
    candidates = [],
    seen = new Set(),
    venues = new Map();
  counts.fetched = records.length;
  for (const row of records) {
    const minimum = Number(row["Age Min"]),
      maxText = cleanCell(row["Age Max"]),
      maximum = maxText ? Number(maxText) : Infinity;
    // Adults/older-adult programs; exclude children/youth-only age bands.
    if (
      !cleanCell(row["Age Min"]) ||
      !Number.isFinite(minimum) ||
      minimum < 18 ||
      minimum > 65 ||
      !(maximum >= 60)
    ) {
      counts.excluded++;
      continue;
    }
    if (row["First Date"] !== row["Last Date"]) {
      counts.unverified++;
      continue;
    }
    const startsAt = cityTime(
      row["First Date"],
      row["Start Hour"],
      row["Start Minute"],
      h.localToISO,
    );
    const endsAt = cityTime(
      row["Last Date"],
      row["End Hour"],
      row["End Min"],
      h.localToISO,
    );
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      counts.unverified++;
      continue;
    }
    if (
      Date.parse(endsAt) <= h.window.start ||
      Date.parse(startsAt) >= h.window.end
    ) {
      counts.outsideWindow++;
      continue;
    }
    if (
      !Number.isInteger(Number(row.Course_ID)) ||
      Number(row.Course_ID) <= 0 ||
      !Number.isInteger(Number(row["Location ID"])) ||
      Number(row["Location ID"]) <= 0
    ) {
      counts.unverified++;
      continue;
    }
    const id = [row.Course_ID, row["Location ID"], startsAt].join("|");
    if (seen.has(id)) {
      counts.duplicates++;
      continue;
    }
    seen.add(id);
    candidates.push({ row, id, startsAt, endsAt });
  }
  const lookupAddress = await cityAddressLookup(get, h.normalized),
    resolved = new Map();
  await pool(
    [...new Set(candidates.map((c) => String(c.row["Location ID"])))],
    3,
    async (id) => {
      const location = byLocation.get(id);
      if (!location) return;
      const address = [
        "Street No",
        "Street No Suffix",
        "Street Name",
        "Street Type",
        "Street Direction",
      ]
        .map((k) => cleanCell(location[k]))
        .filter(Boolean)
        .join(" ");
      if (!address || !cleanCell(location["Location Name"])) return;
      let point = coordinates.get(id);
      const parent = byLocation.get(String(location["Parent Location ID"]));
      if (!point && parent) {
        const parentAddress = [
          "Street No",
          "Street No Suffix",
          "Street Name",
          "Street Type",
          "Street Direction",
        ]
          .map((k) => cleanCell(parent[k]))
          .filter(Boolean)
          .join(" ");
        if (h.normalized(parentAddress) === h.normalized(address))
          point = coordinates.get(String(location["Parent Location ID"]));
      }
      if (!point) point = await lookupAddress(address);
      if (point)
        resolved.set(id, {
          id: "toronto-rec-" + h.key(id),
          venueName: h.plain(location["Location Name"], 180),
          location: address + ", Toronto, ON",
          latitude: point.latitude,
          longitude: point.longitude,
          sourceUrl:
            point.url ||
            "https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/parks-and-recreation-facilities/location/?id=" +
              encodeURIComponent(id),
        });
    },
  );
  for (const { row, id, startsAt, endsAt } of candidates) {
    const venue = resolved.get(String(row["Location ID"]));
    if (!venue) {
      counts.unverified++;
      continue;
    }
    const title = h.plain(row["Course Title"], 180);
    const interests = new Set(h.interestsFor(title, row.Section || ""));
    if (/swim|aquafit/i.test(title)) interests.add("Swimming");
    if (/snooker|billiard/i.test(title)) interests.add("Billiards/pool");
    if (/gentle fit|aquafit|strength|cardio/i.test(title))
      interests.add("Fitness/exercise");
    if (/club:\s*social/i.test(title))
      interests.add("Conversation/social meetups");
    h.addSession(
      venues,
      venue,
      h.session(source, id, title, startsAt, endsAt, {
        seriesId:
          "toronto-rec-" +
          h.key(String(row.Course_ID) + "|" + row["Location ID"]),
        interests: [...interests],
        sourceUrl: venue.sourceUrl,
        description:
          "City of Toronto drop-in activity. Check the city listing or contact the centre for attendance requirements, fees and availability. Schedule and venue coordinates: City of Toronto Open Data.",
        cost: "Check city listing for drop-in fees",
        availability:
          "Ages " +
          row["Age Min"] +
          (cleanCell(row["Age Max"]) ? "–" + row["Age Max"] : "+") +
          ". Check the centre for space and attendance requirements.",
        room: "",
      }),
      h.window,
      counts,
    );
  }
  if (candidates.length && !resolved.size)
    throw new Error(
      "No Toronto recreation venue coordinates could be verified.",
    );
  return h.finish(source, venues, counts);
}

function addressKey(address, normalize) {
  return streetKey(
    String(address)
      .replace(/^(\d+[a-z]?),\s*/i, "$1 ")
      .split(/,\s*(?:suite|unit|Toronto|ON\b)/i)[0],
    normalize,
  );
}
async function sprintCoordinates(candidates, h, get, counts) {
  const lookup = await cityAddressLookup(get, h.normalized);
  const resolved = new Map();
  const unique = new Map(
    candidates.map((c) => [
      c.venueUrl + "|" + addressKey(c.address, h.normalized),
      c,
    ]),
  );
  await pool([...unique], 2, async ([identity, event]) => {
    const expected = addressKey(event.address, h.normalized);
    const id = h.key("sprint|" + identity);
    let point = await h.venueCoordinates?.get(id);
    if (
      point &&
      (point.venueUrl !== event.venueUrl ||
        point.addressKey !== expected ||
        !pointOf({
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        }))
    )
      point = null;
    if (!point) {
      const seed = SPRINT_VENUES.find(
        (v) =>
          v.venueUrl === event.venueUrl &&
          addressKey(v.address, h.normalized) === expected,
      );
      if (seed) point = { ...seed };
    }
    if (!point) {
      try {
        const found = await lookup(event.address);
        if (found)
          point = {
            ...found,
            coordinateSource: "City of Toronto Address Points",
            coordinateUrl:
              "https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/",
          };
      } catch (error) {
        counts.coordinateFailures = (counts.coordinateFailures || 0) + 1;
        counts.warnings ||= [];
        if (counts.warnings.length < 3)
          counts.warnings.push(event.name + ": " + error.message);
      }
    }
    if (!point) return;
    const saved = {
      latitude: point.latitude,
      longitude: point.longitude,
      location: point.location || event.address + ", Toronto, ON",
      venueUrl: event.venueUrl,
      addressKey: expected,
      coordinateSource:
        point.coordinateSource || "Saved verified venue location",
      coordinateUrl: point.coordinateUrl || event.venueUrl,
      verifiedAt: point.verifiedAt || new Date().toISOString(),
    };
    if (h.venueCoordinates) await h.venueCoordinates.set(id, saved);
    resolved.set(identity, saved);
  });
  return resolved;
}

async function sprintCalendar(source, h, get) {
  const base = SPRINT + "/news-media-calendar/calendar/";
  const initialHTML = await get(base),
    initial = parseHTML(initialHTML);
  const navigation = first(
    initial,
    (n) =>
      n.attrs?.["data-href"] && String(n.attrs["data-href"]).includes("month="),
  );
  if (!field(initial, ["my-calendar-month"]) || !navigation)
    throw new Error("SPRINT calendar layout changed.");
  const start = h.window.startDate.slice(0, 7),
    end = h.window.endDate.slice(0, 7);
  const months = [...new Set([start, end])],
    candidates = [],
    counts = stats(),
    seen = new Map(),
    venues = new Map();
  for (const month of months) {
    const [year, m] = month.split("-").map(Number);
    const label = new Intl.DateTimeFormat("en-CA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, m - 1, 1)));
    let root;
    if (text(field(initial, ["my-calendar-month"])).includes(label))
      root = initial;
    else {
      const url = safeURL(navigation.attrs["data-href"], base);
      url.searchParams.set("month", String(m));
      url.searchParams.set("yr", String(year));
      url.searchParams.set("time", "month");
      url.searchParams.delete("dy");
      root = parseHTML(await get(url.toString()));
      if (!text(field(root, ["my-calendar-month"])).includes(label))
        throw new Error("SPRINT did not return the requested calendar month.");
    }
    for (const article of all(
      root,
      (n) => n.tag === "article" && has(n, "calendar-event"),
    )) {
      counts.fetched++;
      const button = first(article, (n) => n.attrs?.["data-modal-title"]);
      const title = h.plain(
        button?.attrs["data-modal-title"] ||
          text(first(article, (n) => n.tag === "h3")).replace(
            /^\d{1,2}:\d{2}\s*[ap]m:\s*/i,
            "",
          ),
        180,
      );
      if (/\bcancelled\b|\bcanceled\b/i.test(title)) {
        counts.excluded++;
        continue;
      }
      const times = all(
        article,
        (n) =>
          n.tag === "time" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(n.attrs.datetime || ""),
      );
      // The publisher's HTML has a malformed offset (e.g. -14400:00).
      // Use its explicitly displayed venue-local wall time with Toronto DST.
      const startsAt =
        times[0] && h.localToISO(times[0].attrs.datetime.slice(0, 19));
      const endsAt =
        times[1] && h.localToISO(times[1].attrs.datetime.slice(0, 19));
      if (!startsAt || !endsAt || endsAt <= startsAt) {
        counts.unverified++;
        continue;
      }
      if (
        Date.parse(endsAt) <= h.window.start ||
        Date.parse(startsAt) >= h.window.end
      ) {
        counts.outsideWindow++;
        continue;
      }
      const address = text(field(article, ["street-address"])),
        name = text(field(article, ["location-label"]));
      const locationLink = first(
        article,
        (n) => n.tag === "a" && String(n.attrs.href).includes("/mc-locations/"),
      );
      const detailLink = first(
        article,
        (n) =>
          n.tag === "a" && String(n.attrs.href).includes(SPRINT + "/events/"),
      );
      if (
        !address ||
        !name ||
        !locationLink ||
        !detailLink ||
        has(article, "mc_no-location")
      ) {
        counts.excluded++;
        continue;
      }
      const sourceUrl = safeURL(detailLink.attrs.href, base).toString(),
        venueUrl = safeURL(locationLink.attrs.href, base).toString();
      if (
        !new URL(sourceUrl).pathname.startsWith("/events/") ||
        !new URL(venueUrl).pathname.startsWith("/mc-locations/")
      ) {
        counts.unverified++;
        continue;
      }
      const rawId = new URL(sourceUrl).searchParams.get("mc_id");
      if (!rawId) {
        counts.unverified++;
        continue;
      }
      const identity = [title, startsAt, endsAt, venueUrl].join("|");
      if (seen.has(rawId)) {
        if (seen.get(rawId) !== identity)
          throw new Error("SPRINT calendar changed while reading its months.");
        counts.duplicates++;
        continue;
      }
      seen.set(rawId, identity);
      const description = h.plain(text(field(article, ["longdesc"])), 1800);
      candidates.push({
        title,
        startsAt,
        endsAt,
        address,
        name,
        sourceUrl,
        venueUrl,
        rawId,
        description,
      });
    }
  }
  const byAddress = await sprintCoordinates(candidates, h, get, counts);
  for (const event of candidates) {
    const point = byAddress.get(
      event.venueUrl + "|" + addressKey(event.address, h.normalized),
    );
    if (!point) {
      counts.unverified++;
      continue;
    }
    const venue = {
      id: "sprint-" + h.key(event.venueUrl),
      venueName: event.name,
      location: point.location,
      latitude: point.latitude,
      longitude: point.longitude,
    };
    h.addSession(
      venues,
      venue,
      h.session(
        source,
        event.rawId,
        event.title,
        event.startsAt,
        event.endsAt,
        {
          seriesId:
            "sprint-" + h.key(event.venueUrl + "|" + h.normalized(event.title)),
          description:
            event.description +
            "\nMap position: " +
            point.coordinateSource +
            ". Confirm the published venue address before travelling.",
          sourceUrl: event.sourceUrl,
          interests: [
            ...new Set([
              ...h.interestsFor(event.title, event.description),
              ...(/\bexercise|exercises|cardio|strength|mobility|balance\b/i.test(
                event.title + " " + event.description,
              )
                ? ["Fitness/exercise"]
                : []),
              ...(/\bsocial|conversation|gathering\b/i.test(event.title)
                ? ["Conversation/social meetups"]
                : []),
              ...(/\brecipes?|cooking\b/i.test(event.title) ? ["Cooking"] : []),
            ]),
          ],
          availability:
            "Contact SPRINT to register and confirm eligibility and availability.",
          cost: "Check organizer",
          room: "",
        },
      ),
      h.window,
      counts,
    );
  }
  if (candidates.length && !venues.size)
    throw new Error("No SPRINT venue coordinates could be verified.");
  return h.finish(source, venues, counts);
}

function parseICalendar(input, localToISO) {
  if (
    !/BEGIN:VCALENDAR/.test(input) ||
    !/VERSION:2\.0/.test(input) ||
    !/END:VCALENDAR/.test(input)
  )
    throw new Error("Library calendar export is incomplete.");
  const lines = input.replace(/\r?\n[ \t]/g, "").split(/\r?\n/),
    events = [];
  let current = null,
    nested = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      if (current) throw new Error("Nested calendar events are unsupported.");
      current = {};
      nested = 0;
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) throw new Error("Calendar event ended unexpectedly.");
      events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (line.startsWith("END:")) {
      nested--;
      continue;
    }
    if (nested) continue;
    const split = line.indexOf(":");
    if (split < 0) continue;
    const head = line.slice(0, split),
      key = head.split(";")[0].toUpperCase();
    if (
      [
        "UID",
        "SUMMARY",
        "DTSTART",
        "DTEND",
        "LOCATION",
        "DESCRIPTION",
        "STATUS",
        "RRULE",
        "RDATE",
        "EXDATE",
        "RECURRENCE-ID",
      ].includes(key)
    ) {
      if (current[key])
        throw new Error("Repeated calendar property requires verification.");
      current[key] = {
        head,
        value: line
          .slice(split + 1)
          .replace(/\\([nN,;\\])/g, (_m, c) => (/[nN]/.test(c) ? "\n" : c)),
      };
    }
  }
  if (current)
    throw new Error("Library calendar export ended before its last event.");
  function date(property) {
    if (!property || /VALUE=DATE(?:;|$)/i.test(property.head)) return null;
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(
      property.value,
    );
    if (!match) return null;
    const zone =
      /TZID="?([^;" ]+)/i.exec(property.head)?.[1] || "America/Toronto";
    return localToISO(
      match[1] +
        "-" +
        match[2] +
        "-" +
        match[3] +
        "T" +
        match[4] +
        ":" +
        match[5] +
        ":" +
        (match[6] || "00") +
        (match[7] || ""),
      zone,
    );
  }
  return events.map((event) => ({
    uid: event.UID?.value,
    title: decodeHTML(event.SUMMARY?.value || ""),
    location: decodeHTML(event.LOCATION?.value || ""),
    description: decodeHTML(event.DESCRIPTION?.value || ""),
    startsAt: date(event.DTSTART),
    endsAt: date(event.DTEND),
    cancelled: /^CANCELLED$/i.test(event.STATUS?.value || ""),
    unsupportedRecurrence: Boolean(
      event.RRULE || event.RDATE || event.EXDATE || event["RECURRENCE-ID"],
    ),
  }));
}
function libraryDateFromListing(value) {
  const months = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
  };
  const m =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/.exec(
      value,
    );
  return m
    ? m[3] +
        "-" +
        String(months[m[1]]).padStart(2, "0") +
        "-" +
        m[2].padStart(2, "0")
    : null;
}
function displayedLibrarySessions(root, localToISO, branchName) {
  const schedule = first(root, (n) => n.tag === "ul" && n.attrs.id === "dates");
  const items = schedule ? all(schedule, (n) => n.tag === "li") : [];
  const card = first(root, (n) => has(n, "card-date"));
  const entries = items.length ? items : card ? [card] : [];
  const results = [];
  for (const entry of entries) {
    const value = text(entry);
    // Read listed occurrences only; never expand a weekly/monthly date range.
    const dates = [
      ...value.matchAll(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/g,
      ),
    ];
    const clock = /\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i.exec(value);
    const duration = /\b(\d+)\s*(?:minutes?|mins?)\.?\b/i.exec(value);
    if (
      dates.length !== 1 ||
      !clock ||
      !duration ||
      +clock[1] < 1 ||
      +clock[1] > 12 ||
      +clock[2] > 59 ||
      +duration[1] < 1 ||
      +duration[1] > 1440
    )
      return null;
    const date = libraryDateFromListing(value);
    const hour = (+clock[1] % 12) + (/pm/i.test(clock[3]) ? 12 : 0);
    const startsAt = localToISO(
      date + "T" + String(hour).padStart(2, "0") + ":" + clock[2] + ":00",
    );
    if (!startsAt) return null;
    const endsAt = new Date(
      Date.parse(startsAt) + +duration[1] * 60000,
    ).toISOString();
    const lines = (entry.children || [])
      .map((n) => (n.tag === "br" ? "\n" : text(n)))
      .join("")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const room =
      items.length && lines.length >= 3
        ? lines.slice(1, -1).join(" ")
        : text(field(root, ["event-room"]));
    results.push({
      startsAt,
      endsAt,
      location: branchName + (room ? " at " + room : ""),
      cancelled: false,
      unsupportedRecurrence: false,
    });
  }
  return results.length ? results : null;
}

async function ottawaBranch(url, get, h) {
  const html = await get(url),
    root = parseHTML(html),
    name = text(first(root, (n) => n.tag === "h1" && has(n, "page-title")));
  const settings = jsonScripts(html);
  // Old /node links can redirect to a replacement branch node (e.g. Carp).
  // Match the branch page's own map, never a nearby-branches map or stale URL ID.
  const pageIds = new Set();
  for (const data of settings)
    walkJSON(data, (item) => {
      const id = /^leaflet-map-node-branch-(\d+)-field-geofield(?:-|$)/.exec(
        item.mapid || "",
      );
      if (id) pageIds.add(id[1]);
    });
  if (pageIds.size > 1) return null;
  const expected =
    [...pageIds][0] || /\/node\/(\d+)/.exec(new URL(url).pathname)?.[1];
  const points = [];
  for (const data of settings)
    walkJSON(data, (item) => {
      if (
        item.type === "point" &&
        Number.isFinite(item.lat) &&
        Number.isFinite(item.lon) &&
        (!expected || String(item.entity_id) === expected)
      )
        points.push(item);
    });
  const unique = new Map(
    points.map((p) => [p.lat.toFixed(6) + "," + p.lon.toFixed(6), p]),
  );
  if (unique.size !== 1) return null;
  const point = [...unique.values()][0];
  if (
    point.lat < 44.8 ||
    point.lat > 45.8 ||
    point.lon < -76.6 ||
    point.lon > -74.9
  )
    return null;
  const address = field(root, ["field--type-address"]),
    line = text(field(address, ["address-line1"]));
  const city = text(field(address, ["locality"])),
    province = text(field(address, ["administrative-area"])),
    postal = text(field(address, ["postal-code"]));
  if (!line || !city || province !== "ON" || !name) return null;
  return {
    id: "ottawa-branch-" + h.key(url),
    venueName: name + " Library",
    branchName: name,
    location: [line, city, province + " " + postal].join(", "),
    latitude: point.lat,
    longitude: point.lon,
  };
}
async function ottawaLibrary(source, h, get) {
  const initial = parseHTML(await get(OTTAWA + "/en"));
  const ageSelect = first(
    initial,
    (n) => n.tag === "select" && n.attrs.name === "field_age_group_target_id",
  );
  const ages = all(
    ageSelect,
    (n) => n.tag === "option" && /^(adult|adults 50.plus)$/i.test(text(n)),
  );
  if (ages.length < 2)
    throw new Error("Ottawa Library audience filters changed.");
  const links = new Map(),
    counts = stats(),
    venues = new Map();
  for (const age of ages) {
    let url = new URL("/en", OTTAWA);
    url.searchParams.set("field_age_group_target_id", age.attrs.value);
    const visited = new Set();
    for (let page = 0; ; page++) {
      if (page >= 60 || visited.has(url.toString()))
        throw new Error("Ottawa Library pagination did not finish.");
      visited.add(url.toString());
      const root = parseHTML(await get(url.toString()));
      if (
        !first(
          root,
          (n) =>
            n.tag === "select" && n.attrs.name === "field_age_group_target_id",
        )
      )
        throw new Error("Ottawa Library returned an unexpected listing page.");
      for (const card of all(root, (n) => has(n, "node-event"))) {
        counts.fetched++;
        const link = first(
          card,
          (n) => n.tag === "a" && String(n.attrs.href).startsWith("/en/event/"),
        );
        const date = libraryDateFromListing(
          text(field(card, ["search-result-date"])),
        );
        if (date && date >= h.window.endDate) {
          counts.outsideWindow++;
          continue;
        }
        if (link) {
          const detail = safeURL(link.attrs.href, OTTAWA);
          links.set(detail.toString(), true);
        }
      }
      if (links.size > 800)
        throw new Error(
          "Ottawa Library calendar exceeded its event import limit.",
        );
      const nextItem = first(
        root,
        (n) => has(n, "pager-next") || has(n, "pager__item--next"),
      );
      const next =
        nextItem && first(nextItem, (n) => n.tag === "a" && n.attrs.href);
      if (!next) break;
      const target = safeURL(next.attrs.href, url);
      if (
        target.hostname !== new URL(OTTAWA).hostname ||
        !["/en", "/en/", "/en/program", "/en/program/"].includes(
          target.pathname,
        )
      )
        throw new Error("Ottawa Library next-page link changed.");
      // The publisher still emits the retired /en/program alias, whose 301
      // drops all query parameters. Use its current /en listing with the exact
      // published filter/page query preserved.
      if (target.pathname.replace(/\/$/, "") === "/en/program")
        target.pathname = "/en";
      url = target;
    }
  }
  const branches = new Map(),
    seen = new Set();
  async function branch(url) {
    if (!branches.has(url)) branches.set(url, ottawaBranch(url, get, h));
    return branches.get(url);
  }
  const results = await pool([...links.keys()], 3, async (url) => {
    const root = parseHTML(await get(url));
    const ageField = field(root, [
      "field-name-field-age-group",
      "field--name-field-age-group",
    ]);
    if (!ageField)
      throw new Error(
        "Ottawa Library audience fields changed; saved listings retained.",
      );
    const age = text(ageField);
    if (!/\badult/i.test(age)) return { excluded: true };
    const branchField = field(root, [
      "field-name-field-event-branch",
      "field--name-field-event-branch",
    ]);
    const branchLink = first(
      branchField,
      (n) =>
        n.tag === "a" &&
        String(n.attrs.href).startsWith(
          "https://about.biblioottawalibrary.ca/",
        ),
    );
    const calendar = first(
      root,
      (n) =>
        n.tag === "a" &&
        /\/en\/node\/\d+\/opl_new_add_to_calendar\.ics(?:\?|$)/.test(
          n.attrs.href || "",
        ),
    );
    if (!branchLink) return { unverified: true, reason: "missingBranch", url };
    const branchLabel = text(branchLink);
    if (/^(?:online|virtual|zoom)\b/i.test(branchLabel))
      return { excluded: true };
    if (/^other locations?$/i.test(branchLabel))
      return { unverified: true, reason: "otherLocation", url };
    const venue = await branch(safeURL(branchLink.attrs.href).toString());
    if (!venue) return { unverified: true, reason: "branchCoordinates", url };
    let events = displayedLibrarySessions(root, h.localToISO, venue.branchName);
    let nodeId = url;
    if (!events && calendar) {
      const exportURL = safeURL(calendar.attrs.href, OTTAWA).toString();
      events = parseICalendar(
        await get(exportURL, "ics", 2000000),
        h.localToISO,
      );
      nodeId = /\/node\/(\d+)\//.exec(exportURL)[1];
    }
    if (!events) return { unverified: true, reason: "dates", url };
    const headings = all(root, (n) => n.tag === "h1");
    const titleField =
      field(root, ["field-name-title-field", "field--name-title"]) ||
      first(root, (n) => n.tag === "h1" && has(n, "page-title")) ||
      (headings.length === 1 ? headings[0] : null);
    if (!titleField)
      throw new Error(
        "Ottawa Library title fields changed; saved listings retained.",
      );
    const title = h.plain(text(titleField), 180);
    if (/\bcancelled\b|\bcanceled\b/i.test(title)) return { excluded: true };
    const description = h.plain(
      text(field(root, ["field-name-body", "field--name-body"])),
      1800,
    );
    const subjects = text(
      field(root, ["field-name-field-category", "field--name-field-category"]),
    );
    const registration = text(
      field(root, [
        "pane-node-field-registration-required",
        "field-name-field-registration-required",
      ]),
    );
    const body = text(root);
    const availability = /Sorry this event is full/i.test(body)
      ? "Full — check Ottawa Public Library"
      : /Log in to register|Registration required/i.test(
            registration + " " + body,
          )
        ? "Registration required with Ottawa Public Library."
        : "Drop-in — check organizer for attendance details.";
    return {
      events,
      venue,
      title,
      description,
      subjects,
      availability,
      url,
      nodeId,
    };
  });
  for (const result of results) {
    if (result.excluded) {
      counts.excluded++;
      continue;
    }
    if (result.unverified) {
      counts.unverified++;
      counts.unverifiedReasons ||= {};
      const reason = result.reason || "unknown";
      counts.unverifiedReasons[reason] =
        (counts.unverifiedReasons[reason] || 0) + 1;
      counts.unverifiedSamples ||= [];
      if (counts.unverifiedSamples.length < 5)
        counts.unverifiedSamples.push({ reason, url: result.url });
      continue;
    }
    for (const event of result.events) {
      if (
        event.cancelled ||
        /\bonline\b|\bzoom\b|\bvirtual\b/i.test(event.location)
      ) {
        counts.excluded++;
        continue;
      }
      if (
        event.unsupportedRecurrence ||
        !event.startsAt ||
        !event.endsAt ||
        event.endsAt <= event.startsAt
      ) {
        counts.unverified++;
        continue;
      }
      const location = h.normalized(event.location),
        name = h.normalized(result.venue.branchName);
      if (!location.startsWith(name)) {
        counts.unverified++;
        continue;
      }
      const rawId = result.nodeId + "|" + event.startsAt + "|" + event.endsAt;
      if (seen.has(rawId)) {
        counts.duplicates++;
        continue;
      }
      seen.add(rawId);
      const interests = new Set(
        h.interestsFor(
          result.title,
          result.description + " " + result.subjects,
        ),
      );
      if (/colour|coloring|doodl|zentangle/i.test(result.title))
        interests.add("Painting/drawing");
      h.addSession(
        venues,
        result.venue,
        h.session(
          source,
          rawId,
          result.title || event.title,
          event.startsAt,
          event.endsAt,
          {
            seriesId: "ottawa-" + h.key(result.nodeId + "|" + result.venue.id),
            sourceUrl: result.url,
            description:
              (result.description || h.plain(event.description, 1800)) +
              "\nVenue location: Ottawa Public Library.",
            interests: [...interests],
            availability: result.availability,
            cost: "Check organizer",
            room: event.location
              .split(/\s+at\s+/i)
              .slice(1)
              .join(" at "),
          },
        ),
        h.window,
        counts,
      );
    }
  }
  if (links.size && !venues.size && results.some((result) => result.unverified))
    throw new Error(
      "Ottawa Library dates or venue coordinates could not be verified; saved listings retained.",
    );
  return h.finish(source, venues, counts);
}
async function collectAdditionalSource(source, helpers) {
  const get = runReader(helpers.fetchImpl, helpers.readerOptions);
  if (source.type.startsWith("ontario-"))
    return collectOntarioSource(source, helpers, get, {
      parseHTML,
      all,
      first,
      has,
      text,
    });
  if (source.type === "toronto-recreation")
    return torontoRecreation(source, helpers, get);
  if (source.type === "sprint") return sprintCalendar(source, helpers, get);
  if (source.type === "ottawa-library")
    return ottawaLibrary(source, helpers, get);
  throw new Error("Unknown public-calendar adapter.");
}
module.exports = {
  EXTRA_SOURCES,
  runReader,
  cityTable,
  cityAddressLookup,
  sprintCoordinates,
  collectAdditionalSource,
  parseICalendar,
  parseHTML,
  all,
  first,
  has,
  text,
  cityTime,
  pointOf,
  displayedLibrarySessions,
};