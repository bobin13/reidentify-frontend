const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureUser } = require("../postgres");

const account = { uid: "firebase-new", email: "Same@Example.com", name: "New" };

function fakeClient(script) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      return script(sql, values, calls.length);
    },
  };
}

test("ensureUser reads an existing row without writing when the email is unchanged", async () => {
  const client = fakeClient((sql) => {
    assert.match(sql, /^SELECT id, email FROM users WHERE firebase_uid = \$1$/);
    return { rowCount: 1, rows: [{ id: "uuid-1", email: "same@example.com" }] };
  });
  assert.equal(await ensureUser(client, account), "uuid-1");
  assert.equal(client.calls.length, 1);
});

test("ensureUser inserts a new row and falls back to a placeholder email on collision", async () => {
  const client = fakeClient((sql, values) => {
    if (sql.startsWith("SELECT")) return { rowCount: 0, rows: [] };
    assert.match(sql, /INSERT INTO users/);
    assert.match(sql, /ON CONFLICT \(firebase_uid\)/);
    // The statement itself picks the placeholder when another account owns the email.
    assert.deepEqual(values, [
      "firebase-new",
      "New",
      "same@example.com",
      "firebase-new@firebase-user.invalid",
    ]);
    return { rowCount: 1, rows: [{ id: "uuid-2" }] };
  });
  assert.equal(await ensureUser(client, account), "uuid-2");
});

test("ensureUser survives a unique-violation race instead of failing the request", async () => {
  let inserts = 0;
  const client = fakeClient((sql, values) => {
    if (sql.startsWith("SELECT")) return { rowCount: 0, rows: [] };
    inserts++;
    if (inserts === 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
    assert.equal(values[2], "firebase-new@firebase-user.invalid");
    return { rowCount: 1, rows: [{ id: "uuid-3" }] };
  });
  assert.equal(await ensureUser(client, account), "uuid-3");
  assert.equal(inserts, 2);
});

test("ensureUser rethrows unrelated database errors", async () => {
  const client = fakeClient((sql) => {
    if (sql.startsWith("SELECT")) return { rowCount: 0, rows: [] };
    throw Object.assign(new Error("down"), { code: "57P01" });
  });
  await assert.rejects(ensureUser(client, account), { code: "57P01" });
});
