const fs = require("node:fs");
const path = require("node:path");
const { closePool, getPool } = require("./postgres");

async function main() {
  const file = path.join(__dirname, "migrations", "001_app_data_postgresql.sql");
  const sql = fs.readFileSync(file, "utf8");
  const pool = getPool();

  try {
    await pool.query(sql);
    console.log("PostgreSQL schema migration 001_app_data_postgresql applied.");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error("PostgreSQL migration failed:", error.code || error.message);
  process.exitCode = 1;
});
