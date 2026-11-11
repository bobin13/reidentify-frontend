const test = require("node:test");
const assert = require("node:assert/strict");
const {
  groupEventScope,
  readMemberEvents,
  mapCellFor,
} = require("../map-geography");
const { createViewportService, viewportOptions } = require("../map-viewport");
const { createExternalEventService, SOURCES } = require("../external-events");
const { installEventRoutes } = require("../events-routes");

const userId = "8f73ee0f-cace-4d35-a3b6-850833d153ba";
const startedAt = "2026-01-02T10:00:00.000Z";
const venue = {
  venue_id: "place-1",
  venue_name: "Community Hall",
  location: "1 Main Street",
  latitude: 43.65,
  longitude: -79.38,
  map_cell: mapCellFor(43.65, -79.38),
  sessions: [
    {
      id: "session-1",
      title: "Morning walk",
      startsAt: startedAt,
      endsAt: "2026-01-02T11:00:00.000Z",
      interests: ["Walking"],
      timeZone: "America/Toronto",
    },
  ],
};

test("group event scope and paging use authenticated UUID memberships", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM group_memberships"))
        return { rows: [{ groupId: "a1b2c3d4-e5f6-4789-9abc-0123456789ab" }] };
      return {
        rows: [
          {
            id: "event-1",
            groupId: "a1b2c3d4-e5f6-4789-9abc-0123456789ab",
            startsAt: new Date(startedAt),
          },
        ],
      };
    },
  };
  const scope = await groupEventScope(pool, userId);
  const events = await readMemberEvents(pool, scope, ["title", "startsAt"]);

  assert.deepEqual(calls[0].values, [userId]);
  assert.equal(calls[0].text.includes("g.status = 'active'"), true);
  assert.deepEqual(calls[1].values, [scope.ids[0], "", 100]);
  assert.equal(events[0].id, "event-1");
  assert.equal(scope.allows(events[0]), true);
});

test("viewport reads PostgreSQL map snapshots and paginates returned venues", async () => {
  const calls = [];
  const source = { id: "test-source", name: "Test", area: "Test area" };
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM group_memberships")) return { rows: [] };
      if (text.includes("FROM external_event_sources"))
        return {
          rows: [
            {
              id: source.id,
              name: source.name,
              area: source.area,
              active_run_id: "run-1",
              map_schema_version: 2,
              map_cells: [venue.map_cell],
              last_success_at: new Date(startedAt),
              stats: {},
            },
          ],
        };
      if (text.includes("FROM external_event_venues"))
        return { rows: [{ ...venue, id: "chunk-1", venueName: venue.venue_name }] };
      if (text.includes("FROM group_events")) return { rows: [] };
      throw new Error("Unexpected SQL query");
    },
  };
  const service = createViewportService(pool, {
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    sources: [source],
    index: { ready: true },
  });
  const options = viewportOptions({
    north: "44",
    south: "43",
    east: "-78",
    west: "-80",
    days: "31",
    interests: '["Walking"]',
  });
  const page = await service.page(options, null, userId);

  assert.equal(page.venues.length, 1);
  assert.equal(page.venues[0].title, venue.venue_name);
  assert.equal(page.venues[0].sessionCount, 1);
  assert.equal(page.nextCursor, null);
  assert.equal(
    calls.some(({ text }) => text.includes("external_event_venues")),
    true,
  );
});

test("external event readers load PostgreSQL source and venue snapshots", async () => {
  const source = SOURCES[0];
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM external_event_sources"))
        return {
          rows: [
            {
              id: source.id,
              name: source.name,
              area: source.area,
              active_run_id: "run-1",
              map_schema_version: 2,
              map_cells: [venue.map_cell],
              last_success_at: new Date(startedAt),
              stats: { venues: 1, sessions: 1 },
            },
          ],
        };
      if (text.includes("FROM external_event_venues"))
        return {
          rows: [
            {
              chunk_id: "chunk-1",
              ...venue,
            },
          ],
        };
      throw new Error("Unexpected SQL query");
    },
    async connect() {
      throw new Error("Reader should not open a transaction");
    },
  };
  const service = createExternalEventService(pool);
  const map = await service.readMapSummaries({}, [venue.map_cell]);
  const schedule = await service.loadMapSessions({
    sourceId: source.id,
    runId: "run-1",
    chunkId: "chunk-1",
  });

  assert.equal(map.sources[0].ready, true);
  assert.equal(map.records[0].ref.runId, "run-1");
  assert.equal(schedule[0].venueId, venue.venue_id);
  assert.equal(calls.every(({ text }) => text.includes("$")), true);
});

test("events endpoint serializes PostgreSQL group events for the UUID user", async () => {
  const groupId = "a1b2c3d4-e5f6-4789-9abc-0123456789ab";
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM group_memberships"))
        return { rows: [{ groupId }] };
      return {
        rows: [
          {
            id: "event-1",
            groupId,
            status: "published",
            title: "Morning walk",
            location: "1 Main Street",
            latitude: 43.65,
            longitude: -79.38,
            startsAt: new Date(startedAt),
            endsAt: new Date("2026-01-02T11:00:00.000Z"),
            description: "",
            interests: ["Walking"],
            timeZone: "America/Toronto",
          },
        ],
      };
    },
  };
  let handler;
  installEventRoutes(
    { get: (_path, route) => (handler = route) },
    pool,
    {
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
      service: { read: async () => ({ events: [], sources: [] }) },
    },
  );
  const response = {
    headers: {},
    set(name, value) {
      this.headers[name] = value;
    },
    json(value) {
      this.body = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  await handler(
    { userId, query: {} },
    response,
    (error) => {
      throw error;
    },
  );

  assert.deepEqual(calls[0].values, [userId]);
  assert.equal(response.body.events[0].id, "event-1");
  assert.equal(response.body.events[0].seriesId, "event-1");
  assert.equal(response.body.events[0].venueName, "1 Main Street");
});
