const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});
const { installNewsRoutes } = require("./news-routes");
const { installInterestNewsRoutes } = require("./interest-news-routes");
const { installGroupRoutes, startGroupCleanup } = require("./groups-routes");
const { installEventRoutes } = require("./events-routes");
const { startExternalEventSync } = require("./external-events");
const { installMessagingRoutes } = require("./messages-routes");
const express = require("express");
const { existsSync } = require("node:fs");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { cities } = require("../shared/ontario-areas.json");
const {
  closePool,
  ensureUser,
  getPool,
  transaction,
} = require("./postgres");
const { migrationVersions } = require("./migrate");
const { createAuthSession } = require("./auth-session");
const cityIndex = new Map(cities.map((city) => [city.id, city]));
const { installPlaceRoutes } = require("./places-routes");
const {
  installProfileRoutes,
  profileExtras,
  profileChanges,
} = require("./profile-routes");

function resolveLocation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (typeof input.cityId !== "string") return null;
  if (input.districtId != null && typeof input.districtId !== "string")
    return null;
  const city = cityIndex.get(input.cityId);
  if (!city) return null;
  const district =
    input.districtId == null
      ? null
      : city.districts.find((item) => item.id === input.districtId);
  if (input.districtId != null && !district) return null;
  // The catalogue supplies names and approximate centres. Never trust client coordinates.
  return {
    province: "Ontario",
    cityId: city.id,
    city: city.name,
    districtId: district?.id ?? null,
    district: district?.name ?? null,
    coordinate: { ...(district?.coordinate ?? city.coordinate) },
  };
}

function normalizeArea(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function legacyLocation(area) {
  const parts = (typeof area === "string" ? area : "")
    .split(/[,·]/)
    .map(normalizeArea)
    .filter(Boolean);
  const matchedCities = cities.filter((city) =>
    parts.includes(normalizeArea(city.name)),
  );
  if (matchedCities.length === 1) {
    const city = matchedCities[0];
    const district = city.districts.find((item) =>
      parts.includes(normalizeArea(item.name)),
    );
    return resolveLocation({
      cityId: city.id,
      districtId: district?.id ?? null,
    });
  }
  if (matchedCities.length > 1) return null;
  const matches = cities.flatMap((city) =>
    city.districts
      .filter((district) => parts.includes(normalizeArea(district.name)))
      .map((district) => ({ cityId: city.id, districtId: district.id })),
  );
  return matches.length === 1 ? resolveLocation(matches[0]) : null;
}

function locationArea(location) {
  return [location.district, location.city].filter(Boolean).join(", ");
}

function ownerProfile(account, data) {
  const location =
    resolveLocation({
      cityId: data.city_id,
      districtId: data.district_id,
    }) || legacyLocation(data.area);
  return {
    id: account.uid,
      email: data.email || account.email || "",
    fullName: data.full_name,
    area: location ? locationArea(location) : data.area || "",
    location,
    interests: data.interests || [],
    joinedAt: data.joined_at,
    ...profileExtras(data),
  };
}

// The signed-in member's row plus interests, or null if there is no row.
// `queryable` is the pool or a transaction client.
async function readOwnerRow(queryable, userId) {
  const result = await queryable.query(
    `SELECT id, firebase_uid, full_name, email, area, city_id, city,
            district_id, district, joined_at, about_me, gender,
            age, profile_visibility, photo_version
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!result.rowCount) return null;
  const interests = await queryable.query(
    `SELECT a.activity
     FROM user_activities ua
     JOIN activities a ON a.activity_id = ua.activity_id
     WHERE ua.user_id = $1
     ORDER BY a.groupid, a.activity`,
    [userId],
  );
  return {
    ...result.rows[0],
    interests: interests.rows.map((row) => row.activity),
  };
}

function createApp({ db, firebaseAuth }) {
  const app = express();
  const session = createAuthSession({ firebaseAuth, db, ensureUser });

  app.disable("x-powered-by");
  const json = express.json({ limit: "16kb" });
  app.use((req, res, next) => {
    // Only this authenticated upload route accepts the larger photo body.
    if (req.method === "POST" && req.path === "/api/me/photo") return next();
    return json(req, res, next);
  });

  app.get("/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok", database: "connected" });
    } catch (error) {
      console.error("PostgreSQL health check failed:", error.code || error.message);
      res.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  // Every /api endpoint requires a valid Firebase login.
  app.use("/api", async (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.get("authorization") || "");

    if (!match) {
      return res.status(401).json({
        message: "Please sign in.",
      });
    }

    try {
      req.account = await session.verify(match[1]);
    } catch (error) {
      const invalidTokenCodes = [
        "auth/argument-error",
        "auth/invalid-id-token",
        "auth/id-token-expired",
        "auth/id-token-revoked",
        "auth/user-disabled",
        "auth/user-not-found",
      ];

      if (invalidTokenCodes.includes(error.code)) {
        return res.status(401).json({
          message: "Please sign in again.",
        });
      }

      console.error(
        "Authentication check failed:",
        error.code || error.message,
      );

      res.status(503).json({
        message: "Unable to check your login. Try again.",
      });
      return;
    }

    try {
      req.userId = await session.userId(req.account);
      next();
    } catch (error) {
      console.error(
        "PostgreSQL user lookup failed:",
        error.code || error.message,
      );
      res.status(503).json({
        message: "Unable to load your account. Try again.",
      });
    }
  });

  // Read the signed-in user's profile.
  app.get("/api/me", async (req, res) => {
    const data = await readOwnerRow(db, req.userId);
    if (!data) {
      return res.status(404).json({
        message: "Profile not found.",
      });
    }
    res.json({
      user: ownerProfile(req.account, data),
    });
  });

  // Create or update the signed-in user's profile.
  app.put("/api/me", async (req, res) => {
    const input = req.body;

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return res.status(400).json({
        message: "Enter your profile details.",
      });
    }

    const { fullName, area, interests } = input;

    try {
      profileChanges(input);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }

    if (
      typeof fullName !== "string" ||
      fullName.trim().length < 2 ||
      fullName.trim().length > 80 ||
      (area !== undefined &&
        (typeof area !== "string" || area.trim().length > 120)) ||
      (interests !== undefined &&
        (!Array.isArray(interests) ||
          interests.length > 150 ||
          interests.some(
            (item) =>
              typeof item !== "string" ||
              item.trim().length < 1 ||
              item.trim().length > 80,
          )))
    ) {
      return res.status(400).json({
        message: "Check your name, area and interests.",
      });
    }

    const changesLocation = Object.prototype.hasOwnProperty.call(
      input,
      "location",
    );
    const requestedLocation = changesLocation
      ? resolveLocation(input.location)
      : null;
    if (changesLocation && !requestedLocation) {
      return res.status(400).json({
        message:
          "Choose an Ontario city and a district belonging to that city, or use the city only.",
      });
    }

    // The ID comes from Firebase, never from the request body.
    let profile;
    try {
      profile = await transaction(db, async (user) => {
        const previousResult = await user.query(
          `SELECT id, area, city_id, city, district_id, district, joined_at,
                  about_me, age, gender, profile_visibility, photo_version
           FROM users WHERE id = $1 FOR UPDATE`,
          [req.userId],
        );
        const previous = previousResult.rows[0] || {};
        // Older Search screens send only area/interests. Keep their saved location.
        const location = changesLocation
          ? requestedLocation
          : resolveLocation({
              cityId: previous.city_id,
              districtId: previous.district_id,
            }) || legacyLocation(previous.area || area);
        const selectedInterests = [
          ...new Set((interests ?? []).map((item) => item.trim())),
        ];
        const extras = profileChanges(input, {
          aboutMe: previous.about_me,
          age: previous.age,
          gender: previous.gender,
          profileVisibility: previous.profile_visibility,
        });
        const profileArea = location
          ? locationArea(location)
          : (area ?? previous.area ?? "").trim();

        await user.query(
          `UPDATE users
           SET full_name = $2, area = $3, city_id = $4, city = $5,
               district_id = $6, district = $7, about_me = $8, age = $9,
               gender = $10, profile_visibility = $11, updated_at = now()
           WHERE id = $1`,
          [
            req.userId,
            fullName.trim(),
            profileArea,
            location?.cityId ?? null,
            location?.city ?? null,
            location?.districtId ?? null,
            location?.district ?? null,
            extras.aboutMe,
            extras.age,
            extras.gender,
            extras.profileVisibility,
          ],
        );

        if (interests !== undefined) {
          const catalog = await user.query(
            `SELECT DISTINCT ON (activity) activity_id, activity
             FROM activities WHERE activity = ANY($1::text[])
             ORDER BY activity, groupid`,
            [selectedInterests],
          );
          if (catalog.rowCount !== selectedInterests.length) {
            throw Object.assign(
              new Error("Choose interests from the available list."),
              { status: 400 },
            );
          }
          await user.query("DELETE FROM user_activities WHERE user_id = $1", [
            req.userId,
          ]);
          if (catalog.rowCount) {
            await user.query(
              `INSERT INTO user_activities (user_id, activity_id)
               SELECT $1, selected.activity_id
               FROM unnest($2::bigint[]) AS selected(activity_id)
               ON CONFLICT DO NOTHING`,
              [req.userId, catalog.rows.map((row) => row.activity_id)],
            );
          }
        }

        return ownerProfile(req.account, await readOwnerRow(user, req.userId));
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      throw error;
    }

    res.json({ user: profile });
  });

  installProfileRoutes(app, db, { toOwner: ownerProfile });
  installPlaceRoutes(app);
  installNewsRoutes(app);
  installInterestNewsRoutes(app, db);
  installGroupRoutes(app, db);
  installMessagingRoutes(app, db);
  installEventRoutes(app, db);

  app.use((_req, res) => {
    res.status(404).json({
      message: "Endpoint not found.",
    });
  });

  app.use((error, req, res, _next) => {
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({
        message: "Send valid JSON.",
      });
    }

    if (error.type === "entity.too.large") {
      return res.status(413).json({
        message: "Request is too large.",
      });
    }

    console.error(
      "Request failed:",
      JSON.stringify({
        method: req.method,
        path: req.path,
        code: error.code ?? null,
        message: String(error.message || "Unknown error").slice(0, 1200),
        ...(typeof error.details === "string"
          ? { details: error.details.slice(0, 1200) }
          : {}),
      }),
    );

    if (
      [8, "8", "resource-exhausted", "RESOURCE_EXHAUSTED"].includes(error.code)
    ) {
      res.set("Retry-After", "60");

      return res.status(503).json({
        message:
          "ReIdentify has reached a service limit. Please try again later.",
      });
    }

    res.status(500).json({
      message: "Something went wrong. Try again.",
    });
  });

  return app;
}

async function start() {
  const configuredCredentialPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
  const credentialsPath = configuredCredentialPath
    ? path.isAbsolute(configuredCredentialPath)
      ? configuredCredentialPath
      : path.resolve(__dirname, "..", configuredCredentialPath)
    : "";

  if (!credentialsPath || !existsSync(credentialsPath)) {
    throw new Error("Check GOOGLE_APPLICATION_CREDENTIALS in your .env file.");
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error("Set FIREBASE_PROJECT_ID in your .env file.");
  }

  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  const db = getPool();
  await db.query("SELECT 1");
  const migrationTable = await db.query(
    "SELECT to_regclass('public.schema_migrations') AS name",
  );
  if (!migrationTable.rows[0].name) {
    throw new Error("Run `npm run db:migrate --prefix backend` before starting.");
  }
  const versions = migrationVersions();
  const applied = await db.query(
    "SELECT version FROM schema_migrations WHERE version = ANY($1::text[])",
    [versions],
  );
  if (applied.rowCount !== versions.length) {
    throw new Error("Run `npm run db:migrate --prefix backend` before starting.");
  }

  const app = createApp({
    db,
    firebaseAuth: getAuth(),
  });

  const port = Number(process.env.PORT || 3000);

  const server = app.listen(port, "127.0.0.1", () => {
    console.log("PostgreSQL connection OK");
    console.log(`ReIdentify backend running at http://localhost:${port}`);
  });

  const stopGroupCleanup = startGroupCleanup(db);
  server.on("close", stopGroupCleanup);
  const stopExternalEvents = startExternalEventSync(db);
  server.on("close", stopExternalEvents);
  server.on("close", () => {
    void closePool();
  });

  server.on("error", (error) => {
    console.error("Server could not listen:", error.message);

    process.exit(1);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Backend could not start:", error.message);

    process.exit(1);
  });
}

module.exports = { createApp };
