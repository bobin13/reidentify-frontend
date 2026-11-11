const test = require("node:test");
const assert = require("node:assert/strict");
const { groupEventScope, readMemberEvents } = require("../group-event-access");
const { assertCanContact } = require("../groups-routes");

const groupId = "392b11f7-bd72-40aa-989a-30f3893ef511";
const firebaseUid = "firebase-user";

test("group event scope resolves active memberships through Firebase UID", async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: groupId }, { id: groupId }] };
    },
  };

  const scope = await groupEventScope(db, firebaseUid);

  assert.deepEqual(scope.ids, [groupId]);
  assert.equal(scope.uid, firebaseUid);
  assert.equal(scope.allows({ groupId }), true);
  assert.equal(scope.allows({ groupId: "another-group" }), false);
  assert.deepEqual(calls[0].values, [firebaseUid]);
  assert.match(calls[0].sql, /m\.status = 'active'/);
  assert.match(calls[0].sql, /g\.status = 'active'/);
});

test("member events are parameterized, paged, and returned with API field names", async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [
          {
            id: "event-1",
            group_id: groupId,
            title: "Walk",
            venue_name: "Town Hall",
            starts_at: new Date("2026-01-01T10:00:00Z"),
            ends_at: new Date("2026-01-01T11:00:00Z"),
          },
        ],
      };
    },
  };
  const scope = {
    ids: [groupId],
    allows: (event) => event.groupId === groupId,
  };
  const budget = { remainingDocs: 10, remainingBytes: 10000 };

  const docs = await readMemberEvents(
    db,
    scope,
    ["title", "venueName", "startsAt", "endsAt"],
    budget,
  );

  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, "event-1");
  assert.deepEqual(
    Object.keys(docs[0].data()).sort(),
    ["endsAt", "groupId", "id", "startsAt", "title", "venueName"].sort(),
  );
  assert.equal(docs[0].data().groupId, groupId);
  assert.equal(docs[0].data().venueName, "Town Hall");
  assert.deepEqual(calls[0].values, [groupId, null, 11]);
  assert.match(calls[0].sql, /e\.id > \$2/);
  assert.match(calls[0].sql, /e\.location AS venue_name/);
  assert.equal(budget.remainingDocs, 9);
});

test("direct contact checks both block directions with Firebase UIDs", async () => {
  const calls = [];
  const queryable = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };

  await assertCanContact(queryable, "owner-uid", "peer-uid", queryable);

  assert.deepEqual(calls[0].values, ["owner-uid", "peer-uid"]);
  assert.match(calls[0].sql, /owner\.firebase_uid = \$1/);
  assert.match(calls[0].sql, /owner\.firebase_uid = \$2/);
});

test("direct contact fails when either member blocked the other", async () => {
  const queryable = {
    async query() {
      return { rows: [{ "?column?": 1 }] };
    },
  };

  await assert.rejects(
    assertCanContact(queryable, "owner-uid", "peer-uid"),
    { status: 403, message: "Direct contact between these members is blocked." },
  );
});
