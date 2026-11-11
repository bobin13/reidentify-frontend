const { createHash, randomUUID } = require("node:crypto");

const STEP = 0.05;
const LONGITUDE_CELLS = Math.round(360 / STEP);
const states = new WeakMap();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapCellFor(latitude, longitude) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  const lon = longitude === 180 ? -180 : longitude;
  return (
    Math.floor((latitude + 90) / STEP) +
    ":" +
    Math.floor((lon + 180) / STEP)
  );
}

function cellsFor(center, radiusKm) {
  const dy = radiusKm / 110;
  const dx =
    radiusKm /
    (110 *
      Math.max(
        0.01,
        Math.cos(((Math.abs(center.latitude) + dy) * Math.PI) / 180),
      ));
  const cells = new Set();
  const low = Math.floor((Math.max(-90, center.latitude - dy) + 90) / STEP);
  const high = Math.floor((Math.min(90, center.latitude + dy) + 90) / STEP);
  const x0 = Math.floor((center.longitude - dx + 180) / STEP);
  const x1 = Math.floor((center.longitude + dx + 180) / STEP);
  if ((high - low + 1) * (x1 - x0 + 1) > 120) throw busyArea();
  for (let y = low; y <= high; y++)
    for (let x = x0; x <= x1; x++) {
      cells.add(
        y +
          ":" +
          (((x % LONGITUDE_CELLS) + LONGITUDE_CELLS) % LONGITUDE_CELLS),
      );
    }
  return [...cells];
}

function busyArea() {
  return Object.assign(
    new Error(
      "There are too many places in this area. Choose 2 km or 500 m, or move the map and search again.",
    ),
    { status: 422 },
  );
}

async function groupEventScope(pool, userId) {
  if (typeof userId !== "string" || !UUID.test(userId))
    throw Object.assign(new Error("Please sign in."), { status: 401 });
  const { rows } = await pool.query(
    `SELECT gm.group_id::text AS "groupId"
       FROM group_memberships gm
       JOIN community_groups g ON g.id = gm.group_id
      WHERE gm.user_id = $1::uuid
        AND gm.status = 'active'
        AND g.status = 'active'
      ORDER BY gm.group_id`,
    [userId],
  );
  const ids = rows.map((row) => row.groupId);
  return {
    userId,
    ids,
    key: createHash("sha256")
      .update(JSON.stringify([userId, ids]))
      .digest("hex")
      .slice(0, 24),
    allows(event) {
      return !!event && ids.includes(String(event.groupId));
    },
  };
}

const GROUP_COLUMNS = Object.freeze({
  id: "id",
  title: "title",
  location: "location",
  latitude: "latitude",
  longitude: "longitude",
  startsAt: "starts_at",
  endsAt: "ends_at",
  status: "status",
  groupId: "group_id",
  interests: "interests",
  timeZone: "time_zone",
  description: "description",
  updatedAt: "updated_at",
});

async function readMemberEvents(
  pool,
  scope,
  fields,
  budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 },
) {
  const columns = (fields || Object.keys(GROUP_COLUMNS))
    .map((field) => GROUP_COLUMNS[field])
    .filter(Boolean);
  if (!columns.includes("id")) columns.unshift("id");
  if (!columns.includes("group_id")) columns.push("group_id");
  const projection = columns
    .map((column) => {
      const name = Object.entries(GROUP_COLUMNS).find(
        ([, candidate]) => candidate === column,
      )?.[0];
      return `${column} AS "${name || column}"`;
    })
    .join(", ");
  const events = [];
  for (const groupId of scope.ids) {
    let after = "";
    for (;;) {
      const size = Math.min(100, budget.remainingDocs + 1);
      if (size < 1) throw busyArea();
      const { rows } = await pool.query(
        `SELECT ${projection}
           FROM group_events
          WHERE group_id = $1::uuid
            AND status = 'published'
            AND id > $2
          ORDER BY id
          LIMIT $3`,
        [groupId, after, size],
      );
      for (const row of rows) {
        const data = JSON.stringify(row);
        budget.remainingDocs--;
        budget.remainingBytes -= Buffer.byteLength(data, "utf8");
        if (budget.remainingDocs < 0 || budget.remainingBytes < 0)
          throw busyArea();
        if (scope.allows(row)) events.push(row);
      }
      if (rows.length < size) break;
      after = rows[rows.length - 1].id;
    }
  }
  return events;
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function groupMapIndex(pool, { now = Date.now, logger = console } = {}) {
  if (states.has(pool)) return states.get(pool);
  const state = { ready: true, error: "", running: null, retryAt: 0 };
  states.set(pool, state);
  state.ensure = () => {
    if (state.running || now() < state.retryAt) return;
    state.running = (async () => {
      const owner = randomUUID();
      const after = await transaction(pool, async (client) => {
        await client.query(
          `INSERT INTO app_metadata (key, value)
           VALUES ($1, '{}'::jsonb)
           ON CONFLICT (key) DO NOTHING`,
          ["group-map-cells-v1"],
        );
        const { rows } = await client.query(
          "SELECT value FROM app_metadata WHERE key = $1 FOR UPDATE",
          ["group-map-cells-v1"],
        );
        const previous = rows[0]?.value || {};
        if (previous.complete === true) {
          state.ready = true;
          return null;
        }
        if (Date.parse(previous.leaseUntil || "") > now()) {
          state.ready = false;
          return null;
        }
        const resume = previous.after || "";
        await client.query(
          `INSERT INTO app_metadata (key, value)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE
             SET value = app_metadata.value || EXCLUDED.value,
                 updated_at = now()`,
          [
            "group-map-cells-v1",
            JSON.stringify({
              leaseOwner: owner,
              leaseUntil: new Date(now() + 120000).toISOString(),
            }),
          ],
        );
        return resume;
      });
      if (after === null) {
        state.retryAt = now() + 5000;
        return;
      }
      state.ready = false;
      let cursor = after;
      for (;;) {
        const { rows } = await pool.query(
          `SELECT id
             FROM group_events
            WHERE id > $1
            ORDER BY id
            LIMIT 150`,
          [cursor],
        );
        const complete = rows.length < 150;
        if (rows.length) {
          await pool.query(
            `UPDATE group_events
                SET map_cell =
                  floor((latitude + 90) / 0.05)::integer::text || ':' ||
                  floor(((CASE WHEN longitude = 180 THEN -180 ELSE longitude END) + 180) / 0.05)::integer::text
              WHERE id = ANY($1::text[])`,
            [rows.map((row) => row.id)],
          );
          cursor = rows[rows.length - 1].id;
        }
        await transaction(pool, async (client) => {
          const { rows: current } = await client.query(
            "SELECT value FROM app_metadata WHERE key = $1 FOR UPDATE",
            ["group-map-cells-v1"],
          );
          const value = current[0]?.value || {};
          if (value.leaseOwner !== owner)
            throw new Error("Map index lease changed; retrying.");
          await client.query(
            `UPDATE app_metadata
                SET value = value || $2::jsonb,
                    updated_at = now()
              WHERE key = $1`,
            [
              "group-map-cells-v1",
              JSON.stringify({
                after: cursor,
                complete,
                leaseUntil: complete
                  ? null
                  : new Date(now() + 120000).toISOString(),
                leaseOwner: complete ? null : owner,
              }),
            ],
          );
        });
        if (complete) {
          state.ready = true;
          state.error = "";
          logger.log("[maps] Existing group locations indexed.");
          break;
        }
      }
    })()
      .catch((error) => {
        state.error = String(error.message || "Map indexing failed");
        state.retryAt = now() + 60000;
        logger.warn("[maps] Group location index will retry: " + state.error);
      })
      .finally(() => {
        state.running = null;
      });
  };
  state.ensure();
  return state;
}

module.exports = {
  mapCellFor,
  cellsFor,
  busyArea,
  groupEventScope,
  readMemberEvents,
  groupMapIndex,
};
