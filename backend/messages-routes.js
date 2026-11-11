const { createHash } = require("node:crypto");

function installMessagingRoutes(app, db) {
  const validId = (id) =>
    typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const validUuid = (id) =>
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );

  function fail(status, message) {
    throw Object.assign(new Error(message), { status });
  }

  const route = (handler) => async (req, res, next) => {
    try {
      if (!req.account?.uid || !validUuid(req.userId)) {
        fail(401, "Please sign in.");
      }
      req.userId = req.userId.toLowerCase();
      await handler(req, res);
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ message: error.message });
      } else {
        next(error);
      }
    }
  };

  function conversationId(id) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
      fail(400, "Invalid conversation.");
    }
    return id;
  }

  async function withTransaction(fn) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function getConversation(client, id, uid, lock = false) {
    const result = await client.query(
      `SELECT id, user_low, user_high, created_at, updated_at,
              last_message_id, last_message_text, last_message_sender_id
       FROM direct_conversations
       WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    const conversation = result.rows[0];
    if (!conversation) fail(404, "Conversation not found.");
    if (conversation.user_low !== uid && conversation.user_high !== uid) {
      fail(403, "You cannot access this conversation.");
    }
    return conversation;
  }

  async function assertCanContact(client, uid, peerId) {
    const result = await client.query(
      `SELECT 1
       FROM contact_blocks
       WHERE (owner_id = $1::uuid AND target_id = $2::uuid)
          OR (owner_id = $2::uuid AND target_id = $1::uuid)
       LIMIT 1`,
      [uid, peerId],
    );
    if (result.rowCount) {
      fail(403, "Direct contact between these members is blocked.");
    }
  }

  async function summaries(uid, id) {
    const result = await db.query(
      `SELECT c.id, peer.firebase_uid AS peer_uid, peer.full_name, peer.area,
              c.last_message_text,
              c.updated_at,
              (
                SELECT count(*)::int
                FROM direct_messages dm
                WHERE dm.conversation_id = c.id
                  AND dm.sender_id <> $1::uuid
                  AND dm.created_at > COALESCE(
                    (
                      SELECT r.last_read_at
                      FROM direct_conversation_reads r
                      WHERE r.conversation_id = c.id
                        AND r.user_id = $1::uuid
                    ),
                    '-infinity'::timestamptz
                  )
              ) AS unread_count
       FROM direct_conversations c
       JOIN users peer
         ON peer.id = CASE
           WHEN c.user_low = $1::uuid THEN c.user_high
           ELSE c.user_low
         END
       WHERE (c.user_low = $1::uuid OR c.user_high = $1::uuid)
         ${id ? "AND c.id = $2" : ""}
       ORDER BY c.updated_at DESC`,
      id ? [uid, id] : [uid],
    );
    return result.rows.map((row) => ({
      id: row.id,
      peerId: row.peer_uid,
      name: row.full_name || "Member",
      handle: row.area || "",
      preview: row.last_message_text || "Start a conversation",
      timestamp: row.updated_at,
      unreadCount: Number(row.unread_count || 0),
    }));
  }

  // Registered members available for starting a conversation.
  app.get(
    "/api/people",
    route(async (req, res) => {
      const result = await db.query(
        `SELECT id, full_name, area
         FROM users
         WHERE id <> $1::uuid
         ORDER BY id
         LIMIT 100`,
        [req.userId],
      );
      res.json({
        people: result.rows.map((row) => ({
          id: row.id,
          name: row.full_name,
          area: row.area || "",
        })),
      });
    }),
  );

  // Only conversations belonging to the signed-in user.
  app.get(
    "/api/conversations",
    route(async (req, res) => {
      res.json({ conversations: await summaries(req.userId) });
    }),
  );

  // Start a direct conversation, or return the existing one.
  app.post(
    "/api/conversations",
    route(async (req, res) => {
      const uid = req.userId;
      const requestedPeerId = req.body?.peerId;

      if (!validUuid(requestedPeerId) || requestedPeerId.toLowerCase() === uid) {
        fail(400, "Choose another member.");
      }
      const peerId = requestedPeerId.toLowerCase();

      const [low, high] = [uid, peerId].sort();
      const id = createHash("sha256")
        .update(JSON.stringify([low, high]))
        .digest("hex");

      await withTransaction(async (client) => {
        const users = await client.query(
          `SELECT id FROM users WHERE id IN ($1::uuid, $2::uuid)`,
          [uid, peerId],
        );
        if (users.rowCount !== 2) {
          fail(404, "Member profile not found.");
        }

        await assertCanContact(client, uid, peerId);
        await client.query(
          `INSERT INTO direct_conversations (id, user_low, user_high)
           VALUES ($1, $2::uuid, $3::uuid)
           ON CONFLICT (user_low, user_high) DO NOTHING`,
          [id, low, high],
        );
      });

      const [conversation] = await summaries(uid, id);
      if (!conversation) fail(404, "Conversation not found.");
      res.json({ conversation });
    }),
  );

  // Load recent messages, older history, or newly received messages.
  app.get(
    "/api/conversations/:id/messages",
    route(async (req, res) => {
      const id = conversationId(req.params.id);
      const uid = req.userId;
      const conversation = await getConversation(db, id, uid);
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

      if (after !== undefined && (conversation.last_message_id || "none") === after) {
        const [summary] = await summaries(uid, id);
        return res.json({
          unchanged: true,
          needsRead: (summary?.unreadCount || 0) > 0,
        });
      }

      const incremental = after !== undefined;
      const cursorId = before || (after !== "none" ? after : null);
      let cursor = null;
      if (cursorId) {
        const result = await db.query(
          `SELECT created_at, id
           FROM direct_messages
           WHERE conversation_id = $1 AND id = $2`,
          [id, cursorId],
        );
        cursor = result.rows[0];
        if (!cursor) fail(404, "Message cursor not found.");
      }

      const values = [id];
      let whereCursor = "";
      if (cursor) {
        values.push(cursor.created_at, cursor.id);
        whereCursor = incremental
          ? `AND (created_at > $2 OR (created_at = $2 AND id > $3))`
          : `AND (created_at < $2 OR (created_at = $2 AND id < $3))`;
      }

      const order = incremental ? "ASC" : "DESC";
      const result = await db.query(
        `SELECT id, sender_id, text, created_at
         FROM direct_messages
         WHERE conversation_id = $1
         ${whereCursor}
         ORDER BY created_at ${order}, id ${order}
         LIMIT 51`,
        values,
      );
      const docs = result.rows.slice(0, 50);
      const messages = docs.map((row) => ({
        id: row.id,
        senderId: row.sender_id,
        text: row.text,
        createdAt: new Date(row.created_at).toISOString(),
      }));
      if (!incremental) messages.reverse();

      const [summary] = await summaries(uid, id);
      res.json({
        unchanged: false,
        conversation: summary,
        messages,
        nextCursor:
          !incremental && result.rows.length > 50
            ? docs[docs.length - 1].id
            : null,
        hasMoreNew: incremental && result.rows.length > 50,
      });
    }),
  );

  // Save a message and update the conversation preview atomically.
  app.post(
    "/api/conversations/:id/messages",
    route(async (req, res) => {
      const id = conversationId(req.params.id);
      const uid = req.userId;
      const { id: messageId, text } = req.body || {};

      if (
        !validId(messageId) ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 2000
      ) {
        fail(400, "Enter a message of up to 2,000 characters.");
      }

      const message = await withTransaction(async (client) => {
        const conversation = await getConversation(client, id, uid, true);
        const peerId =
          conversation.user_low === uid
            ? conversation.user_high
            : conversation.user_low;
        await assertCanContact(client, uid, peerId);

        const existing = await client.query(
          `SELECT id, sender_id, text, created_at
           FROM direct_messages
           WHERE conversation_id = $1 AND id = $2`,
          [id, messageId],
        );
        if (existing.rows[0]) {
          const saved = existing.rows[0];
          if (saved.sender_id !== uid || saved.text !== text.trim()) {
            fail(409, "Message ID already used.");
          }
          return {
            id: saved.id,
            senderId: saved.sender_id,
            text: saved.text,
            createdAt: new Date(saved.created_at).toISOString(),
          };
        }

        const createdAt = new Date(
          Math.max(
            Date.now(),
            new Date(conversation.updated_at).getTime() + 1,
          ),
        );
        const timestamp = createdAt.toISOString();
        await client.query(
          `INSERT INTO direct_messages
             (conversation_id, id, sender_id, text, created_at)
           VALUES ($1, $2, $3::uuid, $4, $5)`,
          [id, messageId, uid, text.trim(), timestamp],
        );
        await client.query(
          `UPDATE direct_conversations
           SET updated_at = $2,
               last_message_id = $3,
               last_message_text = $4,
               last_message_sender_id = $5::uuid
           WHERE id = $1`,
          [id, timestamp, messageId, text.trim(), uid],
        );
        return {
          id: messageId,
          senderId: uid,
          text: text.trim(),
          createdAt: timestamp,
        };
      });

      res.json({ message });
    }),
  );

  // Clear unread messages only when the latest message was received.
  app.post(
    "/api/conversations/:id/read",
    route(async (req, res) => {
      const id = conversationId(req.params.id);
      const uid = req.userId;
      const messageId = req.body?.messageId;

      if (messageId !== null && !validId(messageId)) {
        fail(400, "Invalid read marker.");
      }

      const read = await withTransaction(async (client) => {
        const conversation = await getConversation(client, id, uid, true);
        if ((conversation.last_message_id || null) !== messageId) {
          return false;
        }
        let lastReadAt = null;
        if (messageId !== null) {
          const result = await client.query(
            `SELECT created_at
             FROM direct_messages
             WHERE conversation_id = $1 AND id = $2`,
            [id, messageId],
          );
          if (!result.rows[0]) return false;
          lastReadAt = result.rows[0].created_at;
        }
        await client.query(
          `INSERT INTO direct_conversation_reads
             (conversation_id, user_id, last_read_at, last_read_message_id)
           VALUES ($1, $2::uuid, $3, $4)
           ON CONFLICT (conversation_id, user_id) DO UPDATE
           SET last_read_at = EXCLUDED.last_read_at,
               last_read_message_id = EXCLUDED.last_read_message_id`,
          [id, uid, lastReadAt, messageId],
        );
        return true;
      });

      res.json({ read });
    }),
  );
}

module.exports = { installMessagingRoutes };
