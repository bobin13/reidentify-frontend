const { installNewsRoutes } = require("./news-routes");
const { installGroupRoutes, startGroupCleanup } = require("./groups-routes");
require("dotenv").config();
const { installEventRoutes } = require("./events-routes");
const { startExternalEventSync } = require("./external-events");
const { installMessagingRoutes } = require("./messages-routes");
const express = require("express");
const { existsSync } = require("node:fs");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { cities } = require("../shared/ontario-areas.json");
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
  const location = resolveLocation(data.location) || legacyLocation(data.area);
  return {
    id: account.uid,
    email: account.email || "",
    fullName: data.fullName,
    area: location ? locationArea(location) : data.area || "",
    location,
    interests: data.interests || [],
    joinedAt: data.joinedAt,
    ...profileExtras(data),
  };
}

function createApp({ db, firebaseAuth }) {
  const app = express();

  app.disable("x-powered-by");
  const json = express.json({ limit: "16kb" });
  app.use((req, res, next) => {
    // Only this authenticated upload route accepts the larger photo body.
    if (req.method === "POST" && req.path === "/api/me/photo") return next();
    return json(req, res, next);
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      database: "connected",
    });
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
      req.account = await firebaseAuth.verifyIdToken(match[1], true);

      next();
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
    }
  });

  // Read the signed-in user's profile.
  app.get("/api/me", async (req, res) => {
    const snapshot = await db.collection("users").doc(req.account.uid).get();

    if (!snapshot.exists) {
      return res.status(404).json({
        message: "Profile not found.",
      });
    }

    const data = snapshot.data();
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
    const reference = db.collection("users").doc(req.account.uid);

    const user = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const previous = snapshot.exists ? snapshot.data() : {};
      // Older Search screens send only area/interests. Keep their saved location.
      const location = changesLocation
        ? requestedLocation
        : resolveLocation(previous.location) ||
          legacyLocation(previous.area || area);
      const selectedInterests = interests ?? previous.interests ?? [];

      const profile = {
        id: req.account.uid,
        email: req.account.email || "",
        fullName: fullName.trim(),
        area: location
          ? locationArea(location)
          : (area ?? previous.area ?? "").trim(),
        location,
        interests: [...new Set(selectedInterests.map((item) => item.trim()))],
        joinedAt: previous.joinedAt || new Date().toISOString(),
        ...profileChanges(input, previous),
      };

      transaction.set(reference, profile, {
        merge: true,
      });

      return ownerProfile(req.account, { ...previous, ...profile });
    });

    res.json({ user });
  });

  installProfileRoutes(app, db, { toOwner: ownerProfile });
  installPlaceRoutes(app);
  installNewsRoutes(app);
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
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsPath || !existsSync(credentialsPath)) {
    throw new Error("Check GOOGLE_APPLICATION_CREDENTIALS in your .env file.");
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error("Set FIREBASE_PROJECT_ID in your .env file.");
  }

  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  const db = getFirestore();

  // Check the real database connection before starting.
  await db.collection("users").limit(1).get();

  const app = createApp({
    db,
    firebaseAuth: getAuth(),
  });

  const port = Number(process.env.PORT || 3000);

  const server = app.listen(port, "127.0.0.1", () => {
    console.log("Firestore connection OK");
    console.log(`ReIdentify backend running at http://localhost:${port}`);
  });

  const stopGroupCleanup = startGroupCleanup(db);
  server.on("close", stopGroupCleanup);
  const stopExternalEvents = startExternalEventSync(db);
  server.on("close", stopExternalEvents);

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
