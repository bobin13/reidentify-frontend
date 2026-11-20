const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS = path.join(__dirname, "migrations");

// Every migration file, oldest first. Each file is idempotent and records its
// own version in schema_migrations, so re-running all of them is safe.
function migrationVersions() {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => name.slice(0, -4));
}

async function main() {
  const { closePool, getPool } = require("./postgres");
  const pool = getPool();

  try {
    for (const version of migrationVersions()) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, `${version}.sql`), "utf8");
      await pool.query(sql);
      console.log(`PostgreSQL schema migration ${version} applied.`);
    }
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("PostgreSQL migration failed:", error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrationVersions };
