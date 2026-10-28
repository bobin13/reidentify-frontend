// Published public calendars only. Never substitute a city's centre for a venue.
const { decodeHTML } = require("entities");
const COMMUNITY_SOURCES = require("./ontario-community-sources.json");

const ONTARIO_SOURCES = [
  ...[
    ["markham", "Markham Public Library", "Markham"],
    ["rhpl", "Richmond Hill Public Library", "Richmond Hill"],
    ["oshlib", "Oshawa Public Libraries", "Oshawa"],
    ["aurora", "Aurora Public Library", "Aurora"],
    ["woodstock", "Woodstock Public Library", "Woodstock"],
  ].map(([host, name, area]) => ({
    id: "ontario-library-" + host,
    name,
    area,
    type: "ontario-biblioevents",
    url: "https://" + host + ".bibliocommons.com/v2/events",
    importRevision: 1,
    municipalities: [area],
  })),
  {
    id: "ontario-historical-society",
    name: "Ontario Historical Society community calendar",
    area: "Ontario",
    type: "ontario-tribe",
    url: "https://ontariohistoricalsociety.ca/wp-json/tribe/events/v1/events",
    importRevision: 1,
    municipalities: [],
    scope: "provincewide",
  },
  {
    id: "ontario-sudbury-library",
    name: "Greater Sudbury Public Library",
    area: "Greater Sudbury",
    type: "ontario-sudbury",
    url: "https://www.sudburylibraries.ca/events-calendar",
    importRevision: 1,
    municipalities: ["Greater Sudbury"],
  },
  {
    id: "ontario-london-library",
    name: "London Public Library",
    area: "London",
    type: "ontario-london",
    url: "https://www.lpl.ca/whats-on",
    importRevision: 1,
    municipalities: ["London"],
  },
  {
    id: "ontario-northbay-library",
    name: "North Bay Public Library",
    area: "North Bay",
    type: "ontario-librarymarket",
    url: "https://northbaypl.librarycalendar.com/events/upcoming",
    importRevision: 1,
    municipalities: ["North Bay"],
  },
  ...COMMUNITY_SOURCES,
];

function publicText(value, h, maximum = 1800) {
  return h.plain(decodeHTML(String(value || "")), maximum);
}
function counters() {
  return {
    excluded: 0,
    duplicates: 0,
    unverified: 0,
    outsideWindow: 0,
    missingTime: 0,
    missingLocation: 0,
    pages: 0,
    cities: {},
    heldLocations: [],
  };
}
function heldLocation(counts, address) {
  counts.unverified++;
  counts.missingLocation++;
  const value =
    typeof address === "string"
      ? address
      : [address.street, address.city].filter(Boolean).join(", ");
  if (
    value &&
    !counts.heldLocations.includes(value) &&
    counts.heldLocations.length < 12
  )
    counts.heldLocations.push(value);
}
const NOT_ACTIVITY =
  /\b(?:council|committee meeting|board meeting|office[s]? closed|town hall closed|municipal election|voting|landfill|garbage collection|(?:yard )?waste collection|tax due|utility payments due|public hearing|market square lighting|flag raising)\b/i;
const CHILD_ONLY =
  /\bearlyon\b|\btoddlers?\b|\bpreschool\b|\bbaby storytime\b|\bfor (?:kids|children|teens)\b|\bkids[’']? safe halloween\b/i;
function point(latitude, longitude) {
  if (
    latitude === null ||
    longitude === null ||
    latitude === "" ||
    longitude === ""
  )
    return null;
  const lat = Number(latitude),
    lng = Number(longitude);
  // Ontario's enclosing extent. Publisher province/country must ALSO agree.
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 41.6 &&
    lat <= 57.1 &&
    lng >= -95.3 &&
    lng <= -74.2
    ? { latitude: lat, longitude: lng }
    : null;
}
function addressText(address, h) {
  if (!address || typeof address !== "object") return "";
  const street = [address.number, address.street || address.streetAddress]
    .filter(Boolean)
    .join(" ");
  return [
    street,
    address.city || address.addressLocality,
    address.state || address.addressRegion || "Ontario",
    address.zip || address.postalCode,
  ]
    .filter(Boolean)
    .map((v) => publicText(v, h, 180))
    .join(", ");
}
function isOntario(address) {
  if (!address || typeof address !== "object") return false;
  const region = String(
    address.state || address.addressRegion || address.province || "",
  ).trim();
  const country = String(
    address.country || address.addressCountry || "CA",
  ).trim();
  const postal = String(address.zip || address.postalCode || "").replace(
    /\s/g,
    "",
  );
  const otherProvince =
    /^(?:QC|Quebec|Québec|MB|Manitoba|AB|Alberta|BC|British Columbia|SK|Saskatchewan|NB|NS|NL|PE|YT|NT|NU)$/i.test(
      region,
    );
  return (
    /^(CA|CAN|Canada)$/i.test(country) &&
    !otherProvince &&
    (/^(ON|Ontario)$/i.test(region) ||
      /^[KLMNP]\d[A-Z]\d[A-Z]\d$/i.test(postal))
  );
}
function validTimes(start, end) {
  return (
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    Date.parse(end) > Date.parse(start)
  );
}
function inWindow(start, end, h) {
  return Date.parse(end) > h.window.start && Date.parse(start) < h.window.end;
}
function itemCounts(counts, venues) {
  counts.cities = {};
  for (const venue of venues.values()) {
    if (venue.sessions.length && venue.city)
      counts.cities[venue.city] = (counts.cities[venue.city] || 0) + 1;
  }
}
const coordinateMemo = new Map();
let coordinateReaders = 0;
const coordinateQueue = [];
async function readCoordinate(get, url) {
  if (coordinateReaders >= 2)
    await new Promise((resolve) => coordinateQueue.push(resolve));
  else coordinateReaders++;
  try {
    return await get(url, "json", 1000000);
  } finally {
    const next = coordinateQueue.shift();
    if (next) next();
    else coordinateReaders--;
  }
}
function streetKey(value, h) {
  const short = {
    street: "st",
    road: "rd",
    avenue: "ave",
    boulevard: "blvd",
    drive: "dr",
    lane: "ln",
    court: "ct",
    crescent: "cres",
    highway: "hwy",
    east: "e",
    west: "w",
    north: "n",
    south: "s",
  };
  return h
    .normalized(value)
    .split(" ")
    .map((x) => short[x] || x)
    .join(" ");
}
function cityKey(value, h) {
  return h
    .normalized(value)
    .replace(/\b(?:city|town|township|municipality|village|of|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function coordinateFor(source, address, h, get) {
  if (
    !isOntario(address) ||
    !address.street ||
    !address.city ||
    !/^\d+[a-z]?\b/i.test(address.street.trim())
  )
    return null;
  const street = streetKey(address.street, h),
    city = cityKey(address.city, h);
  const signature = street + "|" + city;
  const id = "ontario-address-" + h.key(signature);
  const memo = coordinateMemo.get(id);
  if (memo && memo.expiresAt > Date.now()) return memo.promise;
  const pending = (async () => {
    const saved = await h.venueCoordinates?.get(id);
    if (
      saved?.signature === signature &&
      Date.now() - Date.parse(saved.verifiedAt) < 90 * 86400000 &&
      point(saved.latitude, saved.longitude)
    )
      return {
        latitude: saved.latitude,
        longitude: saved.longitude,
        coordinateSource: saved.coordinateSource,
        coordinateUrl: saved.coordinateUrl,
      };
    const cities = [address.city, ...(source.municipalities || [])]
      .map((x) => cityKey(x, h))
      .filter(Boolean);
    const localities = [address.city, ...(source.municipalities || [])]
      .filter(
        (x, i, a) => a.findIndex((y) => cityKey(y, h) === cityKey(x, h)) === i,
      )
      .slice(0, 3);
    for (const locality of localities) {
      const url = new URL(
        "https://www.geolocator.api.geo.ca/geolocation/en/locate",
      );
      url.searchParams.set("q", address.street + ", " + locality + ", Ontario");
      const matches = await readCoordinate(get, url.toString());
      if (!Array.isArray(matches))
        throw new Error("Canadian address lookup changed format.");
      const qualified = matches.filter((v) => {
        if (
          !/\.Street$/.test(v.type || "") ||
          !/^(INTERPOLATED_POSITION|POSITION)$/.test(v.qualifier || "") ||
          v.geometry?.type !== "Point"
        )
          return false;
        const title = streetKey(v.title, h),
          titleCity = cityKey(v.title, h);
        return (
          title.startsWith(street + " ") &&
          /\bontario\b/.test(title) &&
          cities.some((c) => (" " + titleCity + " ").includes(" " + c + " ")) &&
          point(v.geometry.coordinates?.[1], v.geometry.coordinates?.[0])
        );
      });
      const unique = new Map(
        qualified.map((v) => [v.geometry.coordinates.join(","), v]),
      );
      if (unique.size > 1) return null;
      if (!unique.size) continue;
      const match = [...unique.values()][0],
        coordinate = point(
          match.geometry.coordinates[1],
          match.geometry.coordinates[0],
        );
      const result = {
        ...coordinate,
        coordinateSource: "Natural Resources Canada street-address estimate",
        coordinateUrl: url.toString(),
      };
      await h.venueCoordinates?.set(id, {
        ...result,
        signature,
        address: addressText(address, h),
        verifiedAt: new Date().toISOString(),
      });
      return result;
    }
    return null;
  })();
  if (coordinateMemo.size > 4000) coordinateMemo.clear();
  coordinateMemo.set(id, {
    expiresAt: Date.now() + 30 * 60000,
    promise: pending,
  });
  try {
    const result = await pending;
    if (result)
      coordinateMemo.set(id, {
        expiresAt: Date.now() + 6 * 3600000,
        promise: Promise.resolve(result),
      });
    return result;
  } catch (error) {
    coordinateMemo.delete(id);
    throw error;
  }
}
function parseBiblioPage(html) {
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      !/\btype\s*=\s*["']application\/json["']/i.test(match[1]) ||
      !/\bdata-iso-key\s*=/i.test(match[1])
    )
      continue;
    const state = JSON.parse(match[2]);
    const search = state.events?.eventsSearch;
    if (
      search &&
      search.pagination &&
      Array.isArray(search.results) &&
      state.entities?.events &&
      state.entities?.locations
    ) {
      const p = search.pagination;
      if (
        !Number.isInteger(p.page) ||
        p.page < 1 ||
        !Number.isInteger(p.pages) ||
        p.pages < 0 ||
        !Number.isInteger(p.count) ||
        p.count < 0 ||
        !Number.isInteger(p.limit) ||
        p.limit < 1
      ) {
        throw new Error(
          "Library pagination format changed; saved listings retained.",
        );
      }
      return { search, entities: state.entities };
    }
  }
  throw new Error(
    "This library did not return a supported public event calendar.",
  );
}

const ADULT_AUDIENCE =
  /\badults?\b|senior|older|all ages|everyone|tout public|tous les|adultes?|a[îi]n[ée]/i;
function adultAudience(name) {
  const range = /\b\d+\s*[-–]\s*(\d+)\b/.exec(name || "");
  return (
    ADULT_AUDIENCE.test(name || "") &&
    !/young(?:er)? adults?|jeunes adultes/i.test(name || "") &&
    !(range && Number(range[1]) < 55)
  );
}
function adultAudienceIds(entities) {
  return Object.entries(entities.eventAudiences || {})
    .filter(([, value]) => adultAudience(value.name))
    .map(([id]) => id);
}
function publicEventURL(source, id) {
  const url = new URL(source.url);
  url.pathname = "/v2/events/" + encodeURIComponent(id);
  url.search = "";
  return url.toString();
}
async function collectBiblio(source, h, get) {
  const initial = parseBiblioPage(await get(source.url, "html", 3000000));
  const audienceIds = adultAudienceIds(initial.entities);
  if (!audienceIds.length)
    throw new Error("Adult/all-age audience categories could not be verified.");
  const base = new URL(source.url);
  base.search = new URLSearchParams({
    startDate: h.window.startDate,
    endDate: h.window.endDate,
    audiences: audienceIds.join(","),
    page: "1",
  }).toString();
  let current = parseBiblioPage(await get(base.toString(), "html", 3000000));
  const counts = counters(),
    venues = new Map(),
    seen = new Set();
  const firstTotal = current.search.pagination.count;
  // A failed page aborts the source snapshot, preserving the last complete run.
  for (let page = 1; ; page++) {
    if (page > 500)
      throw new Error("Library pagination exceeded the import safety budget.");
    if (page > 1) {
      base.searchParams.set("page", String(page));
      current = parseBiblioPage(await get(base.toString(), "html", 3000000));
    }
    const { entities, search } = current,
      pagination = search.pagination;
    counts.pages++;
    if (pagination.page !== page || pagination.count !== firstTotal)
      throw new Error(
        "Library calendar changed during pagination; retrying later.",
      );
    let newIds = 0;
    for (const id of search.results) {
      if (seen.has(id)) {
        counts.duplicates++;
        continue;
      }
      newIds++;
      seen.add(id);
      const event = entities.events[id],
        d = event?.definition;
      if (!d) throw new Error("Library result is missing its event record.");
      const audiences = (d.audienceIds || []).map(
        (x) => entities.eventAudiences?.[x]?.name || "",
      );
      if (d.isCancelled || !audiences.some(adultAudience)) {
        counts.excluded++;
        continue;
      }
      const location =
        entities.locations[d.branchLocationId || d.nonBranchLocationId];
      if (
        !location ||
        /virtual|online|en ligne/i.test(location.name || "") ||
        !isOntario(location.address)
      ) {
        counts.excluded++;
        continue;
      }
      const zone = location.mapLocation?.timeZone;
      if (!zone) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      const start = h.localToISO(d.start, zone),
        end = h.localToISO(d.end, zone);
      if (!validTimes(start, end)) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      if (!inWindow(start, end, h)) {
        counts.outsideWindow++;
        continue;
      }
      // Check normalized index times against the publisher's venue-local times.
      if (
        (event.indexStart &&
          Date.parse(event.indexStart) !== Date.parse(start)) ||
        (event.indexEnd && Date.parse(event.indexEnd) !== Date.parse(end))
      ) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      const geo = location.mapLocation?.centrePoint,
        coordinate = geo && point(geo.lat, geo.lng);
      const address = addressText(location.address, h);
      if (
        !coordinate ||
        !address ||
        !location.address.city ||
        !(location.address.street || location.address.streetAddress)
      ) {
        counts.unverified++;
        counts.missingLocation++;
        continue;
      }
      const venueId = h.key(
        source.id +
          "|" +
          (location.id || d.branchLocationId || d.nonBranchLocationId) +
          "|" +
          address,
      );
      const types = (d.typeIds || []).map(
        (x) => entities.eventTypes?.[x]?.name || "",
      );
      h.addSession(
        venues,
        {
          id: venueId,
          venueName: publicText(location.name, h, 180),
          location: address,
          city: publicText(location.address.city, h, 120),
          ...coordinate,
        },
        h.session(source, id, publicText(d.title, h, 180), start, end, {
          seriesId: source.id + "-" + (event.seriesId || id),
          description: publicText(d.description, h),
          interests: h.interestsFor(publicText(d.title, h), types.join(" ")),
          sourceUrl: publicEventURL(source, id),
          timeZone: zone,
        }),
        h.window,
        counts,
      );
    }
    if (search.results.length && !newIds)
      throw new Error(
        "Library repeated a result page; saved listings retained.",
      );
    if (page >= pagination.pages) break;
    if (!search.results.length)
      throw new Error("Library calendar pagination ended early.");
  }
  if (counts.unverified && !venues.size && firstTotal)
    throw new Error(
      "Library returned activities, but no times and physical locations could be verified.",
    );
  itemCounts(counts, venues);
  return h.finish(source, venues, counts);
}

async function collectTribe(source, h, get) {
  const venues = new Map(),
    counts = counters(),
    seen = new Set();
  const base = new URL(source.url);
  base.search = new URLSearchParams({
    start_date: h.window.startDate,
    end_date: h.window.endDate,
    per_page: "50",
    page: "1",
  }).toString();
  let total = null;
  for (let page = 1; ; page++) {
    if (page > 100)
      throw new Error("Community calendar exceeded the page safety budget.");
    base.searchParams.set("page", String(page));
    const data = await get(base.toString(), "json", 3000000);
    if (
      !Array.isArray(data.events) ||
      !Number.isInteger(data.total) ||
      !Number.isInteger(data.total_pages)
    )
      throw new Error(
        "Community calendar API changed; saved listings retained.",
      );
    if (total !== null && total !== data.total)
      throw new Error("Community calendar changed during pagination.");
    total = data.total;
    counts.pages++;
    let newIds = 0;
    for (const event of data.events) {
      const identity =
        String(event.id) + "|" + event.start_date + "|" + event.end_date;
      if (seen.has(identity)) {
        counts.duplicates++;
        continue;
      }
      seen.add(identity);
      newIds++;
      const v = event.venue || {};
      const region = v.stateprovince || v.state || v.province;
      if (!event.id || !event.title)
        throw new Error(
          "Community calendar returned an incomplete event record.",
        );
      const name = publicText(event.title, h, 180);
      if (
        event.all_day ||
        (event.status && event.status !== "publish") ||
        /cancelled|canceled/i.test(
          String(event.event_status || "") + " " + name,
        ) ||
        NOT_ACTIVITY.test(name) ||
        CHILD_ONLY.test(name) ||
        /virtual|online|en ligne/i.test(v.venue || "") ||
        !isOntario({ province: region, country: v.country, zip: v.zip })
      ) {
        counts.excluded++;
        continue;
      }
      const { start, end, timeZone } = tribeTimes(event, h);
      if (!validTimes(start, end)) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      // A 13-hour fitness class or week-long appointment is not a verified
      // session. Keep plausible long public festivals, but never invent an end.
      if (
        Date.parse(end) - Date.parse(start) > 12 * 3600000 &&
        !/festival|fair\b|exhibition|conference|tournament|exhibit|art show|retreat/i.test(
          name,
        )
      ) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      if (!inWindow(start, end, h)) {
        counts.outsideWindow++;
        continue;
      }
      const coordinate =
        point(v.geo_lat, v.geo_lng) ||
        (await coordinateFor(
          source,
          { street: v.address, city: v.city, state: "Ontario", zip: v.zip },
          h,
          get,
        ));
      const address = addressText(
        { street: v.address, city: v.city, state: "Ontario", zip: v.zip },
        h,
      );
      if (!coordinate || !v.address || !v.city) {
        heldLocation(counts, { street: v.address, city: v.city });
        continue;
      }
      const venueId = h.key(
        source.id + "|" + streetKey(v.address, h) + "|" + cityKey(v.city, h),
      );
      h.addSession(
        venues,
        {
          id: venueId,
          venueName: publicText(v.venue, h, 180),
          location: address,
          city: publicText(v.city, h, 120),
          ...coordinate,
        },
        h.session(source, identity, name, start, end, {
          seriesId: source.id + "-" + h.key(h.normalized(name) + "|" + venueId),
          description: publicText(event.description, h),
          interests: h.interestsFor(
            publicText(event.title, h),
            (event.categories || []).map((x) => x.name).join(" "),
          ),
          sourceUrl: String(event.url || ""),
          timeZone,
        }),
        h.window,
        counts,
      );
    }
    if (data.events.length && !newIds)
      throw new Error("Community calendar repeated its page.");
    if (page >= data.total_pages) break;
    if (!data.events.length)
      throw new Error("Community calendar ended before its last page.");
  }
  if (counts.unverified && !venues.size && total)
    throw new Error(
      "No dated community activities with verified physical locations were returned.",
    );
  itemCounts(counts, venues);
  return h.finish(source, venues, counts);
}

// Some publishers label their calendar "UTC-5" even during daylight time.
// Use their explicit UTC values only when they agree with the displayed local
// date/time in an Ontario time zone. Never guess an offset from the server.
function tribeTimes(event, h) {
  const zones = [event.timezone, "America/Toronto", "America/Winnipeg"].filter(
    Boolean,
  );
  const publishedStart =
    event.utc_start_date &&
    h.localToISO(event.utc_start_date.replace(" ", "T") + "Z");
  const publishedEnd =
    event.utc_end_date &&
    h.localToISO(event.utc_end_date.replace(" ", "T") + "Z");
  for (const zone of zones) {
    const start = h.localToISO(event.start_date, zone),
      end = h.localToISO(event.end_date, zone);
    if (!validTimes(start, end)) continue;
    if (
      (publishedStart && start !== publishedStart) ||
      (publishedEnd && end !== publishedEnd)
    )
      continue;
    if (zone !== event.timezone && (!publishedStart || !publishedEnd)) continue;
    return { start, end, timeZone: zone };
  }
  return { start: null, end: null, timeZone: null };
}

function namedClass(root, name, dom) {
  return dom.first(root, (n) => dom.has(n, name));
}
function englishDate(value) {
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const m = /\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/.exec(value || "");
  if (!m || !months[m[1].toLowerCase()]) return null;
  const day = `${m[3]}-${String(months[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const parsed = new Date(day + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().startsWith(day)
    ? day
    : null;
}
function clock(value) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(value.trim());
  if (!m || +m[1] < 1 || +m[1] > 12 || +(m[2] || 0) > 59) return null;
  return `${String((+m[1] % 12) + (m[3].toLowerCase() === "p" ? 12 : 0)).padStart(2, "0")}:${m[2] || "00"}`;
}
function clockRange(date, value, h) {
  const parts = (value || "").split(/\s*[–—-]\s*/);
  if (parts.length !== 2 || !date) return [null, null];
  const a = clock(parts[0]),
    b = clock(parts[1]);
  return [a && h.localToISO(date + "T" + a), b && h.localToISO(date + "T" + b)];
}
async function collectLondon(source, h, get, dom) {
  const { parseHTML, all, first, has, text } = dom,
    counts = counters(),
    venues = new Map(),
    seen = new Set();
  const directory = parseHTML(
    await get(
      "https://www.lpl.ca/using-library/hours-locations",
      "html",
      2500000,
    ),
  );
  counts.pages++;
  const branches = new Map();
  for (const card of all(directory, (n) => has(n, "teaser-card"))) {
    const name = text(first(card, (n) => n.tag === "h2")),
      street = text(namedClass(card, "address-line1", dom)),
      city = text(namedClass(card, "locality", dom));
    if (name && street && city)
      branches.set(h.normalized(name), {
        street,
        city,
        state: text(namedClass(card, "administrative-area", dom)),
        zip: text(namedClass(card, "postal-code", dom)),
        name,
      });
  }
  if (!branches.size)
    throw new Error("London's branch address catalogue changed format.");
  const cards = [];
  for (const audience of ["241", "246"]) {
    const url = new URL(source.url);
    url.search = new URLSearchParams({
      field_audience_target_id: audience,
      field_start_date_value_1: h.window.startDate,
      field_start_date_value_2: h.window.endDate,
    }).toString();
    const visited = new Set();
    let next = url.toString();
    while (next) {
      if (visited.has(next) || visited.size >= 100)
        throw new Error(
          "London calendar pagination repeated or exceeded its budget.",
        );
      visited.add(next);
      const root = parseHTML(await get(next, "html", 2500000));
      counts.pages++;
      const eventCards = all(
        root,
        (n) => n.tag === "a" && has(n, "teaser-card--event"),
      );
      if (
        !eventCards.length &&
        !/no (?:events|results)|no upcoming/i.test(text(root))
      )
        throw new Error(
          "London calendar listings changed format; saved listings retained.",
        );
      for (const card of eventCards) {
        const dates = namedClass(card, "teaser-card__event-date", dom),
          entries = (dates?.children || [])
            .filter((n) => n.tag === "div")
            .map(text);
        const title = text(first(card, (n) => n.tag === "h2")),
          location = text(namedClass(card, "uppercase", dom));
        const eventUrl = new URL(card.attrs.href, next).toString();
        const date = englishDate(entries[0]),
          [start, end] = clockRange(date, entries[1], h);
        if (!validTimes(start, end)) {
          counts.unverified++;
          counts.missingTime++;
          continue;
        }
        if (!inWindow(start, end, h)) {
          counts.outsideWindow++;
          continue;
        }
        const identity = eventUrl + "|" + start;
        if (seen.has(identity)) {
          counts.duplicates++;
          continue;
        }
        seen.add(identity);
        cards.push({ title, location, eventUrl, start, end, identity });
      }
      const nextLink = first(
        root,
        (n) =>
          n.tag === "a" && /(?:^|\s)next(?:\s|$)/i.test(n.attrs?.rel || ""),
      );
      next = nextLink ? new URL(nextLink.attrs.href, next).toString() : null;
      if (next && new URL(next).origin !== url.origin)
        throw new Error("London calendar pagination left the publisher.");
    }
  }
  await mapLimited(cards, 2, async (card) => {
    const address = branches.get(h.normalized(card.location));
    if (/online|virtual|en ligne/i.test(card.location)) {
      counts.excluded++;
      return;
    }
    if (!address) {
      heldLocation(counts, card.location);
      return;
    }
    const coordinate = await coordinateFor(source, address, h, get);
    if (!coordinate) {
      heldLocation(counts, address);
      return;
    }
    const id = h.key(
      source.id +
        "|" +
        streetKey(address.street, h) +
        "|" +
        cityKey(address.city, h),
    );
    h.addSession(
      venues,
      {
        id,
        venueName: address.name,
        location: addressText(address, h),
        city: address.city,
        ...coordinate,
      },
      h.session(source, card.identity, card.title, card.start, card.end, {
        seriesId: source.id + "-" + h.key(h.normalized(card.title) + "|" + id),
        sourceUrl: card.eventUrl,
        description:
          "Adult/older-adult program from London Public Library. Check the organizer's page for registration, availability and current details.",
        interests: h.interestsFor(card.title),
      }),
      h.window,
      counts,
    );
  });
  if (cards.length && !venues.size)
    throw new Error("London's activity venues could not be verified.");
  itemCounts(counts, venues);
  return h.finish(source, venues, counts);
}

async function collectLibraryMarket(source, h, get, dom) {
  const { parseHTML, all, first, has, text } = dom,
    counts = counters(),
    venues = new Map(),
    links = new Set(),
    visited = new Set();
  let next = source.url;
  while (next) {
    if (visited.has(next) || visited.size >= 100)
      throw new Error(
        "Library calendar pagination repeated or exceeded its budget.",
      );
    visited.add(next);
    const root = parseHTML(await get(next, "html", 2500000));
    counts.pages++;
    const cards = all(root, (n) => has(n, "lc-event--upcoming"));
    let futureOnly = cards.length > 0;
    if (!cards.length && !/no (?:events|results)/i.test(text(root)))
      throw new Error(
        "Library calendar listings changed format; saved listings retained.",
      );
    for (const card of cards) {
      const link = first(
        card,
        (n) => n.tag === "a" && has(n, "lc-event__link"),
      );
      if (!link) continue;
      const date = englishDate(link.attrs["aria-label"] || text(card));
      if (!date) {
        counts.unverified++;
        continue;
      }
      if (date < h.window.endDate) futureOnly = false;
      if (date >= h.window.endDate || date < h.window.startDate) continue;
      links.add(new URL(link.attrs.href, next).toString());
    }
    if (futureOnly) break;
    const link = first(
      root,
      (n) =>
        n.tag === "a" &&
        (/(?:^|\s)next(?:\s|$)/i.test(n.attrs.rel || "") ||
          n.attrs.title === "Go to next page"),
    );
    next = link ? new URL(link.attrs.href, next).toString() : null;
    if (next && new URL(next).origin !== new URL(source.url).origin)
      throw new Error("Library pagination left its publisher.");
  }
  await mapLimited([...links], 3, async (url) => {
    const root = parseHTML(await get(url, "html", 1500000));
    counts.pages++;
    const article = first(
      root,
      (n) => n.tag === "article" && has(n, "lc-event"),
    );
    if (!article) throw new Error("Library event detail format changed.");
    if (has(article, "node--type-lc-reservation")) {
      counts.excluded++;
      return;
    }
    const age = text(namedClass(article, "lc-event__age-groups", dom));
    const body = text(article);
    const ageText =
      age ||
      /Age Group:\s*(.*?)\s*(?:Program Type:|Registration|Program Description|Event Details|Please note|Room:)/i.exec(
        body,
      )?.[1] ||
      "";
    if (!adultAudience(ageText)) {
      counts.excluded++;
      return;
    }
    const date = englishDate(
      text(namedClass(article, "lc-event-info-item--date", dom)),
    );
    const [start, end] = clockRange(
      date,
      text(namedClass(article, "lc-event-info-item--time", dom)),
      h,
    );
    if (!validTimes(start, end)) {
      counts.unverified++;
      counts.missingTime++;
      return;
    }
    if (!inWindow(start, end, h)) {
      counts.outsideWindow++;
      return;
    }
    const place = namedClass(article, "lc-event-location-address", dom);
    const line = text(namedClass(place, "lc-address-line--second", dom));
    const cityLine =
      /^(.+?),\s*(ON|Ontario)\s+([A-Z]\d[A-Z]\s*\d[A-Z]\d)$/i.exec(line);
    const street = text(namedClass(place, "lc-address-line--first", dom));
    if (!cityLine || !street) {
      counts.unverified++;
      counts.missingLocation++;
      return;
    }
    const address = {
      street,
      city: cityLine[1],
      state: cityLine[2],
      zip: cityLine[3],
    };
    const coordinate = await coordinateFor(source, address, h, get);
    if (!coordinate) {
      counts.unverified++;
      counts.missingLocation++;
      return;
    }
    const title = text(first(root, (n) => n.tag === "h1"));
    const name = text(first(place, (n) => n.tag === "p")) || source.name,
      id = h.key(
        source.id + "|" + streetKey(street, h) + "|" + cityKey(address.city, h),
      );
    const description =
      text(namedClass(article, "lc-event-description", dom)) ||
      "Public library activity. Check the organizer's page for registration and current availability.";
    h.addSession(
      venues,
      {
        id,
        venueName: name,
        location: addressText(address, h),
        city: address.city,
        ...coordinate,
      },
      h.session(source, url, title, start, end, {
        seriesId: source.id + "-" + h.key(h.normalized(title) + "|" + id),
        description,
        sourceUrl: url,
        interests: h.interestsFor(title, description),
      }),
      h.window,
      counts,
    );
  });
  if (counts.unverified && !venues.size)
    throw new Error(
      "Library returned activities, but no physical venues could be verified.",
    );
  itemCounts(counts, venues);
  return h.finish(source, venues, counts);
}

function compactUTC(value, h) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value || "");
  return m
    ? h.localToISO(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
    : null;
}
async function mapLimited(items, limit, operation) {
  let cursor = 0,
    failure = null;
  const output = new Array(items.length);
  async function worker() {
    for (;;) {
      if (failure) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        output[i] = await operation(items[i], i);
      } catch (error) {
        failure ||= error;
        return;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(items.length, limit) }, worker),
  );
  if (failure) throw failure;
  return output;
}
async function collectSudbury(source, h, get, dom) {
  const { parseHTML, all, text } = dom,
    counts = counters(),
    venues = new Map(),
    links = new Set();
  const firstMonth = new Date(h.window.startDate + "T12:00:00Z"),
    lastMonth = new Date(h.window.endDate + "T12:00:00Z");
  const months = new Set([
    firstMonth.toISOString().slice(0, 7),
    lastMonth.toISOString().slice(0, 7),
  ]);
  for (const month of months) {
    const [year, m] = month.split("-"),
      base = new URL(source.url);
    base.search = new URLSearchParams({ month: m, year }).toString();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      if (page > 100)
        throw new Error("Sudbury calendar exceeded its pagination budget.");
      base.searchParams.set("page", String(page));
      const root = parseHTML(await get(base.toString(), "html", 2000000));
      counts.pages++;
      const anchors = all(root, (n) => n.tag === "a" && n.attrs.href);
      for (const a of anchors) {
        const url = new URL(a.attrs.href, base);
        if (url.origin !== base.origin) continue;
        const label = a.attrs["aria-label"] || "",
          pm = /page \d+ of\s+(\d+)/i.exec(label);
        if (pm) totalPages = Math.max(totalPages, Number(pm[1]));
        if (
          url.pathname.startsWith("/events-calendar/") &&
          url.searchParams.has("id") &&
          /\badults?\b|all ages|senior/i.test(text(a))
        )
          links.add(url.toString());
      }
    }
  }
  if (!links.size)
    throw new Error(
      "Sudbury calendar returned no recognizable adult event links; saved listings retained.",
    );
  const seen = new Set();
  await mapLimited([...links], 3, async (url) => {
    const root = dom.parseHTML(await get(url, "html", 1500000));
    counts.pages++;
    const title = dom.text(dom.first(root, (n) => n.tag === "h1"));
    const options = dom.all(
      root,
      (n) =>
        n.tag === "option" &&
        n.attrs["data-start"] &&
        n.attrs["data-end"] &&
        n.attrs["data-location"],
    );
    if (!options.length)
      throw new Error("Sudbury's published event dates changed format.");
    for (const node of options) {
      const a = node.attrs,
        start = compactUTC(a["data-start"], h),
        end = compactUTC(a["data-end"], h);
      if (!validTimes(start, end)) {
        counts.unverified++;
        counts.missingTime++;
        continue;
      }
      if (!inWindow(start, end, h)) {
        counts.outsideWindow++;
        continue;
      }
      const lines = decodeURIComponent(a["data-location"])
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      const cityIndex = lines.findIndex((x) =>
        /^.+,\s*(?:Ontario|ON)$/i.test(x),
      );
      if (cityIndex < 1) {
        heldLocation(counts, lines.join(", "));
        continue;
      }
      const city = lines[cityIndex].replace(/,\s*(?:Ontario|ON)$/i, ""),
        street = lines[cityIndex - 1];
      const address = {
        street,
        city,
        state: "Ontario",
        zip: lines[cityIndex + 1] || "",
      };
      const coordinate = await coordinateFor(source, address, h, get);
      if (!coordinate) {
        heldLocation(counts, address);
        continue;
      }
      const venueName =
        lines.slice(0, cityIndex - 1).join(" ") ||
        "Greater Sudbury Public Library";
      const path = new URL(url).pathname,
        identity = path + "|" + start;
      if (seen.has(identity)) {
        counts.duplicates++;
        continue;
      }
      seen.add(identity);
      const name = publicText(
        a["data-title"] ? decodeURIComponent(a["data-title"]) : title,
        h,
        180,
      );
      const description = publicText(
        a["data-description"] ? decodeURIComponent(a["data-description"]) : "",
        h,
      );
      h.addSession(
        venues,
        {
          id: h.key(
            source.id + "|" + streetKey(street, h) + "|" + cityKey(city, h),
          ),
          venueName,
          location: addressText(address, h),
          city,
          ...coordinate,
        },
        h.session(source, identity, name, start, end, {
          seriesId: source.id + "-" + h.key(path),
          description,
          interests: h.interestsFor(name, description),
          sourceUrl: url,
        }),
        h.window,
        counts,
      );
    }
  });
  if (counts.unverified && !venues.size)
    throw new Error(
      "Sudbury activities had no verifiable physical venue coordinates.",
    );
  itemCounts(counts, venues);
  return h.finish(source, venues, counts);
}

async function collectOntarioSource(source, h, get, dom) {
  if (source.type === "ontario-biblioevents")
    return collectBiblio(source, h, get);
  if (source.type === "ontario-tribe") return collectTribe(source, h, get);
  if (source.type === "ontario-sudbury")
    return collectSudbury(source, h, get, dom);
  if (source.type === "ontario-london")
    return collectLondon(source, h, get, dom);
  if (source.type === "ontario-librarymarket")
    return collectLibraryMarket(source, h, get, dom);
  throw new Error("Unknown Ontario calendar adapter.");
}
module.exports = {
  ONTARIO_SOURCES,
  collectOntarioSource,
  parseBiblioPage,
  adultAudienceIds,
  point,
  publicText,
  coordinateFor,
  compactUTC,
  englishDate,
  clockRange,
  isOntario,
  tribeTimes,
};