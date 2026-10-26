const { randomUUID } = require("node:crypto");

// A coarse spatial index. Exact distance is checked after reading these cells.
// All queries use one automatically indexed Firestore field, not a province scan.
const STEP = 0.05;
const LONGITUDE_CELLS = Math.round(360 / STEP);
const states = new WeakMap();
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
    Math.floor((latitude + 90) / STEP) + ":" + Math.floor((lon + 180) / STEP)
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
        y + ":" + (((x % LONGITUDE_CELLS) + LONGITUDE_CELLS) % LONGITUDE_CELLS),
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
async function readCells(collection, cells, fields, budget = 6000) {
  const allowance =
    typeof budget === "number"
      ? { remainingDocs: budget, remainingBytes: 6 * 1024 * 1024 }
      : budget;
  const docs = [];
  for (let i = 0; i < cells.length; i += 20) {
    let after = null;
    for (;;) {
      const pageSize = Math.min(100, allowance.remainingDocs + 1);
      let query = collection
        .where("mapCell", "in", cells.slice(i, i + 20))
        .limit(pageSize);
      if (fields) query = query.select(...fields);
      if (after) query = query.startAfter(after);
      const page = await query.get();
      for (const doc of page.docs) {
        allowance.remainingDocs--;
        allowance.remainingBytes -= Buffer.byteLength(
          JSON.stringify(doc.data()),
          "utf8",
        );
        if (allowance.remainingDocs < 0 || allowance.remainingBytes < 0)
          throw busyArea();
        docs.push(doc);
      }
      if (page.docs.length < pageSize) break;
      after = page.docs[page.docs.length - 1];
    }
  }
  return docs;
}

// Upgrade existing group events in small, resumable batches. New/edited events
// are indexed at their writer (see the two small groups-routes.js edits).
function groupMapIndex(db, { now = Date.now, logger = console } = {}) {
  if (states.has(db)) return states.get(db);
  const state = { ready: false, error: "", running: null, retryAt: 0 };
  states.set(db, state);
  const meta = db.collection("mapMigrations").doc("group-cells-v1");
  state.ensure = () => {
    if (state.ready || state.running || now() < state.retryAt) return;
    state.running = (async () => {
      const owner = randomUUID();
      const claimed = await db.runTransaction(async (tx) => {
        const old = (await tx.get(meta)).data() || {};
        if (old.complete === true) {
          state.ready = true;
          return null;
        }
        if (old.leaseUntil > now()) return null;
        tx.set(
          meta,
          { leaseOwner: owner, leaseUntil: now() + 120000 },
          { merge: true },
        );
        return old.after || "";
      });
      if (claimed === null) {
        state.retryAt = now() + 5000;
        return;
      }
      let after = claimed;
      for (;;) {
        let query = db.collection("events").orderBy("__name__").limit(150);
        if (after) query = query.startAfter(after);
        const page = await query.get();
        const batch = db.batch();
        let writes = 0;
        for (const doc of page.docs) {
          const data = doc.data();
          const cell = mapCellFor(data.latitude, data.longitude);
          if (cell && data.mapCell !== cell) {
            // A concurrent edit must win; retry this page on a precondition failure.
            batch.update(
              doc.ref,
              { mapCell: cell },
              { lastUpdateTime: doc.updateTime },
            );
            writes++;
          }
        }
        if (writes) {
          try {
            await batch.commit();
          } catch (error) {
            if (error.code === 9 || error.code === "failed-precondition")
              continue;
            throw error;
          }
        }
        const complete = page.docs.length < 150;
        if (page.docs.length) after = page.docs[page.docs.length - 1].id;
        await db.runTransaction(async (tx) => {
          const old = (await tx.get(meta)).data() || {};
          if (old.leaseOwner !== owner)
            throw new Error("Map index lease changed; retrying.");
          tx.set(
            meta,
            {
              after,
              complete,
              leaseUntil: complete ? 0 : now() + 120000,
              leaseOwner: complete ? "" : owner,
            },
            { merge: true },
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
module.exports = { mapCellFor, cellsFor, readCells, busyArea, groupMapIndex };