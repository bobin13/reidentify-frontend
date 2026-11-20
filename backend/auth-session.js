// Per-request login checks without a Firebase and PostgreSQL round trip on
// every call. The app polls several endpoints every few seconds, so these
// two lookups used to dominate request time.
//
// - Every request still verifies the token signature and expiry. The
//   Firebase Admin SDK does that locally with cached public keys.
// - The revocation check (a call to Firebase) runs at most once per
//   `revokeCheckMs` for each user, so a revoked or disabled account is
//   locked out within that window instead of instantly.
// - The users-table lookup is cached for `userCacheMs`. The key includes
//   the token's email so an email change is synced on the next request.

const MAX_ENTRIES = 5000;

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
}

function createAuthSession({
  firebaseAuth,
  db,
  ensureUser,
  now = Date.now,
  revokeCheckMs = 5 * 60 * 1000,
  userCacheMs = 60 * 1000,
}) {
  const revokeCheckedAt = new Map();
  const userIds = new Map();

  async function verify(token) {
    const account = await firebaseAuth.verifyIdToken(token);
    const checkedAt = revokeCheckedAt.get(account.uid);
    if (checkedAt !== undefined && now() - checkedAt < revokeCheckMs) {
      return account;
    }
    const checked = await firebaseAuth.verifyIdToken(token, true);
    remember(revokeCheckedAt, checked.uid, now());
    return checked;
  }

  async function userId(account) {
    const key = `${account.uid}\n${account.email ?? ""}`;
    const cached = userIds.get(key);
    if (cached && now() - cached.at < userCacheMs) return cached.id;
    const id = await ensureUser(db, account);
    remember(userIds, key, { id, at: now() });
    return id;
  }

  return { verify, userId };
}

module.exports = { createAuthSession };
