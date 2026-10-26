const { createHash } = require("node:crypto");
const { Timestamp, FieldPath } = require("firebase-admin/firestore");
const { mapCellFor } = require("./map-geography");

const ALLOWED_INTERESTS = new Set([
  "Walking",
  "Hiking",
  "Cycling",
  "Swimming",
  "Yoga",
  "Tai Chi",
  "Fitness/exercise",
  "Stretching",
  "Dancing",
  "Tennis",
  "Pickleball",
  "Golf",
  "Bowling",
  "Table tennis",
  "Badminton",
  "Fishing",
  "Gardening",
  "Birdwatching",
  "Nature outings",
  "Park visits",
  "Cards",
  "Chess",
  "Mahjong",
  "Bingo",
  "Board games",
  "Dominoes",
  "Puzzles",
  "Trivia",
  "Billiards/pool",
  "Darts",
  "Video games",
  "Social clubs",
  "Painting/drawing",
  "Knitting/crochet",
  "Sewing/quilting",
  "Woodworking",
  "Pottery/ceramics",
  "Photography",
  "Scrapbooking",
  "Jewelry making",
  "Calligraphy",
  "General crafts",
  "Flower arranging",
  "Singing",
  "Choir",
  "Playing an instrument",
  "Listening to music",
  "Concerts",
  "Movies",
  "Theatre",
  "Karaoke",
  "Comedy",
  "Dancing/social dance",
  "Storytelling/poetry",
  "Coffee/tea",
  "Dining out",
  "Cooking",
  "Baking",
  "Potlucks",
  "Picnics",
  "Brunch",
  "Food markets",
  "Community meals",
  "Reading",
  "Book clubs",
  "Writing",
  "History",
  "Languages",
  "Computers/technology",
  "Genealogy",
  "Museums",
  "Lectures/classes",
  "Collecting",
  "DIY/home projects",
  "Travel",
  "Astronomy/stargazing",
  "Volunteering",
  "Mentoring/tutoring",
  "Charity activities",
  "Community events",
  "Neighbourhood groups",
  "Environmental cleanup",
  "Food bank/community service",
  "Animal-related volunteering",
  "Religious/spiritual activities",
  "Cultural events",
  "Cultural groups",
  "Meditation",
  "Local festivals",
  "Heritage activities",
  "Current-events discussion",
  "Conversation/social meetups",
]);
const DAY = 86400000;
const INACTIVE_DAYS = 45;
const WARNING_DAYS = 7;
const validId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const normalize = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const milliseconds = (v) => (v?.toMillis ? v.toMillis() : Date.parse(v || ""));
const membershipRef = (db, gid, uid) =>
  db.collection("groupMemberships").doc(hash(gid, uid));

function blockRefs(db, uid, peer) {
  return [
    db.collection("contactBlocks").doc(hash(uid, peer)),
    db.collection("contactBlocks").doc(hash(peer, uid)),
  ];
}

async function assertCanContact(db, uid, peer, transaction) {
  const docs = await Promise.all(
    blockRefs(db, uid, peer).map((ref) =>
      transaction ? transaction.get(ref) : ref.get(),
    ),
  );
  if (docs.some((doc) => doc.exists))
    fail(403, "Direct contact between these members is blocked.");
}

function groupData(snapshot) {
  if (!snapshot.exists) fail(404, "Group not found.");
  const data = snapshot.data();
  if (data.status !== "active") fail(410, "This group has closed.");
  return data;
}

function memberData(snapshot) {
  if (!snapshot.exists) fail(403, "Join this group to participate.");
  return snapshot.data();
}

function expiry(activity, eventEnd = 0) {
  return new Date(
    Math.max(milliseconds(activity), eventEnd || 0) + INACTIVE_DAYS * DAY,
  ).toISOString();
}

function futureEnd(docs, now) {
  return docs.reduce((end, doc) => {
    const event = doc.data();
    const value = milliseconds(event.endsAt);
    return event.status === "published" && value > now
      ? Math.max(end, value)
      : end;
  }, 0);
}

function summary(id, g, member, now) {
  const deleteAfter = g.deleteAfter;
  return {
    id,
    name: g.name,
    area: g.area,
    description: g.description,
    interests: g.interests,
    memberCount: g.memberCount,
    createdAt: g.createdAt,
    lastActivityAt: g.lastActivityAt,
    deleteAfter,
    warning: milliseconds(deleteAfter) <= now + WARNING_DAYS * DAY,
    preview: member ? g.preview || "Start a conversation" : "",
    revision: g.revision || 0,
    sequence: g.sequence || 0,
    joined: !!member,
    muted: !!member?.muted,
    hiddenMembers: member?.hiddenMembers || [],
    unreadCount:
      member && !member.muted
        ? Math.max(0, (g.sequence || 0) - (member.lastReadSequence || 0))
        : 0,
  };
}

// Memberships and events are outside the group document and must be removed too.
// The group is locked as "deleting" before this function is called.
async function purgeGroup(db, id) {
  for (const collection of ["groupMemberships", "events"]) {
    for (;;) {
      const page = await db
        .collection(collection)
        .where("groupId", "==", id)
        .limit(100)
        .get();
      if (page.empty) break;
      for (const doc of page.docs) await db.recursiveDelete(doc.ref);
    }
  }
  const ref = db.collection("groups").doc(id);
  // Keep the locked parent until message cleanup finishes, so partial failures retry safely.
  await db.recursiveDelete(ref.collection("messages"));
  await ref.delete();
}

async function sweepInactiveGroups(db, now = Date.now()) {
  // A stable cursor lets later groups progress even when one deletion fails.
  let cursor;
  for (;;) {
    let query = db
      .collection("groups")
      .where("deleteAfter", "<=", new Date(now).toISOString())
      .orderBy("deleteAfter")
      .orderBy(FieldPath.documentId())
      .limit(30);
    if (cursor) query = query.startAfter(...cursor);
    const page = await query.get();
    if (page.empty) break;
    const last = page.docs[page.docs.length - 1];
    cursor = [last.data().deleteAfter, last.id];
    for (const doc of page.docs) {
      try {
        const remove = await db.runTransaction(async (tx) => {
          const current = await tx.get(doc.ref);
          if (!current.exists) return false;
          const g = current.data();
          if (g.status === "deleting") {
            tx.set(db.collection("deletedGroupIds").doc(doc.id), {
              deletedAt: new Date(now).toISOString(),
            });
            return true;
          }
          const events = await tx.get(
            db.collection("events").where("groupId", "==", doc.id),
          );
          const end = futureEnd(events.docs, now);
          const deadline = expiry(
            g.lastActivityAt || g.createdAt,
            Math.max(end, milliseconds(g.lastEventEnd) || 0),
          );
          if (milliseconds(deadline) > now) {
            tx.update(doc.ref, { deleteAfter: deadline });
            return false;
          }
          tx.set(db.collection("deletedGroupIds").doc(doc.id), {
            deletedAt: new Date(now).toISOString(),
          });
          tx.update(doc.ref, { status: "deleting" });
          return true;
        });
        if (remove) await purgeGroup(db, doc.id);
      } catch (error) {
        console.error("Group cleanup failed:", doc.id, error.message);
      }
    }
    if (page.size < 30) break;
  }
}

function startGroupCleanup(db) {
  let busy = false;
  async function run() {
    if (busy) return;
    busy = true;
    try {
      await sweepInactiveGroups(db);
    } catch (error) {
      console.error("Group cleanup:", error.message);
    } finally {
      busy = false;
    }
  }
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

function installGroupRoutes(app, db, { clock = Date.now } = {}) {
  const groups = db.collection("groups");
  const memberships = db.collection("groupMemberships");
  const events = db.collection("events");
  const users = db.collection("users");
  const route = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      error.status
        ? res.status(error.status).json({ message: error.message })
        : next(error);
    }
  };
  function ref(id) {
    if (!validId(id)) fail(400, "Invalid group.");
    return groups.doc(id);
  }
  async function access(id, uid, tx) {
    const reference = ref(id),
      memberRef = membershipRef(db, id, uid);
    const [g, m] = await Promise.all([
      tx ? tx.get(reference) : reference.get(),
      tx ? tx.get(memberRef) : memberRef.get(),
    ]);
    return {
      ref: reference,
      memberRef,
      group: groupData(g),
      member: m.exists ? m.data() : null,
    };
  }
  const text = (v, min, max, label) => {
    if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
      fail(400, label);
    return v.trim();
  };
  function activityPatch(
    g,
    now,
    lastEventEnd = milliseconds(g.lastEventEnd) || 0,
  ) {
    const lastActivityAt = new Date(
      Math.max(now, milliseconds(g.lastActivityAt) || 0),
    ).toISOString();
    return {
      lastActivityAt,
      lastEventEnd: lastEventEnd ? new Date(lastEventEnd).toISOString() : null,
      deleteAfter: expiry(lastActivityAt, lastEventEnd),
    };
  }

  app.get(
    "/api/groups/mine",
    route(async (req, res) => {
      const mine = await memberships.where("uid", "==", req.account.uid).get();
      const values = await Promise.all(
        mine.docs.map(async (doc) => {
          const m = doc.data(),
            g = await groups.doc(m.groupId).get();
          return g.exists && g.data().status === "active"
            ? summary(g.id, g.data(), m, clock())
            : null;
        }),
      );
      res.json({
        groups: values
          .filter(Boolean)
          .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      });
    }),
  );

  app.get(
    "/api/groups",
    route(async (req, res) => {
      const words = normalize(req.query.search)
        .slice(0, 150)
        .split(/\s+/)
        .filter(Boolean);
      const area = normalize(req.query.area).slice(0, 120);
      // An unchecked interest filter sends "". It must mean no filter, not [""].
      const tags = new Set(
        (typeof req.query.interests === "string"
          ? req.query.interests.split("|").slice(0, 150)
          : []
        )
          .map(normalize)
          .filter(Boolean),
      );
      let cursor = req.query.cursor;
      if (cursor !== undefined && !validId(cursor))
        fail(400, "Invalid group page.");
      const found = [];
      let more = true,
        scanned = 0;
      while (found.length < 20 && more && scanned < 1000) {
        let query = groups
          .where("status", "==", "active")
          .orderBy(FieldPath.documentId())
          .limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        more = page.size === 100;
        for (let i = 0; i < page.docs.length; i++) {
          const doc = page.docs[i],
            g = doc.data();
          cursor = doc.id;
          scanned++;
          const searchable = normalize(
            [g.name, g.description, g.area, ...(g.interests || [])].join(" "),
          );
          if (
            !words.every((word) => searchable.includes(word)) ||
            (area && !normalize(g.area).includes(area)) ||
            (tags.size && !g.interests?.some((tag) => tags.has(normalize(tag))))
          )
            continue;
          const m = await membershipRef(db, doc.id, req.account.uid).get();
          found.push(summary(doc.id, g, m.exists ? m.data() : null, clock()));
          if (found.length === 20) {
            more = i < page.docs.length - 1 || more;
            break;
          }
        }
      }
      res.json({ groups: found, nextCursor: more ? cursor : null });
    }),
  );

  app.post(
    "/api/groups",
    route(async (req, res) => {
      const body = req.body || {},
        uid = req.account.uid;
      // Client supplies a random ID so retries cannot create duplicate groups.
      const reference = ref(body.id);
      const name = text(
        body.name,
        3,
        80,
        "Enter a group name of 3–80 characters.",
      );
      if (
        !Array.isArray(body.interests) ||
        body.interests.length !== 1 ||
        !ALLOWED_INTERESTS.has(body.interests[0])
      )
        fail(400, "Choose exactly one activity for this group.");
      const interests = [body.interests[0]];
      const result = await db.runTransaction(async (tx) => {
        const [existing, profile, deleted] = await Promise.all([
          tx.get(reference),
          tx.get(users.doc(uid)),
          tx.get(db.collection("deletedGroupIds").doc(reference.id)),
        ]);
        if (!profile.exists)
          fail(404, "Your profile is not ready. Open Profile and try again.");
        if (existing.exists) {
          const g = groupData(existing);
          if (
            g.creatorId !== uid ||
            g.name !== name ||
            JSON.stringify(g.interests) !== JSON.stringify(interests)
          )
            fail(409, "Group ID already used.");
          return g;
        }
        if (deleted.exists)
          fail(410, "This group was deleted. Start a new group instead.");
        // There is no location field in this form. Use a saved profile area if
        // available; Ontario is a broad fallback, not the user's GPS location.
        const profileArea = profile.data().area;
        const area =
          typeof profileArea === "string" && profileArea.trim()
            ? profileArea.trim().slice(0, 120)
            : "Ontario";
        const now = new Date(clock()).toISOString();
        const g = {
          name,
          area,
          description: "",
          interests,
          creatorId: uid,
          createdAt: now,
          lastActivityAt: now,
          lastEventEnd: null,
          deleteAfter: expiry(now),
          memberCount: 1,
          status: "active",
          sequence: 0,
          revision: 0,
          preview: "",
        };
        tx.create(reference, g);
        tx.create(membershipRef(db, reference.id, uid), {
          groupId: reference.id,
          uid,
          joinedAt: now,
          muted: false,
          hiddenMembers: [],
          lastReadSequence: 0,
        });
        return g;
      });
      const member = await membershipRef(db, reference.id, uid).get();
      res.json({
        group: summary(
          reference.id,
          result,
          member.exists ? member.data() : null,
          clock(),
        ),
      });
    }),
  );

  app.get(
    "/api/groups/:id",
    route(async (req, res) => {
      const value = await access(req.params.id, req.account.uid);
      res.json({
        group: summary(value.ref.id, value.group, value.member, clock()),
        canDelete:
          value.group.creatorId === req.account.uid &&
          value.group.memberCount === 1 &&
          !!value.member,
      });
    }),
  );

  app.post(
    "/api/groups/:id/join",
    route(async (req, res) => {
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        const profile = await tx.get(users.doc(req.account.uid));
        if (!profile.exists) fail(404, "Your member profile is not ready.");
        if (v.member) return;
        tx.create(v.memberRef, {
          groupId: v.ref.id,
          uid: req.account.uid,
          joinedAt: new Date(clock()).toISOString(),
          muted: false,
          hiddenMembers: [],
          lastReadSequence: v.group.sequence,
        });
        tx.update(v.ref, { memberCount: v.group.memberCount + 1 });
      });
      res.json({ joined: true });
    }),
  );

  app.post(
    "/api/groups/:id/leave",
    route(async (req, res) => {
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) return;
        const last = v.group.memberCount === 1;
        const scheduled = last
          ? await tx.get(events.where("groupId", "==", v.ref.id))
          : null;
        tx.delete(v.memberRef);
        tx.update(v.ref, {
          memberCount: Math.max(0, v.group.memberCount - 1),
          ...(last
            ? {
                status: "closed",
                lastEventEnd: null,
                deleteAfter: expiry(v.group.lastActivityAt),
              }
            : {}),
        });
        if (scheduled)
          for (const event of scheduled.docs) {
            if (
              event.data().status === "published" &&
              milliseconds(event.data().endsAt) > clock()
            ) {
              tx.update(event.ref, { status: "cancelled" });
            }
          }
      });
      res.json({ left: true });
    }),
  );

  app.post(
    "/api/groups/:id/delete",
    route(async (req, res) => {
      const reference = ref(req.params.id);
      const claimed = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(reference);
        if (!snapshot.exists) return false;
        const g = snapshot.data();
        if (g.creatorId !== req.account.uid || g.memberCount !== 1)
          fail(
            403,
            "Only the creator can delete a group while they are its only member.",
          );
        const m = await tx.get(
          membershipRef(db, reference.id, req.account.uid),
        );
        memberData(m);
        tx.set(db.collection("deletedGroupIds").doc(reference.id), {
          deletedAt: new Date(clock()).toISOString(),
        });
        tx.update(reference, {
          status: "deleting",
          deleteAfter: new Date(clock()).toISOString(),
        });
        return true;
      });
      if (claimed) await purgeGroup(db, reference.id);
      res.json({ deleted: true });
    }),
  );

  app.put(
    "/api/groups/:id/preferences",
    route(async (req, res) => {
      const input = req.body || {};
      if (input.muted !== undefined && typeof input.muted !== "boolean")
        fail(400, "Choose a valid mute setting.");
      if (
        input.hiddenMemberId !== undefined &&
        (!validId(input.hiddenMemberId) ||
          typeof input.hidden !== "boolean" ||
          input.hiddenMemberId === req.account.uid)
      )
        fail(400, "Choose another member.");
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group first.");
        if (
          input.clearHidden !== undefined &&
          typeof input.clearHidden !== "boolean"
        )
          fail(400, "Invalid message visibility setting.");
        const hidden = new Set(
          input.clearHidden ? [] : v.member.hiddenMembers || [],
        );
        if (input.hiddenMemberId)
          input.hidden
            ? hidden.add(input.hiddenMemberId)
            : hidden.delete(input.hiddenMemberId);
        if (hidden.size > 1000) fail(400, "Too many hidden members.");
        tx.update(v.memberRef, {
          hiddenMembers: [...hidden],
          muted: input.muted ?? v.member.muted,
        });
      });
      res.json({ saved: true });
    }),
  );

  app.get(
    "/api/groups/:id/members",
    route(async (req, res) => {
      const v = await access(req.params.id, req.account.uid);
      if (!v.member) fail(403, "Join this group first.");
      let query = memberships
        .where("groupId", "==", v.ref.id)
        .orderBy(FieldPath.documentId())
        .limit(51);
      if (req.query.cursor) {
        if (!validId(req.query.cursor)) fail(400, "Invalid member page.");
        query = query.startAfter(req.query.cursor);
      }
      const page = await query.get();
      const docs = page.docs.slice(0, 50);
      const members = await Promise.all(
        docs.map(async (doc) => {
          const m = doc.data(),
            profile = await users.doc(m.uid).get();
          const block = await blockRefs(db, req.account.uid, m.uid)[0].get();
          return {
            id: m.uid,
            name: profile.data()?.fullName || "Member",
            area: profile.data()?.area || "",
            hidden: v.member.hiddenMembers?.includes(m.uid) || false,
            blocked: block.exists,
          };
        }),
      );
      res.json({
        members,
        nextCursor: page.size > 50 ? docs[docs.length - 1].id : null,
      });
    }),
  );

  app.get(
    "/api/contact-blocks",
    route(async (req, res) => {
      const blocked = await db
        .collection("contactBlocks")
        .where("ownerId", "==", req.account.uid)
        .get();
      const people = await Promise.all(
        blocked.docs.map(async (doc) => {
          const id = doc.data().targetId,
            profile = await users.doc(id).get();
          return { id, name: profile.data()?.fullName || "Member" };
        }),
      );
      res.json({ people });
    }),
  );

  app.post(
    "/api/contact-blocks",
    route(async (req, res) => {
      const { targetId, blocked } = req.body || {};
      if (
        !validId(targetId) ||
        targetId === req.account.uid ||
        typeof blocked !== "boolean"
      )
        fail(400, "Choose another member.");
      const reference = blockRefs(db, req.account.uid, targetId)[0];
      if (blocked) {
        if (!(await users.doc(targetId).get()).exists)
          fail(404, "Member not found.");
        await reference.set({
          ownerId: req.account.uid,
          targetId,
          createdAt: new Date(clock()).toISOString(),
        });
      } else await reference.delete();
      res.json({ blocked });
    }),
  );

  app.get(
    "/api/groups/:id/messages",
    route(async (req, res) => {
      const v = await access(req.params.id, req.account.uid);
      if (!v.member) fail(403, "Join this group to read its messages.");
      const { before, revision } = req.query;
      if (before !== undefined && revision !== undefined)
        fail(400, "Choose one message page.");
      for (const value of [before, revision])
        if (
          value !== undefined &&
          (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        )
          fail(400, "Invalid message page.");
      let query = v.ref.collection("messages");
      if (revision !== undefined)
        query = query
          .where("revision", ">", Number(revision))
          .orderBy("revision");
      else {
        query = query.orderBy("sequence", "desc");
        if (before !== undefined) query = query.startAfter(Number(before));
      }
      const page = await query.limit(51).get();
      const docs = page.docs.slice(0, 50);
      const messages = docs.map((doc) => {
        const { originalText, ...message } = doc.data();
        return { ...message, id: doc.id };
      });
      if (revision === undefined) messages.reverse();
      const syncedRevision =
        revision === undefined
          ? v.group.revision
          : Math.max(Number(revision), ...messages.map((m) => m.revision));
      res.json({
        group: summary(v.ref.id, v.group, v.member, clock()),
        messages,
        revision: syncedRevision,
        moreChanges: revision !== undefined && page.size > 50,
        nextBefore:
          revision === undefined && page.size > 50
            ? docs[docs.length - 1].data().sequence
            : null,
      });
    }),
  );

  app.post(
    "/api/groups/:id/messages",
    route(async (req, res) => {
      const body = req.body || {};
      if (!validId(body.id)) fail(400, "Invalid message ID.");
      const content = text(
        body.text,
        1,
        2000,
        "Enter a message of up to 2,000 characters.",
      );
      const message = await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group to send messages.");
        const messageRef = v.ref.collection("messages").doc(body.id);
        const [existing, profile] = await Promise.all([
          tx.get(messageRef),
          tx.get(users.doc(req.account.uid)),
        ]);
        if (existing.exists) {
          const m = existing.data();
          if (m.senderId !== req.account.uid || m.originalText !== content)
            fail(409, "Message ID already used.");
          return { ...m, id: body.id, originalText: undefined };
        }
        const now = new Date(clock()).toISOString();
        const m = {
          senderId: req.account.uid,
          senderName: profile.data()?.fullName || "Member",
          text: content,
          originalText: content,
          createdAt: now,
          editedAt: null,
          deleted: false,
          sequence: v.group.sequence + 1,
          revision: v.group.revision + 1,
        };
        tx.create(messageRef, m);
        tx.update(v.ref, {
          ...activityPatch(v.group, clock()),
          sequence: m.sequence,
          revision: m.revision,
          preview: content,
        });
        tx.update(v.memberRef, { lastReadSequence: m.sequence });
        const { originalText, ...publicMessage } = m;
        return { ...publicMessage, id: body.id };
      });
      res.json({ message });
    }),
  );

  // Sent group messages cannot be edited or individually removed.
  app.post(
    "/api/groups/:id/read",
    route(async (req, res) => {
      const sequence = req.body?.sequence;
      if (!Number.isSafeInteger(sequence) || sequence < 0)
        fail(400, "Invalid read marker.");
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group first.");
        tx.update(v.memberRef, {
          lastReadSequence: Math.max(
            v.member.lastReadSequence || 0,
            Math.min(sequence, v.group.sequence),
          ),
        });
      });
      res.json({ read: true });
    }),
  );

  app.post(
    "/api/groups/:id/reports",
    route(async (req, res) => {
      const { messageId, memberId, reason, details = "" } = req.body || {};
      if (
        !!messageId === !!memberId ||
        (messageId && !validId(messageId)) ||
        (memberId && !validId(memberId)) ||
        ![
          "Harassment",
          "Scam or spam",
          "Private information",
          "Other",
        ].includes(reason)
      )
        fail(400, "Choose a message or member and a reason.");
      text(details, 0, 1000, "Keep the report within 1,000 characters.");
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group first.");
        const target = messageId
          ? await tx.get(v.ref.collection("messages").doc(messageId))
          : await tx.get(membershipRef(db, v.ref.id, memberId));
        if (!target.exists) fail(404, "The reported item was not found.");
        const targetId = messageId ? target.data().senderId : memberId;
        if (targetId === req.account.uid)
          fail(400, "Choose another member's content.");
        const reference = db
          .collection("groupReports")
          .doc(hash(v.ref.id, req.account.uid, messageId || memberId, reason));
        const existing = await tx.get(reference);
        if (!existing.exists)
          tx.create(reference, {
            groupId: v.ref.id,
            groupName: v.group.name,
            reporterId: req.account.uid,
            memberId: targetId,
            messageId: messageId || null,
            messageText: messageId ? target.data().text : null,
            reason,
            details: details.trim(),
            createdAt: new Date(clock()).toISOString(),
            status: "open",
          });
        else
          tx.update(reference, {
            latestDetails: details.trim(),
            lastReportedAt: new Date(clock()).toISOString(),
            status: "open",
          });
      });
      res.json({ reported: true });
    }),
  );

  app.get(
    "/api/groups/:id/events",
    route(async (req, res) => {
      const v = await access(req.params.id, req.account.uid);
      if (!v.member) fail(403, "Join this group first.");
      const snapshot = await events.where("groupId", "==", v.ref.id).get();
      res.json({
        events: snapshot.docs
          .map((doc) => ({
            ...doc.data(),
            id: doc.id,
            startsAt: new Date(milliseconds(doc.data().startsAt)).toISOString(),
            endsAt: new Date(milliseconds(doc.data().endsAt)).toISOString(),
          }))
          .filter(
            (e) => e.status === "published" && Date.parse(e.endsAt) > clock(),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      });
    }),
  );

  app.post(
    "/api/groups/:id/events",
    route(async (req, res) => {
      const b = req.body || {};
      if (!validId(b.id)) fail(400, "Invalid event.");
      const title = text(b.title, 3, 120, "Enter an event title.");
      const location = text(
        b.location,
        3,
        200,
        "Enter a public venue and address.",
      );
      const description = text(
        b.description || "",
        0,
        2000,
        "Keep the description within 2,000 characters.",
      );
      const start = Date.parse(b.startsAt),
        end = Date.parse(b.endsAt);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= clock() ||
        start > clock() + 366 * DAY ||
        end <= start ||
        end - start > 7 * DAY ||
        !Number.isFinite(b.latitude) ||
        !Number.isFinite(b.longitude) ||
        Math.abs(b.latitude) > 90 ||
        Math.abs(b.longitude) > 180 ||
        b.publicVenueConfirmed !== true
      )
        fail(
          400,
          "Check the event time and confirm its public meeting location.",
        );
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group to organize an event.");
        const reference = events.doc(hash(v.ref.id, b.id));
        const [old, all] = await Promise.all([
          tx.get(reference),
          tx.get(events.where("groupId", "==", v.ref.id)),
        ]);
        if (
          start <= clock() &&
          (!old.exists || start !== milliseconds(old.data().startsAt))
        )
          fail(400, "Choose a future start time for a new event.");
        if (old.exists && old.data().creatorId !== req.account.uid)
          fail(403, "You can change only your own events.");
        const data = {
          title,
          location,
          description,
          latitude: b.latitude,
          longitude: b.longitude,
          mapCell: mapCellFor(b.latitude, b.longitude),
          startsAt: Timestamp.fromMillis(start),
          endsAt: Timestamp.fromMillis(end),
          status: "published",
          groupId: v.ref.id,
          creatorId: req.account.uid,
          interests: v.group.interests,
          requestId: b.id,
          updatedAt: new Date(clock()).toISOString(),
        };
        const latestEnd = Math.max(
          end,
          futureEnd(
            all.docs.filter((d) => d.id !== reference.id),
            clock(),
          ),
        );
        tx.set(reference, data);
        tx.update(v.ref, activityPatch(v.group, clock(), latestEnd));
      });
      res.json({ saved: true });
    }),
  );

  app.post(
    "/api/groups/:id/events/:eventId/cancel",
    route(async (req, res) => {
      if (!validId(req.params.eventId)) fail(400, "Invalid event.");
      await db.runTransaction(async (tx) => {
        const v = await access(req.params.id, req.account.uid, tx);
        if (!v.member) fail(403, "Join this group first.");
        const reference = events.doc(req.params.eventId);
        const [old, all] = await Promise.all([
          tx.get(reference),
          tx.get(events.where("groupId", "==", v.ref.id)),
        ]);
        if (!old.exists || old.data().groupId !== v.ref.id)
          fail(404, "Event not found.");
        if (old.data().creatorId !== req.account.uid)
          fail(403, "You can cancel only your own events.");
        tx.update(reference, { status: "cancelled" });
        tx.update(
          v.ref,
          activityPatch(
            v.group,
            clock(),
            futureEnd(
              all.docs.filter((d) => d.id !== reference.id),
              clock(),
            ),
          ),
        );
      });
      res.json({ cancelled: true });
    }),
  );
}

module.exports = {
  installGroupRoutes,
  startGroupCleanup,
  sweepInactiveGroups,
  assertCanContact,
  purgeGroup,
};