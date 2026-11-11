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

  const result = await client.query(
    `INSERT INTO users (firebase_uid, full_name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (firebase_uid) DO UPDATE
       SET email = EXCLUDED.email,
           updated_at = now()
     RETURNING id`,
    [firebaseUid, fullName, email],
  );
  return result.rows[0].id;
}

async function closePool() {
  if (!pool) return;
  const active = pool;
  pool = undefined;
  await active.end();
}

module.exports = { getPool, transaction, ensureUser, closePool };
