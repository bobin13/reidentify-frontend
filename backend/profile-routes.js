const express = require("express");
const { createHash, randomUUID } = require("node:crypto");
const { Buffer } = require("node:buffer");

const MAX_PHOTO = 200 * 1024;

const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validUuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );

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
  const aboutMe = data.aboutMe ?? data.about_me;
  const gender = data.gender;
  const profileVisibility = data.profileVisibility ?? data.profile_visibility;
  const photoVersion = data.photoVersion ?? data.photo_version;

  return {
    aboutMe:
      typeof aboutMe === "string"
        ? aboutMe.slice(0, 1000)
        : "",

    age:
      Number.isInteger(data.age) && data.age >= 1 && data.age <= 120
        ? data.age
        : null,

    gender: GENDERS.has(gender) ? gender : null,

    profileVisibility:
      profileVisibility === "public" ? "public" : "private",

    photoVersion:
      validId(photoVersion)
        ? photoVersion
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

  const interestsSql = `ARRAY(
    SELECT a.activity
    FROM user_activities ua
    JOIN activities a ON a.activity_id = ua.activity_id
    WHERE ua.user_id = u.id
    ORDER BY a.groupid, a.activity
  )`;

  // Clients identify people by Firebase UID; the UUID stays internal.
  function profileData(row) {
    return {
      id: row.firebase_uid,
      fullName: row.full_name,
      email: row.email || "",
      area: row.area || "",
      aboutMe: row.about_me || "",
      gender: row.gender,
      age: row.age,
      profileVisibility: row.profile_visibility,
      photoVersion: row.photo_version,
      interests: row.interests || [],
      joinedAt: row.joined_at,
      location:
        row.city_id == null
          ? null
          : {
              cityId: row.city_id,
              districtId: row.district_id,
            },
    };
  }

  function owner(row) {
    const data = profileData(row);
    return toOwner
      ? toOwner(
          { uid: row.firebase_uid, email: row.email || "" },
          { ...row, interests: data.interests },
        )
      : {
          id: row.firebase_uid,
          email: row.email || "",
          fullName: row.full_name,
          area: row.area || "",
          interests: row.interests || [],
          joinedAt: row.joined_at,
          ...profileExtras(data),
        };
  }

  async function profileByUid(uid) {
    const result = await db.query(
      `SELECT u.*, COALESCE(${interestsSql}, ARRAY[]::text[]) AS interests
       FROM users u
       WHERE u.firebase_uid = $1`,
      [uid],
    );
    return result.rows[0] || null;
  }

  // `viewer` is the signed-in user's UUID; `uid` is the requested Firebase UID.
  async function allowed(viewer, uid) {
    if (!validId(uid)) throw fail("Profile not found.", 404);
    const row = await profileByUid(uid);
    if (
      !row ||
      (row.id !== viewer && row.profile_visibility !== "public")
    ) {
      throw fail("Profile not found.", 404);
    }
    return row;
  }

  const handle = (fn) => async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");

    if (!req.account?.uid || !validUuid(req.userId)) {
      return res.status(401).json({ message: "Please sign in." });
    }
    req.userId = req.userId.toLowerCase();

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
            !validUuid(cursor.last) ||
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

        after = cursor.last.toLowerCase();
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

      const found = await db.query(
        `SELECT u.id, u.firebase_uid, u.full_name, u.area,
                COALESCE(${interestsSql}, ARRAY[]::text[]) AS interests
         FROM users u
         WHERE u.profile_visibility = 'public'
           AND u.id <> $1::uuid
           AND ($2::uuid IS NULL OR u.id > $2::uuid)
         ORDER BY u.id
         LIMIT 25`,
        [req.userId, after || null],
      );
      const words = queryText.split(" ").filter(Boolean);
      const people = [];

      for (const row of found.rows) {
        const interests = safeInterests({ interests: row.interests });

        if (
          row.id === req.userId ||
          typeof row.full_name !== "string"
        ) {
          continue;
        }

        const text = normalizeSearch(
          [
            row.full_name,
            typeof row.area === "string" ? row.area : "",
            ...interests,
          ].join(" "),
        );

        if (!words.every((word) => text.includes(word))) continue;

        people.push({
          id: row.firebase_uid,
          fullName: row.full_name,
          area: typeof row.area === "string" ? row.area : "",
          interests,
        });
      }

      const nextCursor =
        found.rows.length === 25
          ? Buffer.from(
              JSON.stringify({
                key,
                last: found.rows.at(-1).id,
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
      const row = await allowed(req.userId, req.params.uid);
      const profile = owner(row);

      res.json({
        profile: {
          id: profile.id,
          fullName: profile.fullName,
          area: profile.area,
          aboutMe: profile.aboutMe,
          age: profile.age,
          gender: profile.gender,
          profileVisibility: profile.profileVisibility,
          photoVersion: profile.photoVersion,
          interests: safeInterests({ interests: row.interests }),
        },
      });
    }),
  );

  app.get(
    "/api/profiles/:uid/photo",
    handle(async (req, res) => {
      const row = await allowed(req.userId, req.params.uid);
      const version = row.photo_version;

      if (!version || req.query.version !== version) {
        throw fail("Photo not found.", 404);
      }

      const key = `${row.id}:${version}`;
      let bytes;

      const saved = cache.get(key);

      if (saved && saved.expires > now()) {
        bytes = saved.bytes;
      } else {
        const result = await db.query(
          `SELECT version, mime_type, content
           FROM profile_photos
           WHERE user_id = $1::uuid`,
          [row.id],
        );
        const photo = result.rows[0];

        if (!photo || photo.version !== version) {
          throw fail("Photo not found.", 404);
        }

        if (photo.mime_type !== "image/jpeg" || !Buffer.isBuffer(photo.content)) {
          throw fail("Photo is unavailable.", 503);
        }

        bytes = photo.content;

        if (
          bytes.length < 4 ||
          bytes.length > MAX_PHOTO ||
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
    const client = await db.connect();
    const version = remove ? null : operation;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT u.*, COALESCE(${interestsSql}, ARRAY[]::text[]) AS interests
         FROM users u
         WHERE u.id = $1::uuid
         FOR UPDATE`,
        [uid],
      );
      const row = result.rows[0];

      if (!row) {
        throw fail("Save your profile before uploading a photo.", 404);
      }

      if (!remove && row.photo_version === operation) {
        const photoResult = await client.query(
          `SELECT mime_type, content FROM profile_photos WHERE user_id = $1::uuid`,
          [uid],
        );
        const savedPhoto = photoResult.rows[0];
        if (
          !savedPhoto ||
          savedPhoto.mime_type !== "image/jpeg" ||
          createHash("sha256").update(savedPhoto.content).digest("hex") !== hash
        ) {
          throw fail("Choose the photo again before uploading it.", 409);
        }

        await client.query("COMMIT");
        for (const key of cache.keys()) {
          if (key.startsWith(uid + ":")) cache.delete(key);
        }
        return owner(row);
      }

      if (remove) {
        await client.query(
          `DELETE FROM profile_photos WHERE user_id = $1::uuid`,
          [uid],
        );
      } else {
        await client.query(
          `INSERT INTO profile_photos (user_id, version, mime_type, content, updated_at)
           VALUES ($1::uuid, $2, 'image/jpeg', $3, $4)
           ON CONFLICT (user_id) DO UPDATE
           SET version = EXCLUDED.version,
               mime_type = EXCLUDED.mime_type,
               content = EXCLUDED.content,
               updated_at = EXCLUDED.updated_at`,
          [uid, version, jpeg, new Date(now())],
        );
      }

      const update = await client.query(
        `UPDATE users SET photo_version = $2 WHERE id = $1::uuid
         RETURNING *`,
        [uid, version],
      );
      await client.query("COMMIT");

      for (const key of cache.keys()) {
        if (key.startsWith(uid + ":")) cache.delete(key);
      }
      const updated = {
        ...row,
        ...update.rows[0],
        photo_version: version,
      };
      return owner(updated);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

  }

  const mutation = (remove) =>
    handle(async (req, res) => {
      const uid = req.userId;
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