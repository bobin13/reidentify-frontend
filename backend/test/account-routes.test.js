const test = require("node:test");
const assert = require("node:assert/strict");
const { installAccountRoutes } = require("../account-routes");

const userId = "00000000-0000-4000-8000-000000000001";
const groupA = "10000000-0000-4000-8000-000000000001";
const groupB = "10000000-0000-4000-8000-000000000002";

function setup({ firebaseError, groups = [] } = {}) {
  const sql = [];
  const client = {
    async query(text, values) {
      sql.push({ text: text.replace(/\s+/g, " ").trim(), values });
      if (/FROM group_memberships m/.test(text)) return { rows: groups };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = { connect: async () => client };
  const deleted = [];
  const forgotten = [];
  const firebaseAuth = {
    async deleteUser(uid) {
      if (firebaseError) throw firebaseError;
      deleted.push(uid);
    },
  };
  let handler;
  installAccountRoutes(
    { post: (path, fn) => (handler = fn) },
    db,
    { firebaseAuth, onDeleted: (uid) => forgotten.push(uid), now: () => 0 },
  );
  async function call(body) {
    const res = {
      code: 200,
      status(c) {
        this.code = c;
        return this;
      },
      json(v) {
        this.value = v;
        return this;
      },
    };
    let failure;
    await handler(
      { userId, account: { uid: "firebase-me" }, body },
      res,
      (e) => (failure = e),
    );
    return { res, failure };
  }
  return { call, sql, deleted, forgotten };
}

test("deleting needs an explicit confirmation", async () => {
  const t = setup();
  const { res } = await t.call({});
  assert.equal(res.code, 400);
  assert.equal(t.sql.length, 0);
  assert.deepEqual(t.deleted, []);
});

test("deletion leaves each group, removes the user row, then the Firebase login", async () => {
  const t = setup({
    groups: [
      { id: groupA, member_count: 3, last_activity_at: new Date(0) },
      { id: groupB, member_count: 1, last_activity_at: new Date(0) },
    ],
  });
  const { res, failure } = await t.call({ confirm: "DELETE" });
  assert.equal(failure, undefined);
  assert.deepEqual(res.value, { deleted: true });

  const texts = t.sql.map((q) => q.text);
  assert.equal(texts[0], "BEGIN");
  assert.equal(texts.at(-1), "COMMIT");
  // Only the group this member was last in has its events cancelled.
  const cancels = t.sql.filter((q) => q.text.startsWith("UPDATE group_events"));
  assert.deepEqual(cancels.map((q) => q.values[0]), [groupB]);
  const counts = t.sql.filter((q) => q.text.startsWith("UPDATE community_groups"));
  assert.deepEqual(counts.map((q) => [q.values[0], q.values[1]]), [
    [groupA, false],
    [groupB, true],
  ]);
  assert.ok(texts.includes("DELETE FROM users WHERE id = $1"));
  assert.deepEqual(t.deleted, ["firebase-me"]);
  assert.deepEqual(t.forgotten, ["firebase-me"]);
});

test("a Firebase failure rolls the database back", async () => {
  const t = setup({ firebaseError: Object.assign(new Error("down"), { code: "auth/internal-error" }) });
  const { failure } = await t.call({ confirm: "DELETE" });
  assert.equal(failure.code, "auth/internal-error");
  assert.equal(t.sql.at(-1).text, "ROLLBACK");
  assert.deepEqual(t.forgotten, []);
});

test("an already-deleted Firebase login still completes the deletion", async () => {
  const t = setup({ firebaseError: Object.assign(new Error("gone"), { code: "auth/user-not-found" }) });
  const { res } = await t.call({ confirm: "DELETE" });
  assert.deepEqual(res.value, { deleted: true });
  assert.equal(t.sql.at(-1).text, "COMMIT");
});
