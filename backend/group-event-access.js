const { createHash } = require("node:crypto");
const { busyArea } = require("./map-geography");

const validUid = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const EVENT_FIELDS = new Map([
  ["id", "id"],
  ["title", "title"],
  ["location", "location"],
  ["venueName", "location"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
  ["description", "description"],
  ["interests", "interests"],
  ["groupId", "group_id"],
  ["creatorId", "creator_uid"],
  ["requestId", "request_id"],
  ["startsAt", "starts_at"],
  ["endsAt", "ends_at"],
  ["status", "status"],
  ["timeZone", "time_zone"],
  ["mapCell", "map_cell"],
  ["updatedAt", "updated_at"],
]);

function eventData(row) {
  const data = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "creator_uid") data.creatorId = value;
    else if (key === "venue_name") data.venueName = value || row.location;
    else if (key === "group_id") data.groupId = value;
    else if (key === "request_id") data.requestId = value;
    else if (key === "map_cell") data.mapCell = value;
    else if (key === "time_zone") data.timeZone = value;
    else if (key === "updated_at") data.updatedAt = value;
    else if (key === "starts_at") data.startsAt = value;
    else if (key === "ends_at") data.endsAt = value;
    else if (key !== "creator_id") data[key] = value;
  }
  return data;
}

function eventDoc(row) {
  const data = eventData(row);
  return { id: row.id, data: () => ({ ...data }) };
}

// Membership is checked for each request; group visibility is never cached.
async function groupEventScope(db, uid) {
  if (!validUid(uid))
    throw Object.assign(new Error("Please sign in."), { status: 401 });
  const { rows } = await db.query(
    `SELECT g.id
       FROM users u
       JOIN group_memberships m ON m.user_id = u.id AND m.status = 'active'
       JOIN community_groups g ON g.id = m.group_id AND g.status = 'active'
      WHERE u.firebase_uid = $1
      ORDER BY g.id`,
    [uid],
  );
  const ids = [...new Set(rows.map((row) => row.id))];
  const allowed = new Set(ids);
  return {
    uid,
    ids,
    key: createHash("sha256")
      .update(JSON.stringify([uid, ids]))
      .digest("hex")
      .slice(0, 24),
    allows(event) {
      return !!event && allowed.has(event.groupId);
    },
  };
}

async function readMemberEvents(
  db,
  scope,
  fields,
  budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 },
) {
  const docs = [];
  const selectedFields = fields
    ? [...new Set(["id", "groupId", ...fields])]
    : null;
  if (selectedFields?.some((field) => !EVENT_FIELDS.has(field)))
    throw new Error("Unsupported group event field.");
  for (const id of scope.ids) {
    let after = null;
    for (;;) {
      const size = Math.min(100, budget.remainingDocs + 1);
      if (size < 1) throw busyArea();
      const columns = selectedFields
        ? selectedFields.map((field) =>
            field === "creatorId"
              ? "u.firebase_uid AS creator_uid"
              : field === "venueName"
                ? "e.location AS venue_name"
              : `e.${EVENT_FIELDS.get(field)}`,
          )
        : ["e.*", "u.firebase_uid AS creator_uid"];
      const { rows } = await db.query(
        `SELECT ${columns.join(", ")}
           FROM group_events e
           JOIN users u ON u.id = e.creator_id
          WHERE e.group_id = $1 AND ($2::text IS NULL OR e.id > $2)
          ORDER BY e.id
          LIMIT $3`,
        [id, after, size],
      );
      for (const row of rows) {
        const data = eventData(row);
        budget.remainingDocs--;
        budget.remainingBytes -= Buffer.byteLength(JSON.stringify(data), "utf8");
        if (budget.remainingDocs < 0 || budget.remainingBytes < 0)
          throw busyArea();
        if (scope.allows(data)) docs.push(eventDoc(row));
      }
      if (rows.length < size) break;
      after = rows[rows.length - 1].id;
    }
  }
  return docs;
}

module.exports = { groupEventScope, readMemberEvents };
