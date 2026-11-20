const { transaction } = require("./postgres");
const { createHash } = require("node:crypto");
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
const validUuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
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
const milliseconds = (v) => {
  if (v instanceof Date) return v.getTime();
  return Date.parse(v || "");
};
const iso = (value) => {
  const ms = milliseconds(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const expiry = (activity, eventEnd = 0) =>
  new Date(
    Math.max(milliseconds(activity) || 0, eventEnd || 0) +
      INACTIVE_DAYS * DAY,
  );

// Removes one member from a group the caller has locked. The last member
// leaving cancels upcoming events and closes the group for later cleanup.
async function leaveGroupTx(client, group, userId, at) {
  const last = group.memberCount === 1;
  if (last) {
    await client.query(
      `UPDATE group_events SET status = 'cancelled', updated_at = $2
        WHERE group_id = $1 AND status = 'published' AND ends_at > $2`,
      [group.id, at],
    );
  }
  await client.query(
    "DELETE FROM group_memberships WHERE group_id = $1 AND user_id = $2",
    [group.id, userId],
  );
  await client.query(
    `UPDATE community_groups
        SET member_count = GREATEST(0, member_count - 1),
            status = CASE WHEN $2 THEN 'closed' ELSE status END,
            last_event_end = CASE WHEN $2 THEN NULL ELSE last_event_end END,
            delete_after = CASE WHEN $2 THEN $3 ELSE delete_after END,
            updated_at = $4
      WHERE id = $1`,
    [group.id, last, expiry(group.lastActivityAt), at],
  );
}

// Leaves every active group, as if the member pressed Leave in each one.
// Used when an account is deleted so member counts stay right.
async function leaveAllGroupsTx(client, userId, at) {
  const { rows } = await client.query(
    `SELECT g.id, g.member_count, g.last_activity_at
       FROM group_memberships m
       JOIN community_groups g ON g.id = m.group_id
      WHERE m.user_id = $1 AND m.status = 'active' AND g.status = 'active'
      ORDER BY g.id
      FOR UPDATE OF g`,
    [userId],
  );
  for (const row of rows) {
    await leaveGroupTx(
      client,
      {
        id: row.id,
        memberCount: Number(row.member_count),
        lastActivityAt: row.last_activity_at,
      },
      userId,
      at,
    );
  }
  return rows.length;
}

async function identity(client, req, message = "Your profile is not ready.") {
  if (!validUuid(req.userId) || typeof req.account?.uid !== "string")
    fail(401, "Please sign in.");
  const { rows } = await client.query(
    "SELECT id, firebase_uid, full_name, area FROM users WHERE id = $1 AND firebase_uid = $2",
    [req.userId, req.account.uid],
  );
  if (!rows.length) fail(404, message);
  return rows[0];
}

function groupData(row) {
  if (!row) fail(404, "Group not found.");
  if (row.status === "deleted") fail(404, "Group not found.");
  if (row.status !== "active") fail(410, "This group has closed.");
  return row;
}

function groupView(row) {
  return {
    name: row.name,
    area: row.area,
    description: row.description,
    interests: row.interests || [],
    creatorId: row.creator_uid,
    createdAt: iso(row.created_at),
    lastActivityAt: iso(row.last_activity_at),
    lastEventEnd: iso(row.last_event_end),
    deleteAfter: iso(row.delete_after),
    memberCount: Number(row.member_count),
    status: row.status,
    sequence: Number(row.sequence),
    revision: Number(row.revision),
    preview: row.preview,
  };
}

function memberView(row) {
  if (!row) return null;
  return {
    uid: row.firebase_uid,
    joinedAt: iso(row.joined_at),
    muted: row.muted,
    hiddenMembers: row.hidden_members || [],
    lastReadSequence: Number(row.last_read_sequence),
  };
}

function summary(id, group, member, now) {
  const deleteAfter = group.deleteAfter;
  return {
    id,
    name: group.name,
    area: group.area,
    description: group.description,
    interests: group.interests,
    memberCount: group.memberCount,
    createdAt: group.createdAt,
    lastActivityAt: group.lastActivityAt,
    deleteAfter,
    warning: milliseconds(deleteAfter) <= now + WARNING_DAYS * DAY,
    preview: member ? group.preview || "Start a conversation" : "",
    revision: group.revision || 0,
    sequence: group.sequence || 0,
    joined: !!member,
    muted: !!member?.muted,
    hiddenMembers: member?.hiddenMembers || [],
    unreadCount:
      member && !member.muted
        ? Math.max(0, (group.sequence || 0) - (member.lastReadSequence || 0))
        : 0,
  };
}

async function loadGroup(client, id, uid, { lock = false } = {}) {
  if (!validUuid(id)) fail(400, "Invalid group.");
  const suffix = lock ? " FOR UPDATE OF g" : "";
  const { rows: groupRows } = await client.query(
    `SELECT g.*, u.firebase_uid AS creator_uid
       FROM community_groups g
       LEFT JOIN users u ON u.id = g.created_by
      WHERE g.id = $1${suffix}`,
    [id],
  );
  const group = groupData(groupRows[0]);
  const { rows: memberRows } = await client.query(
    `SELECT m.joined_at, m.muted, m.hidden_members, m.last_read_sequence,
            u.firebase_uid
       FROM group_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [id, uid],
  );
  return {
    id,
    group: groupView(group),
    member: memberView(memberRows[0]),
  };
}

async function currentIdentity(client, firebaseUid) {
  if (typeof firebaseUid !== "string" || !firebaseUid || firebaseUid.length > 128)
    fail(401, "Please sign in.");
  const { rows } = await client.query(
    "SELECT id, firebase_uid FROM users WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return rows[0] || null;
}

async function futureEnd(client, groupId, now, exceptId = null) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(ends_at), 'epoch'::timestamptz) AS latest_end
       FROM group_events
      WHERE group_id = $1 AND status = 'published' AND ends_at > $2
        AND ($3::text IS NULL OR id <> $3)`,
    [groupId, new Date(now), exceptId],
  );
  return milliseconds(rows[0]?.latest_end) || 0;
}

function activityValues(group, now, lastEventEnd = milliseconds(group.lastEventEnd) || 0) {
  const lastActivityAt = new Date(
    Math.max(now, milliseconds(group.lastActivityAt) || 0),
  );
  return {
    lastActivityAt,
    lastEventEnd: lastEventEnd ? new Date(lastEventEnd) : null,
    deleteAfter: expiry(lastActivityAt, lastEventEnd),
  };
}

async function purgeGroupTx(client, id, now = Date.now()) {
  await client.query(
    `UPDATE community_groups
        SET status = 'deleted', created_by = NULL, name = '[deleted]',
            description = '', area = '', meeting_details = '', image_url = NULL,
            interests = '{}', member_count = 0, last_event_end = NULL,
            preview = '', delete_after = $2, updated_at = $2
      WHERE id = $1`,
    [id, new Date(now)],
  );
  await client.query("DELETE FROM group_events WHERE group_id = $1", [id]);
  await client.query("DELETE FROM group_messages WHERE group_id = $1", [id]);
  await client.query("DELETE FROM group_reports WHERE group_id = $1", [id]);
  await client.query("DELETE FROM group_activities WHERE group_id = $1", [id]);
  await client.query("DELETE FROM group_memberships WHERE group_id = $1", [id]);
}

async function purgeGroup(db, id) {
  if (!validUuid(id)) fail(400, "Invalid group.");
  return transaction(db, (client) => purgeGroupTx(client, id));
}

async function sweepInactiveGroups(db, now = Date.now()) {
  let removed = 0;
  let cursorTime = null;
  let cursorId = null;
  for (;;) {
    const candidates = await db.query(
      `SELECT id, delete_after
         FROM community_groups
        WHERE status IN ('active', 'closed') AND delete_after <= $1
          AND ($2::timestamptz IS NULL OR (delete_after, id) > ($2, $3::uuid))
        ORDER BY delete_after, id
        LIMIT 30`,
      [new Date(now), cursorTime, cursorId],
    );
    if (!candidates.rows.length) break;
    const lastCandidate = candidates.rows[candidates.rows.length - 1];
    cursorTime = lastCandidate.delete_after;
    cursorId = lastCandidate.id;
    for (const { id } of candidates.rows) {
      try {
        const didPurge = await transaction(db, async (client) => {
          const { rows } = await client.query(
            `SELECT g.*, u.firebase_uid AS creator_uid
               FROM community_groups g
               LEFT JOIN users u ON u.id = g.created_by
              WHERE g.id = $1
              FOR UPDATE OF g`,
            [id],
          );
          const row = rows[0];
          if (!row || !["active", "closed"].includes(row.status)) return false;
          const group = groupView(row);
          const end = await futureEnd(client, id, now);
          const deadline = expiry(
            group.lastActivityAt || group.createdAt,
            Math.max(end, milliseconds(group.lastEventEnd) || 0),
          );
          if (milliseconds(deadline) > now) {
            await client.query(
              "UPDATE community_groups SET delete_after = $2 WHERE id = $1",
              [id, deadline],
            );
            return false;
          }
          await purgeGroupTx(client, id, now);
          return true;
        });
        if (didPurge) removed++;
      } catch (error) {
        console.error("Group cleanup failed:", id, error.message);
      }
    }
    if (candidates.rows.length < 30) break;
  }
  return removed;
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
  const route = (handler) => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      error.status
        ? res.status(error.status).json({ message: error.message })
        : next(error);
    }
  };
  const parseGroupId = (id) => {
    if (!validUuid(id)) fail(400, "Invalid group.");
    return id.toLowerCase();
  };
  const text = (value, min, max, label) => {
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      fail(400, label);
    return value.trim();
  };
  async function access(client, id, uid, lock = false) {
    return loadGroup(client, parseGroupId(id), uid, { lock });
  }

  app.get(
    "/api/groups/mine",
    route(async (req, res) => {
      const { rows } = await db.query(
        `SELECT g.*, creator.firebase_uid AS creator_uid,
                m.joined_at, m.muted, m.hidden_members, m.last_read_sequence
           FROM group_memberships m
           JOIN community_groups g ON g.id = m.group_id
           LEFT JOIN users creator ON creator.id = g.created_by
          WHERE m.user_id = $1 AND m.status = 'active' AND g.status = 'active'
          ORDER BY g.last_activity_at DESC, g.id`,
        [req.userId],
      );
      res.json({
        groups: rows.map((row) =>
          summary(
            row.id,
            groupView(row),
            memberView({ ...row, firebase_uid: req.account.uid }),
            clock(),
          ),
        ),
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
      const tags = new Set(
        (typeof req.query.interests === "string"
          ? req.query.interests.split("|").slice(0, 150)
          : []
        )
          .map(normalize)
          .filter(Boolean),
      );
      let cursor = req.query.cursor;
      if (cursor !== undefined && !validUuid(cursor))
        fail(400, "Invalid group page.");
      if (cursor) cursor = cursor.toLowerCase();
      const user = await identity(db, req);
      const found = [];
      let more = true;
      let scanned = 0;
      while (found.length < 20 && more && scanned < 1000) {
        const { rows } = await db.query(
          `SELECT g.*, u.firebase_uid AS creator_uid
             FROM community_groups g
             LEFT JOIN users u ON u.id = g.created_by
            WHERE g.status = 'active' AND ($1::uuid IS NULL OR g.id > $1)
            ORDER BY g.id
            LIMIT 100`,
          [cursor || null],
        );
        more = rows.length === 100;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const group = groupView(row);
          cursor = row.id;
          scanned++;
          const searchable = normalize(
            [group.name, group.description, group.area, ...(group.interests || [])].join(
              " ",
            ),
          );
          if (
            !words.every((word) => searchable.includes(word)) ||
            (area && !normalize(group.area).includes(area)) ||
            (tags.size &&
              !group.interests?.some((tag) => tags.has(normalize(tag))))
          )
            continue;
          const { rows: membership } = user
            ? await db.query(
                `SELECT joined_at, muted, hidden_members, last_read_sequence
                   FROM group_memberships
                  WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
                [row.id, user.id],
              )
            : { rows: [] };
          found.push(
            summary(
              row.id,
              group,
              membership[0]
                ? memberView({
                    ...membership[0],
                    firebase_uid: req.account?.uid,
                  })
                : null,
              clock(),
            ),
          );
          if (found.length === 20) {
            more = i < rows.length - 1 || more;
            break;
          }
        }
        if (rows.length === 0) more = false;
      }
      res.json({ groups: found, nextCursor: more ? cursor : null });
    }),
  );

  app.post(
    "/api/groups",
    route(async (req, res) => {
      const body = req.body || {};
      if (!validUuid(body.id)) fail(400, "Invalid group.");
      const id = body.id.toLowerCase();
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
      const result = await transaction(db, async (client) => {
        const user = await identity(
          client,
          req,
          "Your profile is not ready. Open Profile and try again.",
        );
        let { rows } = await client.query(
          `SELECT g.*, u.firebase_uid AS creator_uid
             FROM community_groups g
             LEFT JOIN users u ON u.id = g.created_by
            WHERE g.id = $1
            FOR UPDATE OF g`,
          [id],
        );
        if (rows[0]) {
          const existing = rows[0];
          if (existing.status !== "active") {
            if (existing.status === "deleted" || existing.status === "deleting")
              fail(410, "This group was deleted. Start a new group instead.");
            groupData(existing);
          }
          if (
            existing.created_by !== user.id ||
            existing.name !== name ||
            JSON.stringify(existing.interests) !== JSON.stringify(interests)
          )
            fail(409, "Group ID already used.");
          return groupView(existing);
        }
        const now = new Date(clock());
        const area =
          typeof user.area === "string" && user.area.trim()
            ? user.area.trim().slice(0, 120)
            : "Ontario";
        const { rows: inserted } = await client.query(
          `INSERT INTO community_groups
             (id, created_by, name, description, area, visibility, created_at,
              updated_at, status, member_count, interests, last_activity_at,
              delete_after, preview, revision, sequence)
           VALUES ($1, $2, $3, '', $4, 'public', $5, $5, 'active', 1, $6, $5,
                   $7, '', 0, 0)
           ON CONFLICT (id) DO NOTHING
           RETURNING *`,
          [id, user.id, name, area, now, interests, expiry(now)],
        );
        if (!inserted.length) {
          const conflict = await client.query(
            `SELECT g.*, u.firebase_uid AS creator_uid
               FROM community_groups g
               LEFT JOIN users u ON u.id = g.created_by
              WHERE g.id = $1
              FOR UPDATE OF g`,
            [id],
          );
          const existing = conflict.rows[0];
          if (existing?.status !== "active") {
            if (existing?.status === "deleted" || existing?.status === "deleting")
              fail(410, "This group was deleted. Start a new group instead.");
            groupData(existing);
          }
          if (
            existing?.created_by !== user.id ||
            existing?.name !== name ||
            JSON.stringify(existing?.interests) !== JSON.stringify(interests)
          )
            fail(409, "Group ID already used.");
          return groupView(existing);
        }
        await client.query(
          `INSERT INTO group_memberships
             (group_id, user_id, role, status, joined_at, muted,
              hidden_members, last_read_sequence)
           VALUES ($1, $2, 'owner', 'active', $3, false, '{}', 0)
           ON CONFLICT (group_id, user_id) DO UPDATE
             SET role = 'owner', status = 'active', joined_at = EXCLUDED.joined_at`,
          [id, user.id, now],
        );
        return groupView({
          ...inserted[0],
          creator_uid: user.firebase_uid,
        });
      });
      const user = await identity(db, req);
      const { rows: membership } = await db.query(
        `SELECT joined_at, muted, hidden_members, last_read_sequence
           FROM group_memberships
          WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
        [id, user.id],
      );
      res.json({
        group: summary(
          id,
          result,
          membership[0]
            ? memberView({
                ...membership[0],
                firebase_uid: user.firebase_uid,
              })
            : null,
          clock(),
        ),
      });
    }),
  );

  app.get(
    "/api/groups/:id",
    route(async (req, res) => {
      const user = await identity(db, req);
      const value = await access(db, req.params.id, user?.id);
      res.json({
        group: summary(value.id, value.group, value.member, clock()),
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
      await transaction(db, async (client) => {
        const user = await identity(client, req, "Your member profile is not ready.");
        const value = await access(client, req.params.id, user.id, true);
        if (value.member) return;
        await client.query(
          `INSERT INTO group_memberships
             (group_id, user_id, role, status, joined_at, muted,
              hidden_members, last_read_sequence)
           VALUES ($1, $2, 'member', 'active', $3, false, '{}', $4)
           ON CONFLICT (group_id, user_id) DO UPDATE
             SET role = 'member', status = 'active', joined_at = EXCLUDED.joined_at,
                 muted = false, hidden_members = '{}',
                 last_read_sequence = EXCLUDED.last_read_sequence`,
          [
            value.id,
            user.id,
            new Date(clock()),
            value.group.sequence,
          ],
        );
        await client.query(
          `UPDATE community_groups
              SET member_count = member_count + 1, updated_at = $2
            WHERE id = $1`,
          [value.id, new Date(clock())],
        );
      });
      res.json({ joined: true });
    }),
  );

  app.post(
    "/api/groups/:id/leave",
    route(async (req, res) => {
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) return;
        await leaveGroupTx(
          client,
          {
            id: value.id,
            memberCount: value.group.memberCount,
            lastActivityAt: value.group.lastActivityAt,
          },
          user.id,
          new Date(clock()),
        );
      });
      res.json({ left: true });
    }),
  );

  app.post(
    "/api/groups/:id/delete",
    route(async (req, res) => {
      const id = parseGroupId(req.params.id);
      const claimed = await transaction(db, async (client) => {
        const user = await identity(client, req);
        const { rows } = await client.query(
          `SELECT * FROM community_groups WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const group = rows[0];
        if (!group || group.status === "deleting" || group.status === "deleted")
          return false;
        if (
          group.created_by !== user.id ||
          Number(group.member_count) !== 1
        )
          fail(
            403,
            "Only the creator can delete a group while they are its only member.",
          );
        const { rows: membership } = await client.query(
          `SELECT 1 FROM group_memberships
            WHERE group_id = $1 AND user_id = $2 AND status = 'active'`,
          [id, user.id],
        );
        if (!membership.length) fail(403, "Join this group to participate.");
        await purgeGroupTx(client, id, clock());
        return true;
      });
      void claimed;
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
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group first.");
        if (
          input.clearHidden !== undefined &&
          typeof input.clearHidden !== "boolean"
        )
          fail(400, "Invalid message visibility setting.");
        const hidden = new Set(
          input.clearHidden ? [] : value.member.hiddenMembers || [],
        );
        if (input.hiddenMemberId)
          input.hidden
            ? hidden.add(input.hiddenMemberId)
            : hidden.delete(input.hiddenMemberId);
        if (hidden.size > 1000) fail(400, "Too many hidden members.");
        const hiddenMembers = [...hidden];
        await client.query(
          `UPDATE group_memberships
              SET hidden_members = $3, muted = $4
            WHERE group_id = $1 AND user_id = $2`,
          [value.id, user.id, hiddenMembers, input.muted ?? value.member.muted],
        );
        await client.query(
          `DELETE FROM group_hidden_members
            WHERE group_id = $1 AND user_id = $2`,
          [value.id, user.id],
        );
        if (hiddenMembers.length) {
          await client.query(
            `INSERT INTO group_hidden_members (group_id, user_id, hidden_user_id)
             SELECT $1, $2, m.user_id
               FROM users u
               JOIN group_memberships m ON m.user_id = u.id
              WHERE m.group_id = $1 AND m.status = 'active'
                AND u.firebase_uid = ANY($3::text[])
             ON CONFLICT DO NOTHING`,
            [value.id, user.id, hiddenMembers],
          );
        }
      });
      res.json({ saved: true });
    }),
  );

  app.get(
    "/api/groups/:id/members",
    route(async (req, res) => {
      const user = await identity(db, req);
      const value = await access(db, req.params.id, user?.id);
      if (!value.member) fail(403, "Join this group first.");
      const cursor = req.query.cursor;
      if (cursor && !validId(cursor)) fail(400, "Invalid member page.");
      const { rows } = await db.query(
        `SELECT u.firebase_uid, u.full_name, u.area
           FROM group_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND m.status = 'active'
            AND ($2::text IS NULL OR u.firebase_uid > $2)
          ORDER BY u.firebase_uid
          LIMIT 51`,
        [value.id, cursor || null],
      );
      const members = rows.slice(0, 50).map((row) => ({
        id: row.firebase_uid,
        name: row.full_name || "Member",
        area: row.area || "",
        hidden: value.member.hiddenMembers?.includes(row.firebase_uid) || false,
        blocked: false,
      }));
      if (members.length) {
        const ids = members.map((member) => member.id);
        const { rows: blocked } = await db.query(
          `SELECT u.firebase_uid
             FROM contact_blocks b
             JOIN users u ON u.id = b.target_id
            WHERE b.owner_id = $1 AND u.firebase_uid = ANY($2::text[])`,
          [user.id, ids],
        );
        const blockedIds = new Set(blocked.map((row) => row.firebase_uid));
        members.forEach((member) => {
          member.blocked = blockedIds.has(member.id);
        });
      }
      res.json({
        members,
        nextCursor: rows.length > 50 ? rows[49].firebase_uid : null,
      });
    }),
  );

  app.get(
    "/api/contact-blocks",
    route(async (req, res) => {
      const user = await identity(db, req);
      const { rows } = await db.query(
        `SELECT target.firebase_uid AS id,
                COALESCE(target.full_name, 'Member') AS name
           FROM contact_blocks b
           JOIN users target ON target.id = b.target_id
          WHERE b.owner_id = $1
          ORDER BY target.firebase_uid`,
        [user?.id],
      );
      res.json({ people: rows });
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
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const target = await currentIdentity(client, targetId);
        if (blocked && !target) fail(404, "Member not found.");
        if (!target) return;
        if (blocked) {
          await client.query(
            `INSERT INTO contact_blocks (owner_id, target_id, created_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (owner_id, target_id) DO NOTHING`,
            [user.id, target.id, new Date(clock())],
          );
        } else {
          await client.query(
            "DELETE FROM contact_blocks WHERE owner_id = $1 AND target_id = $2",
            [user.id, target.id],
          );
        }
      });
      res.json({ blocked });
    }),
  );

  app.get(
    "/api/groups/:id/messages",
    route(async (req, res) => {
      const user = await identity(db, req);
      const value = await access(db, req.params.id, user?.id);
      if (!value.member) fail(403, "Join this group to read its messages.");
      const { before, revision } = req.query;
      if (before !== undefined && revision !== undefined)
        fail(400, "Choose one message page.");
      for (const page of [before, revision])
        if (
          page !== undefined &&
          (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page)))
        )
          fail(400, "Invalid message page.");
      let rows;
      if (revision !== undefined) {
        ({ rows } = await db.query(
          `SELECT m.id, m.sender_id, u.firebase_uid AS sender_uid,
                  m.sender_name, m.text, m.created_at, m.edited_at,
                  m.deleted, m.sequence, m.revision
             FROM group_messages m
             JOIN users u ON u.id = m.sender_id
            WHERE m.group_id = $1 AND m.revision > $2
            ORDER BY m.revision
            LIMIT 51`,
          [value.id, Number(revision)],
        ));
      } else {
        ({ rows } = await db.query(
          `SELECT m.id, m.sender_id, u.firebase_uid AS sender_uid,
                  m.sender_name, m.text, m.created_at, m.edited_at,
                  m.deleted, m.sequence, m.revision
             FROM group_messages m
             JOIN users u ON u.id = m.sender_id
            WHERE m.group_id = $1 AND ($2::bigint IS NULL OR m.sequence < $2)
            ORDER BY m.sequence DESC
            LIMIT 51`,
          [value.id, before === undefined ? null : Number(before)],
        ));
      }
      const hasMore = rows.length > 50;
      const page = rows.slice(0, 50);
      const messages = page.map((row) => ({
        id: row.id,
        senderId: row.sender_uid,
        senderName: row.sender_name,
        text: row.text,
        createdAt: iso(row.created_at),
        editedAt: iso(row.edited_at),
        deleted: row.deleted,
        sequence: Number(row.sequence),
        revision: Number(row.revision),
      }));
      if (revision === undefined) messages.reverse();
      const syncedRevision =
        revision === undefined
          ? value.group.revision
          : Math.max(Number(revision), ...messages.map((message) => message.revision));
      res.json({
        group: summary(value.id, value.group, value.member, clock()),
        messages,
        revision: syncedRevision,
        moreChanges: revision !== undefined && hasMore,
        nextBefore:
          revision === undefined && hasMore
            ? Number(page[page.length - 1].sequence)
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
      const message = await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group to send messages.");
        const { rows: existing } = await client.query(
          `SELECT id, sender_id, sender_name, text, original_text, created_at,
                  edited_at, deleted, sequence, revision
             FROM group_messages WHERE group_id = $1 AND id = $2`,
          [value.id, body.id],
        );
        if (existing[0]) {
          if (
            existing[0].sender_id !== user.id ||
            existing[0].original_text !== content
          )
            fail(409, "Message ID already used.");
          return {
            id: body.id,
            senderId: req.account.uid,
            senderName: existing[0].sender_name,
            text: existing[0].text,
            createdAt: iso(existing[0].created_at),
            editedAt: iso(existing[0].edited_at),
            deleted: existing[0].deleted,
            sequence: Number(existing[0].sequence),
            revision: Number(existing[0].revision),
          };
        }
        const now = clock();
        const sequence = value.group.sequence + 1;
        const revision = value.group.revision + 1;
        const preview = content;
        await client.query(
          `INSERT INTO group_messages
             (group_id, id, sender_id, sender_name, text, original_text,
              created_at, edited_at, deleted, sequence, revision)
           VALUES ($1, $2, $3, $4, $5, $5, $6, NULL, false, $7, $8)`,
          [
            value.id,
            body.id,
            user.id,
            user.full_name || "Member",
            content,
            new Date(now),
            sequence,
            revision,
          ],
        );
        const activity = activityValues(value.group, now);
        await client.query(
          `UPDATE community_groups
              SET last_activity_at = $2, last_event_end = $3, delete_after = $4,
                  sequence = $5, revision = $6, preview = $7, updated_at = $2
            WHERE id = $1`,
          [
            value.id,
            activity.lastActivityAt,
            activity.lastEventEnd,
            activity.deleteAfter,
            sequence,
            revision,
            preview,
          ],
        );
        await client.query(
          `UPDATE group_memberships SET last_read_sequence = $3
            WHERE group_id = $1 AND user_id = $2`,
          [value.id, user.id, sequence],
        );
        return {
          id: body.id,
          senderId: req.account.uid,
          senderName: user.full_name || "Member",
          text: content,
          createdAt: new Date(now).toISOString(),
          editedAt: null,
          deleted: false,
          sequence,
          revision,
        };
      });
      res.json({ message });
    }),
  );

  app.post(
    "/api/groups/:id/read",
    route(async (req, res) => {
      const sequence = req.body?.sequence;
      if (!Number.isSafeInteger(sequence) || sequence < 0)
        fail(400, "Invalid read marker.");
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group first.");
        await client.query(
          `UPDATE group_memberships
              SET last_read_sequence = GREATEST(
                last_read_sequence, LEAST($3::bigint, $4::bigint)
              )
            WHERE group_id = $1 AND user_id = $2`,
          [value.id, user.id, sequence, value.group.sequence],
        );
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
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group first.");
        let targetUserId;
        let messageText = null;
        if (messageId) {
          const { rows } = await client.query(
            `SELECT sender_id, text FROM group_messages
              WHERE group_id = $1 AND id = $2`,
            [value.id, messageId],
          );
          if (!rows[0]) fail(404, "The reported item was not found.");
          targetUserId = rows[0].sender_id;
          messageText = rows[0].text;
        } else {
          const { rows } = await client.query(
            `SELECT m.user_id FROM group_memberships m
              JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1 AND m.status = 'active'
               AND u.firebase_uid = $2`,
            [value.id, memberId],
          );
          if (!rows[0]) fail(404, "The reported item was not found.");
          targetUserId = rows[0].user_id;
        }
        if (targetUserId === user.id)
          fail(400, "Choose another member's content.");
        const reportId = hash(
          value.id,
          req.account.uid,
          messageId || memberId,
          reason,
        );
        const now = new Date(clock());
        await client.query(
          `INSERT INTO group_reports
             (id, group_id, reporter_id, member_id, message_id, message_text,
              reason, details, latest_details, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', 'open', $9)
           ON CONFLICT (id) DO UPDATE
             SET latest_details = EXCLUDED.details,
                 last_reported_at = EXCLUDED.created_at,
                 status = 'open'`,
          [
            reportId,
            value.id,
            user.id,
            targetUserId,
            messageId || null,
            messageText,
            reason,
            details.trim(),
            now,
          ],
        );
      });
      res.json({ reported: true });
    }),
  );

  // Small per-account fingerprints so the Map tab can reuse a completed view
  // until a membership changes or any member group's events change. Derived
  // from event rows, so saves, cancellations and purges all move `version`.
  app.get(
    "/api/map/group-version",
    route(async (req, res) => {
      const user = await identity(db, req);
      const { rows } = await db.query(
        `SELECT g.id::text AS id,
                COUNT(e.id) FILTER (WHERE e.status = 'published')::int AS published,
                COALESCE(MAX(e.updated_at), 'epoch'::timestamptz) AS changed_at
           FROM group_memberships m
           JOIN community_groups g ON g.id = m.group_id
           LEFT JOIN group_events e ON e.group_id = g.id
          WHERE m.user_id = $1 AND m.status = 'active' AND g.status = 'active'
          GROUP BY g.id
          ORDER BY g.id`,
        [user.id],
      );
      const ids = rows.map((row) => row.id);
      const revisions = rows.map((row) => [
        row.id,
        iso(row.changed_at) || "",
        Number(row.published) || 0,
      ]);
      res.set("Cache-Control", "no-store");
      res.json({
        version: hash(req.account.uid, revisions).slice(0, 24),
        membership: hash(req.account.uid, ids).slice(0, 24),
      });
    }),
  );

  app.get(
    "/api/groups/:id/events",
    route(async (req, res) => {
      const user = await identity(db, req);
      const value = await access(db, req.params.id, user?.id);
      if (!value.member) fail(403, "Join this group first.");
      const { rows } = await db.query(
        `SELECT e.*, creator.firebase_uid AS creator_uid
           FROM group_events e
           JOIN users creator ON creator.id = e.creator_id
          WHERE e.group_id = $1 AND e.status = 'published' AND e.ends_at > $2
          ORDER BY e.starts_at`,
        [value.id, new Date(clock())],
      );
      res.json({
        events: rows.map((row) => ({
          id: row.id,
          groupId: row.group_id,
          creatorId: row.creator_uid,
          requestId: row.request_id,
          title: row.title,
          location: row.location,
          description: row.description,
          latitude: row.latitude,
          longitude: row.longitude,
          mapCell: row.map_cell,
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
          status: row.status,
          interests: row.interests,
          timeZone: row.time_zone,
          updatedAt: iso(row.updated_at),
        })),
      });
    }),
  );

  app.post(
    "/api/groups/:id/events",
    route(async (req, res) => {
      const body = req.body || {};
      if (!validId(body.id)) fail(400, "Invalid event.");
      const title = text(body.title, 3, 120, "Enter an event title.");
      const location = text(
        body.location,
        3,
        200,
        "Enter a public venue and address.",
      );
      const description = text(
        body.description || "",
        0,
        2000,
        "Keep the description within 2,000 characters.",
      );
      const start = Date.parse(body.startsAt);
      const end = Date.parse(body.endsAt);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= clock() ||
        start > clock() + 366 * DAY ||
        end <= start ||
        end - start > 7 * DAY ||
        !Number.isFinite(body.latitude) ||
        !Number.isFinite(body.longitude) ||
        Math.abs(body.latitude) > 90 ||
        Math.abs(body.longitude) > 180 ||
        body.publicVenueConfirmed !== true
      )
        fail(
          400,
          "Check the event time and confirm its public meeting location.",
        );
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group to organize an event.");
        const id = hash(value.id, body.id);
        const { rows: existingRows } = await client.query(
          `SELECT * FROM group_events
            WHERE group_id = $1 AND request_id = $2
            FOR UPDATE`,
          [value.id, body.id],
        );
        const old = existingRows[0];
        if (
          start <= clock() &&
          (!old || start !== milliseconds(old.starts_at))
        )
          fail(400, "Choose a future start time for a new event.");
        if (old && old.creator_id !== user.id)
          fail(403, "You can change only your own events.");
        // One row lock per account serializes saves made in different groups,
        // so two concurrent saves cannot both pass the limit below.
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          user.id,
        ]);
        const existingActive =
          !!old &&
          old.status === "published" &&
          milliseconds(old.ends_at) > clock();
        if (!existingActive) {
          const { rows: activeRows } = await client.query(
            `SELECT count(*)::int AS count
               FROM group_events
              WHERE creator_id = $1 AND status = 'published' AND ends_at > $2
                AND id <> $3`,
            [user.id, new Date(clock()), old?.id || id],
          );
          if ((Number(activeRows[0]?.count) || 0) >= 2)
            fail(
              409,
              "You can have up to 2 upcoming or ongoing events across all your groups. Cancel an event or wait for one to finish before creating another.",
            );
        }
        const latestEnd = Math.max(
          end,
          await futureEnd(client, value.id, clock(), old?.id || id),
        );
        const now = new Date(clock());
        await client.query(
          `INSERT INTO group_events
             (id, group_id, creator_id, request_id, title, location, description,
              latitude, longitude, map_cell, starts_at, ends_at, status,
              interests, time_zone, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   'published', $13, 'America/Toronto', $14)
           ON CONFLICT (group_id, request_id) DO UPDATE
             SET title = EXCLUDED.title, location = EXCLUDED.location,
                 description = EXCLUDED.description, latitude = EXCLUDED.latitude,
                 longitude = EXCLUDED.longitude, map_cell = EXCLUDED.map_cell,
                 starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
                 status = 'published', interests = EXCLUDED.interests,
                 updated_at = EXCLUDED.updated_at`,
          [
            id,
            value.id,
            user.id,
            body.id,
            title,
            location,
            description,
            body.latitude,
            body.longitude,
            mapCellFor(body.latitude, body.longitude),
            new Date(start),
            new Date(end),
            value.group.interests,
            now,
          ],
        );
        const activity = activityValues(value.group, clock(), latestEnd);
        await client.query(
          `UPDATE community_groups
              SET last_activity_at = $2, last_event_end = $3, delete_after = $4,
                  updated_at = $2
            WHERE id = $1`,
          [
            value.id,
            activity.lastActivityAt,
            activity.lastEventEnd,
            activity.deleteAfter,
          ],
        );
      });
      res.json({ saved: true });
    }),
  );

  app.post(
    "/api/groups/:id/events/:eventId/cancel",
    route(async (req, res) => {
      if (!validId(req.params.eventId)) fail(400, "Invalid event.");
      await transaction(db, async (client) => {
        const user = await identity(client, req);
        const value = await access(client, req.params.id, user.id, true);
        if (!value.member) fail(403, "Join this group first.");
        const { rows } = await client.query(
          "SELECT * FROM group_events WHERE id = $1 AND group_id = $2 FOR UPDATE",
          [req.params.eventId, value.id],
        );
        const old = rows[0];
        if (!old) fail(404, "Event not found.");
        if (old.creator_id !== user.id)
          fail(403, "You can cancel only your own events.");
        await client.query(
          `UPDATE group_events SET status = 'cancelled', updated_at = $2
            WHERE id = $1`,
          [old.id, new Date(clock())],
        );
        const latestEnd = await futureEnd(client, value.id, clock(), old.id);
        const activity = activityValues(value.group, clock(), latestEnd);
        await client.query(
          `UPDATE community_groups
              SET last_activity_at = $2, last_event_end = $3, delete_after = $4,
                  updated_at = $2
            WHERE id = $1`,
          [
            value.id,
            activity.lastActivityAt,
            activity.lastEventEnd,
            activity.deleteAfter,
          ],
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
  purgeGroup,
  leaveAllGroupsTx,
};
