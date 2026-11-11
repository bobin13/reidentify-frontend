const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

let pool;

function getPool() {
  if (pool) return pool;

  const required = ["HOST_NAME", "PG_DATABASE", "PG_PORT", "PG_USER", "PG_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing PostgreSQL environment settings: ${missing.join(", ")}`);
  }
  const port = Number(process.env.PG_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PG_PORT must be a valid TCP port.");
  }

  const caPath = path.resolve(
    __dirname,
    "..",
    process.env.PG_CA_PATH || "credentials/ca.pem",
  );
  if (!fs.existsSync(caPath)) {
    throw new Error("PostgreSQL CA certificate is missing. Set PG_CA_PATH.");
  }

  pool = new Pool({
    host: process.env.HOST_NAME.trim(),
    database: process.env.PG_DATABASE.trim(),
    port,
    user: process.env.PG_USER.trim(),
    password: process.env.PG_PASSWORD,
    ssl: {
      ca: fs.readFileSync(caPath, "utf8"),
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: Number(process.env.PG_POOL_MAX || 10),
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.code || error.message);
  });
  return pool;
}

async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function ensureUser(client, account) {
  const firebaseUid = account?.uid;
  if (typeof firebaseUid !== "string" || !firebaseUid) {
    throw new Error("Firebase token did not contain a user ID.");
  }

  const email =
    typeof account.email === "string" && account.email.trim()
      ? account.email.trim().toLowerCase()
      : `${firebaseUid}@firebase-user.invalid`;
  const fullName =
    typeof account.name === "string" && account.name.trim()
      ? account.name.trim().slice(0, 120)
      : email.split("@")[0].slice(0, 120) || "Member";

  const placeholder = `${firebaseUid}@firebase-user.invalid`;

  // Most requests only need the existing row; avoid a write per request.
  const existing = await client.query(
    "SELECT id, email FROM users WHERE firebase_uid = $1",
    [firebaseUid],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.email !== email) {
      // Follow the Firebase email unless another account already holds it.
      await client.query(
        `UPDATE users SET email = $2, updated_at = now()
          WHERE firebase_uid = $1
            AND NOT EXISTS (
              SELECT 1 FROM users WHERE email = $2 AND firebase_uid <> $1
            )`,
        [firebaseUid, email],
      );
    }
    return row.id;
  }

  // users.email is unique. A re-registered Firebase account with the same
  // email gets a fresh profile with a placeholder email instead of a 503.
  try {
    const result = await client.query(
      `INSERT INTO users (firebase_uid, full_name, email)
       VALUES (
         $1, $2,
         CASE
           WHEN EXISTS (SELECT 1 FROM users WHERE email = $3 AND firebase_uid <> $1)
           THEN $4 ELSE $3
         END
       )
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [firebaseUid, fullName, email, placeholder],
    );
    return result.rows[0].id;
  } catch (error) {
    if (error.code !== "23505") throw error;
    // Lost a race with a concurrent insert for the same email or uid.
    const retry = await client.query(
      `INSERT INTO users (firebase_uid, full_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [firebaseUid, fullName, placeholder],
    );
    return retry.rows[0].id;
  }
}

async function closePool() {
  if (!pool) return;
  const active = pool;
  pool = undefined;
  await active.end();
}

module.exports = { getPool, transaction, ensureUser, closePool };
