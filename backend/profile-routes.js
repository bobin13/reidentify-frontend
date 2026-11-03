const express = require("express");
const { createHash, randomUUID } = require("node:crypto");

const MAX_PHOTO = 200 * 1024;

const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const normalizeSearch = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

const safeInterests = (data) =>
  Array.isArray(data.interests)
    ? data.interests
        .filter((value) => typeof value === "string" && value.length <= 80)
        .slice(0, 150)
    : [];

const GENDERS = new Set(["Woman", "Man", "Non-binary"]);

function profileExtras(data = {}) {
  return {
    aboutMe:
      typeof data.aboutMe === "string"
        ? data.aboutMe.slice(0, 1000)
        : "",

    age:
      Number.isInteger(data.age) && data.age >= 1 && data.age <= 120
        ? data.age
        : null,

    gender: GENDERS.has(data.gender) ? data.gender : null,

    profileVisibility:
      data.profileVisibility === "public" ? "public" : "private",

    photoVersion:
      data.photoStorage === "firestore" && validId(data.photoVersion)
        ? data.photoVersion
        : null,
  };
}

function profileChanges(input, previous = {}) {
  const extra = profileExtras(previous);

  if (Object.hasOwn(input, "aboutMe")) {
    if (
      typeof input.aboutMe !== "string" ||
      input.aboutMe.length > 1000
    ) {
      throw fail("Keep About me within 1,000 characters.");
    }

    extra.aboutMe = input.aboutMe.trim();
  }

  if (Object.hasOwn(input, "age")) {
    if (
      input.age !== null &&
      (!Number.isInteger(input.age) || input.age < 1 || input.age > 120)
    ) {
      throw fail("Enter an age from 1 to 120, or leave it blank.");
    }

    extra.age = input.age;
  }

  if (Object.hasOwn(input, "profileVisibility")) {
    if (!["public", "private"].includes(input.profileVisibility)) {
      throw fail("Choose whether your profile is public or private.");
    }

    extra.profileVisibility = input.profileVisibility;
  }

  if (Object.hasOwn(input, "gender")) {
    if (input.gender !== null && !GENDERS.has(input.gender)) {
      throw fail("Choose a gender from the list, or choose Not set.");
    }

    extra.gender = input.gender;
  }

  delete extra.photoVersion;

  return extra;
}

function cleanPhoto(text) {
  if (
    typeof text !== "string" ||
    text.length < 16 ||
    text.length > Math.ceil(MAX_PHOTO / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)
  ) {
    throw fail("Choose a photo smaller than 200 KB.");
  }

  const buffer = Buffer.from(text, "base64");

  if (
    buffer.length > MAX_PHOTO ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8
  ) {
    throw fail("Choose a JPEG photo.");
  }

  try {
    const jpeg = require("jpeg-js");

    const image = jpeg.decode(buffer, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: 1,
      maxMemoryUsageInMB: 16,
    });

    if (
      image.width < 1 ||
      image.height < 1 ||
      image.width > 512 ||
      image.height > 512
    ) {
      throw Error();
    }

    const result = Buffer.from(
      jpeg.encode(
        {
          width: image.width,
          height: image.height,
          data: image.data,
        },
        65,
      ).data,
    );

    if (result.length > MAX_PHOTO) throw Error();

    return result;
  } catch {
    throw fail("Choose a valid photo no larger than 512 by 512 pixels.");
  }
}

function installProfileRoutes(app, db, { toOwner, now = Date.now } = {}) {
  const cache = new Map();
  const active = new Map();
  const usage = new Map();

  let total = { at: now(), count: 0 };

  function budget(uid) {
    const clock = now();

    for (const [id, entry] of usage) {
      if (clock - entry.at >= 3600000) usage.delete(id);
    }

    if (clock - total.at >= 3600000) {
      total = { at: clock, count: 0 };
    }

    const entry = usage.get(uid) || { at: clock, count: 0 };

    if (
      entry.count >= 6 ||
      total.count >= 100 ||
      (usage.size >= 1000 && !usage.has(uid))
    ) {
      throw fail("Too many photo changes. Please try again later.", 429);
    }

    entry.count++;
    total.count++;
    usage.set(uid, entry);
  }

  const owned = (uid) => db.collection("users").doc(uid);
  const photoFor = (uid) => db.collection("profilePhotos").doc(uid);

  async function allowed(viewer, uid) {
    if (!validId(uid)) throw fail("Profile not found.", 404);

    const snapshot = await owned(uid).get();
    const data = snapshot.exists ? snapshot.data() : null;

    if (
      !data ||
      (viewer !== uid && profileExtras(data).profileVisibility !== "public")
    ) {
      throw fail("Profile not found.", 404);
    }

    return data;
  }

  const handle = (fn) => async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");

    if (!req.account?.uid) {
      return res.status(401).json({ message: "Please sign in." });
    }

    try {
      await fn(req, res);
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ message: error.message });
      } else {
        next(error);
      }
    }
  };

  const searches = new Map();
  let searchTotal = { at: now(), count: 0 };

  app.get(
    "/api/public-people",
    handle(async (req, res) => {
      if (
        (req.query.q !== undefined && typeof req.query.q !== "string") ||
        (req.query.q?.length || 0) > 100
      ) {
        throw fail("Use a search of 100 characters or fewer.");
      }

      const queryText = normalizeSearch(req.query.q || "");

      const key = createHash("sha256")
        .update(JSON.stringify([req.account.uid, queryText]))
        .digest("hex")
        .slice(0, 24);

      let after = "";

      if (req.query.cursor !== undefined) {
        let cursor;

        try {
          if (
            typeof req.query.cursor !== "string" ||
            req.query.cursor.length > 800 ||
            !/^[A-Za-z0-9_-]+$/.test(req.query.cursor)
          ) {
            throw Error();
          }

          cursor = JSON.parse(
            Buffer.from(req.query.cursor, "base64url").toString("utf8"),
          );

          if (
            !validId(cursor.last) ||
            cursor.key !== key ||
            !Number.isFinite(cursor.at) ||
            cursor.at > now() + 5000 ||
            now() - cursor.at > 600000
          ) {
            throw Error();
          }
        } catch {
          throw fail("This people search changed. Tap Refresh to start again.");
        }

        after = cursor.last;
      }

      for (const [id, entry] of searches) {
        if (now() - entry.at >= 60000) searches.delete(id);
      }

      if (now() - searchTotal.at >= 60000) {
        searchTotal = { at: now(), count: 0 };
      }

      const allowance = searches.get(req.account.uid) || {
        at: now(),
        count: 0,
      };

      if (
        allowance.count >= 30 ||
        searchTotal.count >= 120 ||
        (searches.size >= 1000 && !searches.has(req.account.uid))
      ) {
        throw fail("Please wait a moment before searching again.", 429);
      }

      allowance.count++;
      searchTotal.count++;
      searches.set(req.account.uid, allowance);

      let query = db
        .collection("users")
        .where("profileVisibility", "==", "public")
        .orderBy("__name__")
        .select("fullName", "area", "interests", "profileVisibility")
        .limit(25);

      if (after) query = query.startAfter(after);

      const found = await query.get();
      const words = queryText.split(" ").filter(Boolean);
      const people = [];

      for (const doc of found.docs) {
        const data = doc.data();

        if (
          doc.id === req.account.uid ||
          data.profileVisibility !== "public" ||
          typeof data.fullName !== "string"
        ) {
          continue;
        }

        const interests = safeInterests(data);

        const text = normalizeSearch(
          [
            data.fullName,
            typeof data.area === "string" ? data.area : "",
            ...interests,
          ].join(" "),
        );

        if (!words.every((word) => text.includes(word))) continue;

        people.push({
          id: doc.id,
          fullName: data.fullName,
          area: typeof data.area === "string" ? data.area : "",
          interests,
        });
      }

      const nextCursor =
        found.docs.length === 25
          ? Buffer.from(
              JSON.stringify({
                key,
                last: found.docs.at(-1).id,
                at: now(),
              }),
            ).toString("base64url")
          : null;

      res.json({ people, nextCursor });
    }),
  );

  app.get(
    "/api/profiles/:uid",
    handle(async (req, res) => {
      const data = await allowed(req.account.uid, req.params.uid);
      const owner = toOwner({ uid: req.params.uid }, data);

      res.json({
        profile: {
          id: owner.id,
          fullName: owner.fullName,
          area: owner.area,
          aboutMe: owner.aboutMe,
          age: owner.age,
          gender: owner.gender,
          profileVisibility: owner.profileVisibility,
          photoVersion: owner.photoVersion,
          interests: safeInterests(data),
        },
      });
    }),
  );

  app.get(
    "/api/profiles/:uid/photo",
    handle(async (req, res) => {
      const data = await allowed(req.account.uid, req.params.uid);
      const version = profileExtras(data).photoVersion;

      if (!version || req.query.version !== version) {
        throw fail("Photo not found.", 404);
      }

      const key = `${req.params.uid}:${version}`;
      let bytes;

      const saved = cache.get(key);

      if (saved && saved.expires > now()) {
        bytes = saved.bytes;
      } else {
        const snapshot = await photoFor(req.params.uid).get();
        const photo = snapshot.exists ? snapshot.data() : null;

        if (!photo || photo.version !== version) {
          throw fail("Photo not found.", 404);
        }

        if (
          photo.ownerId !== req.params.uid ||
          photo.contentType !== "image/jpeg" ||
          !(photo.jpeg instanceof Uint8Array)
        ) {
          throw fail("Photo is unavailable.", 503);
        }

        bytes = Buffer.from(photo.jpeg);

        if (
          bytes.length < 4 ||
          bytes.length > MAX_PHOTO ||
          photo.byteLength !== bytes.length ||
          bytes[0] !== 0xff ||
          bytes[1] !== 0xd8
        ) {
          throw fail("Photo is unavailable.", 503);
        }

        for (const [id, value] of cache) {
          if (value.expires <= now()) cache.delete(id);
        }

        if (cache.size >= 40) {
          cache.delete(cache.keys().next().value);
        }

        cache.set(key, {
          bytes,
          expires: now() + 300000,
        });
      }

      res.json({ jpeg: bytes.toString("base64") });
    }),
  );

  async function change(uid, operation, jpeg, remove, hash) {
    const ref = owned(uid);
    const photoRef = photoFor(uid);

    const version = remove ? null : randomUUID();
    const updatedAt = new Date(now());

    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);

      if (!snap.exists) {
        throw fail("Save your profile before uploading a photo.", 404);
      }

      const data = snap.data();

      if (
        !remove &&
        data.photoStorage === "firestore" &&
        data.photoRequestId === operation &&
        validId(data.photoVersion)
      ) {
        if (data.photoHash !== hash) {
          throw fail("Choose the photo again before uploading it.", 409);
        }

        return data;
      }

      if (data.photoLock?.until > now()) {
        throw fail("A photo change is already in progress. Please wait.", 409);
      }

      if (remove) {
        tx.delete(photoRef);
      } else {
        tx.set(photoRef, {
          ownerId: uid,
          contentType: "image/jpeg",
          jpeg,
          byteLength: jpeg.length,
          version,
          updatedAt,
        });
      }

      const changes = {
        photoStorage: remove ? null : "firestore",
        photoVersion: version,
        photoRequestId: remove ? null : operation,
        photoHash: remove ? null : hash,
        photoFileId: null,
        photoLock: null,
      };

      tx.set(ref, changes, { merge: true });

      return { ...data, ...changes };
    });

    for (const key of cache.keys()) {
      if (key.startsWith(uid + ":")) cache.delete(key);
    }

    return toOwner({ uid }, saved);
  }

  const mutation = (remove) =>
    handle(async (req, res) => {
      const uid = req.account.uid;
      const body = req.body;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw fail("Choose your photo again.");
      }

      const operation = remove ? randomUUID() : body.requestId;

      if (!validId(operation) || operation.length < 12) {
        throw fail("Choose your photo again.");
      }

      if (active.has(uid)) {
        throw fail("A photo change is already in progress. Please wait.", 409);
      }

      budget(uid);
      active.set(uid, true);

      try {
        const jpeg = remove ? null : cleanPhoto(body.jpeg);

        const hash = jpeg
          ? createHash("sha256").update(jpeg).digest("hex")
          : "";

        const user = await change(
          uid,
          operation,
          jpeg,
          remove,
          hash,
        );

        user.email = req.account.email || "";

        res.json({ user });
      } finally {
        active.delete(uid);
      }
    });

  app.post(
    "/api/me/photo",
    express.json({ limit: "300kb" }),
    mutation(false),
  );

  app.post("/api/me/photo/remove", mutation(true));
}

module.exports = {
  installProfileRoutes,
  profileExtras,
  profileChanges,
  cleanPhoto,
};