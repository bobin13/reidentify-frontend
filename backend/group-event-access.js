const { createHash } = require("node:crypto");
const { busyArea } = require("./map-geography");
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// Membership is checked on every request. Never cache this decision by map area.
async function groupEventScope(db, uid) {
  if (typeof uid !== "string" || !uid || uid.length > 128)
    throw Object.assign(new Error("Please sign in."), { status: 401 });
  const mine = await db
    .collection("groupMemberships")
    .where("uid", "==", uid)
    .select("groupId")
    .get();
  const candidates = [
    ...new Set(mine.docs.map((doc) => doc.data().groupId).filter(validId)),
  ].sort();
  const ids = [],
    revisions = [];
  // Closed/deleting groups and orphaned memberships must not expose events.
  for (let i = 0; i < candidates.length; i += 8) {
    const docs = await Promise.all(
      candidates
        .slice(i, i + 8)
        .map((id) => db.collection("groups").doc(id).get()),
    );
    docs.forEach((doc, n) => {
      if (doc.exists && doc.data().status === "active") {
        ids.push(candidates[i + n]);
        revisions.push([candidates[i + n], doc.data().eventRevision || ""]);
      }
    });
  }
  const allowed = new Set(ids);
  return {
    uid,
    ids,
    membershipKey: createHash("sha256")
      .update(JSON.stringify([uid, ids]))
      .digest("hex")
      .slice(0, 24),
    key: createHash("sha256")
      .update(JSON.stringify([uid, revisions]))
      .digest("hex")
      .slice(0, 24),
    allows(event) {
      return !!event && allowed.has(event.groupId);
    },
  };
}

// Uses the same single-field groupId query as the existing group Events screen.
// No province-wide scan and no new composite index are needed.
async function readMemberEvents(
  db,
  scope,
  fields,
  budget = { remainingDocs: 6000, remainingBytes: 6 * 1024 * 1024 },
) {
  const docs = [];
  for (const id of scope.ids) {
    let after = null;
    for (;;) {
      const size = Math.min(100, budget.remainingDocs + 1);
      if (size < 1) throw busyArea();
      let query = db
        .collection("events")
        .where("groupId", "==", id)
        .orderBy("__name__")
        .limit(size);
      if (fields) query = query.select(...fields);
      if (after) query = query.startAfter(after);
      const page = await query.get();
      for (const doc of page.docs) {
        const data = doc.data();
        budget.remainingDocs--;
        budget.remainingBytes -= Buffer.byteLength(
          JSON.stringify(data),
          "utf8",
        );
        if (budget.remainingDocs < 0 || budget.remainingBytes < 0)
          throw busyArea();
        if (scope.allows(data)) docs.push(doc);
      }
      if (page.docs.length < size) break;
      after = page.docs[page.docs.length - 1].id;
    }
  }
  return docs;
}

module.exports = { groupEventScope, readMemberEvents };
