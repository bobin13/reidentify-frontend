const { assertCanContact } = require("./groups-routes");
const { createHash } = require("node:crypto");

function installMessagingRoutes(app, db) {
  const conversations = db.collection("conversations");
  const users = db.collection("users");

  const validId = (id) =>
    typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);

  function fail(status, message) {
    throw Object.assign(new Error(message), { status });
  }

  const route = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ message: error.message });
      } else {
        next(error);
      }
    }
  };

  function reference(id) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
      fail(400, "Invalid conversation.");
    }

    return conversations.doc(id);
  }

  function requireMember(snapshot, uid) {
    if (!snapshot.exists) {
      fail(404, "Conversation not found.");
    }

    const data = snapshot.data();

    if (!data.participants.includes(uid)) {
      fail(403, "You cannot access this conversation.");
    }

    return data;
  }

  async function summary(id, data, uid) {
    const peerId = data.participants.find((value) => value !== uid);
    const peer = await users.doc(peerId).get();

    return {
      id,
      name: peer.data()?.fullName || "Member",
      handle: peer.data()?.area || "",
      preview: data.lastMessage?.text || "Start a conversation",
      timestamp: data.updatedAt,
      unreadCount: data.unreadCounts[uid] || 0,
    };
  }

  // Registered members available for starting a conversation.
  app.get(
    "/api/people",
    route(async (req, res) => {
      const snapshot = await users.limit(100).get();

      const people = snapshot.docs
        .filter((doc) => doc.id !== req.account.uid)
        .map((doc) => ({
          id: doc.id,
          name: doc.data().fullName,
          area: doc.data().area || "",
        }));

      res.json({ people });
    }),
  );

  // Only conversations belonging to the signed-in user.
  app.get(
    "/api/conversations",
    route(async (req, res) => {
      const snapshot = await conversations
        .where("participants", "array-contains", req.account.uid)
        .get();

      const results = await Promise.all(
        snapshot.docs.map((doc) =>
          summary(doc.id, doc.data(), req.account.uid),
        ),
      );

      results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      res.json({ conversations: results });
    }),
  );

  // Start a direct conversation, or return the existing one.
  app.post(
    "/api/conversations",
    route(async (req, res) => {
      const uid = req.account.uid;
      const peerId = req.body?.peerId;

      if (!validId(peerId) || peerId === uid) {
        fail(400, "Choose another member.");
      }

      const participants = [uid, peerId].sort();
      const id = createHash("sha256")
        .update(JSON.stringify(participants))
        .digest("hex");

      const ref = conversations.doc(id);

      const data = await db.runTransaction(async (transaction) => {
        const [owner, peer, existing] = await Promise.all([
          transaction.get(users.doc(uid)),
          transaction.get(users.doc(peerId)),
          transaction.get(ref),
        ]);

        if (!owner.exists || !peer.exists) {
          fail(404, "Member profile not found.");
        }

        await assertCanContact(db, uid, peerId, transaction);

        if (existing.exists) {
          return requireMember(existing, uid);
        }

        const now = new Date().toISOString();

        const conversation = {
          participants,
          createdAt: now,
          updatedAt: now,
          lastMessage: null,
          unreadCounts: {
            [uid]: 0,
            [peerId]: 0,
          },
        };

        transaction.create(ref, conversation);
        return conversation;
      });

      res.json({
        conversation: await summary(id, data, uid),
      });
    }),
  );

  // Load recent messages, older history, or newly received messages.
  app.get(
    "/api/conversations/:id/messages",
    route(async (req, res) => {
      const ref = reference(req.params.id);
      const data = requireMember(await ref.get(), req.account.uid);
      const { before, after } = req.query;

      if (before !== undefined && after !== undefined) {
        fail(400, "Choose one message cursor.");
      }

      if (
        (before !== undefined && !validId(before)) ||
        (after !== undefined && !validId(after))
      ) {
        fail(400, "Invalid message cursor.");
      }

      if (after !== undefined && (data.lastMessage?.id || "none") === after) {
        return res.json({
          unchanged: true,
          needsRead: (data.unreadCounts[req.account.uid] || 0) > 0,
        });
      }

      const messages = ref.collection("messages");
      const incremental = after !== undefined;

      let query = messages.orderBy("createdAt", incremental ? "asc" : "desc");

      const cursorId = before || (after !== "none" ? after : null);

      if (cursorId) {
        const cursor = await messages.doc(cursorId).get();

        if (!cursor.exists) {
          fail(404, "Message cursor not found.");
        }

        query = query.startAfter(cursor);
      }

      const snapshot = await query.limit(51).get();
      const docs = snapshot.docs.slice(0, 50);

      const page = docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      }));

      if (!incremental) {
        page.reverse();
      }

      res.json({
        unchanged: false,
        conversation: await summary(ref.id, data, req.account.uid),
        messages: page,
        nextCursor:
          !incremental && snapshot.docs.length > 50
            ? docs[docs.length - 1].id
            : null,
        hasMoreNew: incremental && snapshot.docs.length > 50,
      });
    }),
  );

  // Save a message and update the recipient's unread count together.
  app.post(
    "/api/conversations/:id/messages",
    route(async (req, res) => {
      const ref = reference(req.params.id);
      const uid = req.account.uid;
      const { id, text } = req.body || {};

      if (
        !validId(id) ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 2000
      ) {
        fail(400, "Enter a message of up to 2,000 characters.");
      }

      const messageRef = ref.collection("messages").doc(id);

      const message = await db.runTransaction(async (transaction) => {
        const [conversation, existing] = await Promise.all([
          transaction.get(ref),
          transaction.get(messageRef),
        ]);

        const data = requireMember(conversation, uid);
        const contactId = data.participants.find((value) => value !== uid);
        await assertCanContact(db, uid, contactId, transaction);

        // Retrying the same request must not create a second message.
        if (existing.exists) {
          const saved = existing.data();

          if (saved.senderId !== uid || saved.text !== text.trim()) {
            fail(409, "Message ID already used.");
          }

          return { ...saved, id };
        }

        const peerId = data.participants.find((value) => value !== uid);

        const createdAt = new Date(
          Math.max(Date.now(), Date.parse(data.updatedAt) + 1),
        ).toISOString();

        const saved = {
          id,
          senderId: uid,
          text: text.trim(),
          createdAt,
        };

        transaction.create(messageRef, saved);

        transaction.update(ref, {
          updatedAt: createdAt,
          lastMessage: saved,
          unreadCounts: {
            ...data.unreadCounts,
            [peerId]: (data.unreadCounts[peerId] || 0) + 1,
          },
        });

        return saved;
      });

      res.json({ message });
    }),
  );

  // Clear unread messages only when the latest message was received.
  app.post(
    "/api/conversations/:id/read",
    route(async (req, res) => {
      const ref = reference(req.params.id);
      const messageId = req.body?.messageId;

      if (messageId !== null && !validId(messageId)) {
        fail(400, "Invalid read marker.");
      }

      const read = await db.runTransaction(async (transaction) => {
        const data = requireMember(await transaction.get(ref), req.account.uid);

        if ((data.lastMessage?.id || null) !== messageId) {
          return false;
        }

        if (data.unreadCounts[req.account.uid]) {
          transaction.update(ref, {
            unreadCounts: {
              ...data.unreadCounts,
              [req.account.uid]: 0,
            },
          });
        }

        return true;
      });

      res.json({ read });
    }),
  );
}

module.exports = { installMessagingRoutes };