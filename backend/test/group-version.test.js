const test = require("node:test");
const assert = require("node:assert/strict");
const { installGroupRoutes } = require("../groups-routes");

const userId = "00000000-0000-4000-8000-000000000001";

function appWith(db) {
  const routes = new Map();
  installGroupRoutes(
    {
      get: (path, handler) => routes.set(`GET ${path}`, handler),
      post: (path, handler) => routes.set(`POST ${path}`, handler),
      put: (path, handler) => routes.set(`PUT ${path}`, handler),
    },
    db,
  );
  return routes;
}

async function call(handler) {
  const res = {
    code: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(v) { this.value = v; return this; },
  };
  let failure;
  await handler(
    { account: { uid: "firebase-viewer" }, userId, params: {}, query: {}, body: {} },
    res,
    (error) => { failure = error; },
  );
  if (failure) throw failure;
  return res;
}

function dbWith(groupRows) {
  return {
    async query(sql, values) {
      if (sql.includes("FROM users WHERE id = $1 AND firebase_uid = $2")) {
        assert.deepEqual(values, [userId, "firebase-viewer"]);
        return { rows: [{ id: userId, firebase_uid: "firebase-viewer" }] };
      }
      assert.match(sql, /FROM group_memberships m/);
      assert.match(sql, /LEFT JOIN group_events e/);
      assert.deepEqual(values, [userId]);
      return { rows: groupRows };
    },
  };
}

const t0 = new Date("2026-01-01T00:00:00Z");
const t1 = new Date("2026-01-02T00:00:00Z");

test("group-version fingerprints stay stable for unchanged groups and events", async () => {
  const rows = [{ id: "g1", published: 1, changed_at: t0 }];
  const a = await call(appWith(dbWith(rows)).get("GET /api/map/group-version"));
  const b = await call(appWith(dbWith(rows)).get("GET /api/map/group-version"));
  assert.equal(a.code, 200);
  assert.equal(a.headers["Cache-Control"], "no-store");
  assert.match(a.value.version, /^[0-9a-f]{24}$/);
  assert.deepEqual(a.value, b.value);
});

test("an event change moves version but not membership", async () => {
  const before = await call(
    appWith(dbWith([{ id: "g1", published: 1, changed_at: t0 }])).get("GET /api/map/group-version"),
  );
  const after = await call(
    appWith(dbWith([{ id: "g1", published: 1, changed_at: t1 }])).get("GET /api/map/group-version"),
  );
  assert.notEqual(after.value.version, before.value.version);
  assert.equal(after.value.membership, before.value.membership);
});

test("joining another group moves both membership and version", async () => {
  const before = await call(
    appWith(dbWith([{ id: "g1", published: 0, changed_at: t0 }])).get("GET /api/map/group-version"),
  );
  const after = await call(
    appWith(
      dbWith([
        { id: "g1", published: 0, changed_at: t0 },
        { id: "g2", published: 0, changed_at: t0 },
      ]),
    ).get("GET /api/map/group-version"),
  );
  assert.notEqual(after.value.membership, before.value.membership);
  assert.notEqual(after.value.version, before.value.version);
});
