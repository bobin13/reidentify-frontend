require("dotenv").config();
const { installEventRoutes } = require("./events-routes");
const { installMessagingRoutes } = require("./messages-routes");
const express = require("express");
const { existsSync } = require("node:fs");
const {
  initializeApp,
  applicationDefault,
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function createApp({ db, firebaseAuth }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      database: "connected",
    });
  });

  // Every /api endpoint requires a valid Firebase login.
  app.use("/api", async (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(
      req.get("authorization") || ""
    );

    if (!match) {
      return res.status(401).json({
        message: "Please sign in.",
      });
    }

    try {
      req.account = await firebaseAuth.verifyIdToken(
        match[1],
        true
      );

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
        error.code || error.message
      );

      res.status(503).json({
        message: "Unable to check your login. Try again.",
      });
    }
  });

  // Read the signed-in user's profile.
  app.get("/api/me", async (req, res) => {
    const snapshot = await db
      .collection("users")
      .doc(req.account.uid)
      .get();

    if (!snapshot.exists) {
      return res.status(404).json({
        message: "Profile not found.",
      });
    }

    const data = snapshot.data();

    res.json({
      user: {
        id: req.account.uid,
        email: req.account.email || "",
        fullName: data.fullName,
        area: data.area,
        interests: data.interests,
        joinedAt: data.joinedAt,
      },
    });
  });

  // Create or update the signed-in user's profile.
  app.put("/api/me", async (req, res) => {
    const input = req.body;

    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      return res.status(400).json({
        message: "Enter your profile details.",
      });
    }

    const {
      fullName,
      area = "",
      interests = [],
    } = input;

    if (
      typeof fullName !== "string" ||
      fullName.trim().length < 2 ||
      fullName.trim().length > 80 ||
      typeof area !== "string" ||
      area.trim().length > 120 ||
      !Array.isArray(interests) ||
      interests.length > 150 ||
      interests.some(
        (item) =>
          typeof item !== "string" ||
          item.trim().length < 1 ||
          item.trim().length > 80
      )
    ) {
      return res.status(400).json({
        message: "Check your name, area and interests.",
      });
    }

    // The ID comes from Firebase, never from the request body.
    const reference = db
      .collection("users")
      .doc(req.account.uid);

    const user = await db.runTransaction(
      async (transaction) => {
        const snapshot = await transaction.get(reference);
        const previous = snapshot.exists
          ? snapshot.data()
          : {};

        const profile = {
          id: req.account.uid,
          email: req.account.email || "",
          fullName: fullName.trim(),
          area: area.trim(),
          interests: [
            ...new Set(
              interests.map((item) => item.trim())
            ),
          ],
          joinedAt:
            previous.joinedAt || new Date().toISOString(),
        };

        transaction.set(reference, profile, {
          merge: true,
        });

        return profile;
      }
    );

    res.json({ user });
  });

installMessagingRoutes(app, db);
installEventRoutes(app, db);

  app.use((_req, res) => {
    res.status(404).json({
      message: "Endpoint not found.",
    });
  });

  app.use((error, _req, res, _next) => {
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
      error.code || error.message
    );

    res.status(500).json({
      message: "Something went wrong. Try again.",
    });
  });

  return app;
}

async function start() {
  const credentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (
    !credentialsPath ||
    !existsSync(credentialsPath)
  ) {
    throw new Error(
      "Check GOOGLE_APPLICATION_CREDENTIALS in your .env file."
    );
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error(
      "Set FIREBASE_PROJECT_ID in your .env file."
    );
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

  const server = app.listen(
    port,
    "127.0.0.1",
    () => {
      console.log("Firestore connection OK");
      console.log(
        `ReIdentify backend running at http://localhost:${port}`
      );
    }
  );

  server.on("error", (error) => {
    console.error(
      "Server could not listen:",
      error.message
    );

    process.exit(1);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(
      "Backend could not start:",
      error.message
    );

    process.exit(1);
  });
}

module.exports = { createApp };