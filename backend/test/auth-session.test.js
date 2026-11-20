const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthSession } = require("../auth-session");

function setup({ revoked = new Set() } = {}) {
  let clock = 0;
  const verifyCalls = [];
  const ensureCalls = [];
  const firebaseAuth = {
    async verifyIdToken(token, checkRevoked = false) {
      verifyCalls.push([token, checkRevoked]);
      const [uid, email] = token.split(":");
      if (checkRevoked && revoked.has(uid)) {
        throw Object.assign(new Error("revoked"), {
          code: "auth/id-token-revoked",
        });
      }
      return { uid, email };
    },
  };
  const session = createAuthSession({
    firebaseAuth,
    db: {},
    ensureUser: async (_db, account) => {
      ensureCalls.push(account);
      return `row-${account.uid}`;
    },
    now: () => clock,
    revokeCheckMs: 1000,
    userCacheMs: 100,
  });
  return {
    session,
    verifyCalls,
    ensureCalls,
    revoked,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("every request verifies the token, but revocation is checked once per window", async () => {
  const t = setup();
  await t.session.verify("alice:a@x.com");
  await t.session.verify("alice:a@x.com");
  t.advance(999);
  await t.session.verify("alice:a@x.com");
  assert.deepEqual(
    t.verifyCalls.map(([, checked]) => checked),
    [false, true, false, false],
  );

  t.advance(1);
  await t.session.verify("alice:a@x.com");
  assert.deepEqual(t.verifyCalls.slice(-2).map(([, c]) => c), [false, true]);
});

test("a revoked account is refused at its next revocation check", async () => {
  const t = setup();
  await t.session.verify("bob:b@x.com");
  t.revoked.add("bob");
  await t.session.verify("bob:b@x.com"); // still inside the window
  t.advance(1000);
  await assert.rejects(t.session.verify("bob:b@x.com"), {
    code: "auth/id-token-revoked",
  });
  // A failed check is not remembered, so every later request re-checks.
  await assert.rejects(t.session.verify("bob:b@x.com"), {
    code: "auth/id-token-revoked",
  });
});

test("revocation windows are tracked per user", async () => {
  const t = setup();
  await t.session.verify("alice:a@x.com");
  await t.session.verify("carol:c@x.com");
  assert.deepEqual(
    t.verifyCalls.filter(([, checked]) => checked).map(([token]) => token),
    ["alice:a@x.com", "carol:c@x.com"],
  );
});

test("the user row lookup is cached briefly and re-run when the email changes", async () => {
  const t = setup();
  assert.equal(await t.session.userId({ uid: "alice", email: "a@x.com" }), "row-alice");
  await t.session.userId({ uid: "alice", email: "a@x.com" });
  assert.equal(t.ensureCalls.length, 1);

  await t.session.userId({ uid: "alice", email: "new@x.com" });
  assert.equal(t.ensureCalls.length, 2, "email change syncs right away");

  t.advance(100);
  await t.session.userId({ uid: "alice", email: "new@x.com" });
  assert.equal(t.ensureCalls.length, 3, "cache expires");
});

test("forget drops a deleted account's cached checks", async () => {
  const t = setup();
  await t.session.verify("dave:d@x.com");
  await t.session.userId({ uid: "dave", email: "d@x.com" });
  t.session.forget("dave");
  t.revoked.add("dave");
  await assert.rejects(t.session.verify("dave:d@x.com"), {
    code: "auth/id-token-revoked",
  });
  await t.session.userId({ uid: "dave", email: "d@x.com" });
  assert.equal(t.ensureCalls.length, 2, "user row looked up again");
});
