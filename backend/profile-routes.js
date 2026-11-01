const express = require("express");
const { createHash, randomUUID } = require("node:crypto");
const { createDrivePhotoStore } = require("./google-drive-photos");

const MAX_PHOTO = 200 * 1024;
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

function profileExtras(data = {}) {
  return {
    aboutMe:
      typeof data.aboutMe === "string" ? data.aboutMe.slice(0, 1000) : "",
    age:
      Number.isInteger(data.age) && data.age >= 1 && data.age <= 120
        ? data.age
        : null,
    profileVisibility:
      data.profileVisibility === "public" ? "public" : "private",
    photoVersion: validId(data.photoVersion) ? data.photoVersion : null,
  };
}

function profileChanges(input, previous = {}) {
  const extra = profileExtras(previous);
  if (Object.hasOwn(input, "aboutMe")) {
    if (typeof input.aboutMe !== "string" || input.aboutMe.length > 1000)
      throw fail("Keep About me within 1,000 characters.");
    extra.aboutMe = input.aboutMe.trim();
  }
  if (Object.hasOwn(input, "age")) {
    if (
      input.age !== null &&
      (!Number.isInteger(input.age) || input.age < 1 || input.age > 120)
    )
      throw fail("Enter an age from 1 to 120, or leave it blank.");
    extra.age = input.age;
  }
  if (Object.hasOwn(input, "profileVisibility")) {
    if (!["public", "private"].includes(input.profileVisibility))
      throw fail("Choose whether your profile is public or private.");
    extra.profileVisibility = input.profileVisibility;
  }
  // Photo references are controlled only by the authenticated photo routes.
  delete extra.photoVersion;
  return extra;
}

function cleanPhoto(text) {
  if (
    typeof text !== "string" ||
    text.length < 16 ||
    text.length > Math.ceil(MAX_PHOTO / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  )
    throw fail("Choose a photo smaller than 200 KB.");
  const buffer = Buffer.from(text, "base64");
  if (buffer.length > MAX_PHOTO || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    throw fail("Choose a JPEG photo.");
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
    )
      throw Error();
    // A fresh encoding strips location/EXIF and any other original metadata.
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

function installProfileRoutes(
  app,
  db,
  { toOwner, store = createDrivePhotoStore(), now = Date.now } = {},
) {
  const cache = new Map(),
    active = new Map(),
    usage = new Map();
  let total = { at: now(), count: 0 };
  function budget(uid) {
    const clock = now();
    for (const [id, entry] of usage)
      if (clock - entry.at >= 3600000) usage.delete(id);
    if (clock - total.at >= 3600000) total = { at: clock, count: 0 };
    const entry = usage.get(uid) || { at: clock, count: 0 };
    if (
      entry.count >= 6 ||
      total.count >= 100 ||
      (usage.size >= 1000 && !usage.has(uid))
    )
      throw fail("Too many photo changes. Please try again later.", 429);
    entry.count++;
    total.count++;
    usage.set(uid, entry);
  }
  const owned = (uid) => db.collection("users").doc(uid);
  async function allowed(viewer, uid) {
    if (!validId(uid)) throw fail("Profile not found.", 404);
    const snapshot = await owned(uid).get();
    const data = snapshot.exists ? snapshot.data() : null;
    if (
      !data ||
      (viewer !== uid && profileExtras(data).profileVisibility !== "public")
    )
      throw fail("Profile not found.", 404);
    return data;
  }
  const handle = (fn) => async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.account?.uid)
      return res.status(401).json({ message: "Please sign in." });
    try {
      await fn(req, res);
    } catch (error) {
      error.status
        ? res.status(error.status).json({ message: error.message })
        : next(error);
    }
  };
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
          profileVisibility: owner.profileVisibility,
          photoVersion: owner.photoVersion,
        },
      });
    }),
  );
  app.get(
    "/api/profiles/:uid/photo",
    handle(async (req, res) => {
      // Always check current permission before using a cached photo.
      const data = await allowed(req.account.uid, req.params.uid);
      const version = profileExtras(data).photoVersion;
      if (!version || !data.photoFileId || req.query.version !== version)
        throw fail("Photo not found.", 404);
      const key = `${req.params.uid}:${version}`;
      let bytes;
      const saved = cache.get(key);
      if (saved && saved.expires > now()) bytes = saved.bytes;
      else {
        bytes = await store.get(data.photoFileId);
        if (bytes.length > MAX_PHOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8)
          throw fail("Photo is unavailable.", 503);
        for (const [id, value] of cache)
          if (value.expires <= now()) cache.delete(id);
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, { bytes, expires: now() + 300000 });
      }
      res.json({ jpeg: bytes.toString("base64") });
    }),
  );

  async function change(uid, operation, jpeg, remove, hash) {
    const ref = owned(uid);
    let reservedId = null;
    const initial = await ref.get();
    if (!initial.exists)
      throw fail("Save your profile before uploading a photo.", 404);
    if (!remove && !initial.data().photoFileId)
      reservedId = await store.newId();
    let fileId,
      existing,
      repeated = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw fail("Profile not found.", 404);
      const data = snap.data();
      if (!remove && data.photoRequestId === operation && data.photoVersion) {
        if (data.photoHash !== hash)
          throw fail("Choose the photo again before uploading it.", 409);
        repeated = true;
        return;
      }
      if (data.photoLock?.until > now())
        throw fail("A photo change is already in progress. Please wait.", 409);
      fileId = data.photoFileId || reservedId;
      existing = !!data.photoVersion;
      if (!remove && !fileId) throw fail("Please retry the photo upload.", 409);
      tx.set(
        ref,
        {
          photoLock: { id: operation, until: now() + 60000 },
          ...(remove ? {} : { photoFileId: fileId }),
        },
        { merge: true },
      );
    });
    if (repeated) return toOwner({ uid }, (await ref.get()).data());
    try {
      if (remove) {
        if (fileId) await store.remove(fileId);
      } else await store.put(fileId, jpeg, existing, uid);
      const user = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref),
          data = snap.data();
        if (data?.photoLock?.id !== operation)
          throw fail("The photo changed. Please try again.", 409);
        const changes = {
          photoFileId: remove ? null : fileId,
          photoVersion: remove ? null : randomUUID(),
          photoRequestId: remove ? null : operation,
          photoHash: remove ? null : hash,
          photoLock: null,
        };
        tx.set(ref, changes, { merge: true });
        return toOwner({ uid }, { ...data, ...changes });
      });
      for (const key of cache.keys())
        if (key.startsWith(uid + ":")) cache.delete(key);
      return user;
    } finally {
      await db
        .runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (snap.data()?.photoLock?.id === operation)
            tx.set(ref, { photoLock: null }, { merge: true });
        })
        .catch(() => {});
    }
  }

  const mutation = (remove) =>
    handle(async (req, res) => {
      const uid = req.account.uid;
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw fail("Choose your photo again.");
      const operation = remove ? randomUUID() : body.requestId;
      if (!validId(operation) || operation.length < 12)
        throw fail("Choose your photo again.");
      if (active.has(uid))
        throw fail("A photo change is already in progress. Please wait.", 409);
      budget(uid);
      active.set(uid, true);
      try {
        const jpeg = remove ? null : cleanPhoto(body.jpeg);
        const hash = jpeg
          ? createHash("sha256").update(jpeg).digest("hex")
          : "";
        const user = await change(uid, operation, jpeg, remove, hash);
        // Email is supplied by Firebase Auth, never by the image request or Drive.
        user.email = req.account.email || "";
        res.json({ user });
      } finally {
        active.delete(uid);
      }
    });
  app.post("/api/me/photo", express.json({ limit: "300kb" }), mutation(false));
  app.post("/api/me/photo/remove", mutation(true));
}

module.exports = {
  installProfileRoutes,
  profileExtras,
  profileChanges,
  cleanPhoto,
};
