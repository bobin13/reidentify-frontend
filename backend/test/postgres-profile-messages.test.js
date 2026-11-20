const test = require("node:test");
const assert = require("node:assert/strict");
const {
  installProfileRoutes,
  profileChanges,
  profileExtras,
} = require("../profile-routes");
const { installMessagingRoutes } = require("../messages-routes");

const viewerId = "00000000-0000-4000-8000-000000000001";
const peerId = "00000000-0000-4000-8000-000000000002";
const peerUid = "firebase-peer";
const conversationId = "a".repeat(64);

function routeApp() {
  const routes = new Map();
  return {
    routes,
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    post: (path, handler) => routes.set(`POST ${path}`, handler),
  };
}

async function invoke(handler, { params = {}, query = {}, body } = {}) {
  const response = {
    code: 200,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.value = value;
      return this;
    },
  };
  let nextError;
  await handler(
    {
      account: { uid: "firebase-viewer", email: "viewer@example.com" },
      userId: viewerId,
      params,
      query,
      body,
    },
    response,
    (error) => {
      nextError = error;
    },
  );
  if (nextError) throw nextError;
  return response;
}

test("profile routes look up public profiles by Firebase UID and return it as the id", async () => {
  const app = routeApp();
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [
          {
            id: peerId,
            firebase_uid: peerUid,
            full_name: "Public Member",
            email: "member@example.com",
            area: "Toronto",
            about_me: "Hello",
            age: 34,
            gender: "Non-binary",
            profile_visibility: "public",
            photo_version: null,
            interests: ["Walking & outdoors"],
            joined_at: new Date("2024-01-01T00:00:00Z"),
          },
        ],
      };
    },
  };
  installProfileRoutes(app, db, {
    toOwner: (account, data) => ({
      id: account.uid,
      fullName: data.full_name,
      area: data.area,
      ...profileExtras(data),
    }),
  });

  const response = await invoke(app.routes.get("GET /api/profiles/:uid"), {
    params: { uid: peerUid },
  });

  assert.equal(response.code, 200);
  assert.equal(response.value.profile.id, peerUid);
  assert.equal(response.value.profile.fullName, "Public Member");
  assert.equal(response.value.profile.age, 34);
  assert.deepEqual(response.value.profile.interests, ["Walking & outdoors"]);
  assert.equal(calls[0].values[0], peerUid);
  assert.match(calls[0].sql, /u\.firebase_uid = \$1/);
});

test("the signed-in user can read their own private profile and photo by Firebase UID", async () => {
  const app = routeApp();
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM profile_photos")) {
        return {
          rows: [
            {
              version: "photo-1",
              mime_type: "image/jpeg",
              content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
            },
          ],
        };
      }
      return {
        rows: [
          {
            id: viewerId,
            firebase_uid: "firebase-viewer",
            full_name: "Me",
            profile_visibility: "private",
            photo_version: "photo-1",
            interests: [],
          },
        ],
      };
    },
  };
  installProfileRoutes(app, db);

  const response = await invoke(app.routes.get("GET /api/profiles/:uid/photo"), {
    params: { uid: "firebase-viewer" },
    query: { version: "photo-1" },
  });

  assert.equal(response.code, 200);
  assert.equal(response.value.jpeg, Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"));
  const photoCall = calls.find((call) => call.sql.includes("FROM profile_photos"));
  assert.deepEqual(photoCall.values, [viewerId]);
});

test("profile helpers preserve age and accept PostgreSQL profile columns", () => {
  assert.deepEqual(
    profileExtras({
      about_me: "About",
      age: 42,
      gender: "Woman",
      profile_visibility: "public",
      photo_version: "photo-version-1",
    }),
    {
      aboutMe: "About",
      age: 42,
      gender: "Woman",
      profileVisibility: "public",
      photoVersion: "photo-version-1",
    },
  );
  assert.equal(profileChanges({ age: null }).age, null);
  assert.throws(() => profileChanges({ age: 121 }), {
    message: "Enter an age from 1 to 120, or leave it blank.",
  });
});

test("private profiles are hidden from other authenticated users", async () => {
  const app = routeApp();
  const db = {
    async query() {
      return {
        rows: [
          {
            id: peerId,
            firebase_uid: peerUid,
            full_name: "Private Member",
            profile_visibility: "private",
            interests: [],
          },
        ],
      };
    },
  };
  installProfileRoutes(app, db);

  const response = await invoke(app.routes.get("GET /api/profiles/:uid"), {
    params: { uid: peerUid },
  });

  assert.equal(response.code, 404);
  assert.deepEqual(response.value, { message: "Profile not found." });
});

test("people route exposes Firebase UIDs and parameterizes the current user", async () => {
  const app = routeApp();
  let call;
  const db = {
    async query(sql, values) {
      call = { sql, values };
      return {
        rows: [
          { id: peerId, firebase_uid: peerUid, full_name: "Member", area: null },
        ],
      };
    },
  };
  installMessagingRoutes(app, db);

  const response = await invoke(app.routes.get("GET /api/people"));

  assert.deepEqual(response.value.people, [
    { id: peerUid, name: "Member", area: "" },
  ]);
  assert.deepEqual(call.values, [viewerId]);
  assert.match(call.sql, /\$1::uuid/);
  assert.match(call.sql, /contact_blocks/);
});

test("people search matches words in SQL and escapes LIKE wildcards", async () => {
  const app = routeApp();
  let call;
  const db = {
    async query(sql, values) {
      call = { sql, values };
      return {
        rows: [
          {
            id: peerId,
            firebase_uid: peerUid,
            full_name: "José Member",
            area: "Oakville",
            interests: ["Cycling"],
          },
        ],
      };
    },
  };
  installProfileRoutes(app, db);

  const response = await invoke(app.routes.get("GET /api/public-people"), {
    query: { q: "  JOSÉ  100%_off " },
  });

  assert.deepEqual(call.values, [viewerId, null, ["jose", "100\\%\\_off"]]);
  assert.match(call.sql, /NOT LIKE '%' \|\| w\.word \|\| '%'/);
  assert.match(call.sql, /translate\(lower\(/);
  assert.deepEqual(response.value.people.map((p) => p.id), [peerUid]);
  assert.equal(response.value.nextCursor, null);
});

test("conversation summaries include the peer Firebase UID for their avatar", async () => {
  const app = routeApp();
  const db = {
    async query() {
      return {
        rows: [
          {
            id: conversationId,
            peer_uid: "firebase-peer",
            full_name: "Peer",
            area: "Toronto",
            last_message_text: "Hello",
            updated_at: new Date("2024-01-01T00:00:00Z"),
            unread_count: 0,
          },
        ],
      };
    },
  };
  installMessagingRoutes(app, db);

  const response = await invoke(
    app.routes.get("GET /api/conversations"),
  );

  assert.equal(response.value.conversations[0].peerId, "firebase-peer");
});

test("conversations start from a peer Firebase UID and resolve it to the UUID", async () => {
  const app = routeApp();
  const writes = [];
  const db = {
    async query(sql, values) {
      assert.match(sql, /FROM direct_conversations c/);
      assert.equal(values[0], viewerId);
      return {
        rows: [
          {
            id: values[1],
            peer_uid: peerUid,
            full_name: "Peer",
            area: "",
            last_message_text: null,
            updated_at: new Date("2024-01-01T00:00:00Z"),
            unread_count: 0,
          },
        ],
      };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.includes("WHERE firebase_uid = $1")) {
            assert.deepEqual(values, [peerUid]);
            return { rows: [{ id: peerId }], rowCount: 1 };
          }
          if (sql.includes("FROM contact_blocks")) return { rows: [], rowCount: 0 };
          if (sql.includes("INSERT INTO direct_conversations")) {
            writes.push(values);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected SQL in test: ${sql}`);
        },
        release() {},
      };
    },
  };
  installMessagingRoutes(app, db);

  const response = await invoke(app.routes.get("POST /api/conversations"), {
    body: { peerId: peerUid },
  });

  assert.equal(response.code, 200);
  assert.equal(response.value.conversation.peerId, peerUid);
  assert.deepEqual(writes[0].slice(1), [viewerId, peerId]);

  const rejected = await invoke(app.routes.get("POST /api/conversations"), {
    body: { peerId: "firebase-viewer" },
  });
  assert.equal(rejected.code, 400);
});

test("message retries are idempotent", async () => {
  const app = routeApp();
  const messages = new Map();
  const inserts = [];
  const db = {
    async query(sql, values) {
      assert.match(sql, /SELECT c\.id, peer\.firebase_uid AS peer_uid/);
      assert.deepEqual(values, [viewerId, conversationId]);
      return {
        rows: [
          {
            id: conversationId,
            full_name: "Peer",
            area: "Toronto",
            last_message_text: null,
            updated_at: new Date("2024-01-01T00:00:00Z"),
            unread_count: 0,
          },
        ],
      };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("FROM direct_conversations")) {
            return {
              rows: [
                {
                  id: conversationId,
                  user_low: viewerId,
                  user_high: peerId,
                  updated_at: new Date("2024-01-01T00:00:00Z"),
                  last_message_id: null,
                },
              ],
            };
          }
          if (sql.includes("FROM contact_blocks")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("FROM direct_messages")) {
            const message = messages.get(values[1]);
            return { rows: message ? [message] : [], rowCount: message ? 1 : 0 };
          }
          if (sql.includes("INSERT INTO direct_messages")) {
            const message = {
              id: values[1],
              sender_id: values[2],
              text: values[3],
              created_at: new Date(values[4]),
            };
            messages.set(values[1], message);
            inserts.push(message);
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("UPDATE direct_conversations")) {
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected SQL in test: ${sql}`);
        },
        release() {},
      };
    },
  };
  installMessagingRoutes(app, db);

  const first = await invoke(
    app.routes.get("POST /api/conversations/:id/messages"),
    {
      params: { id: conversationId },
      body: { id: "client-message-1", text: " Hello " },
    },
  );
  const retry = await invoke(
    app.routes.get("POST /api/conversations/:id/messages"),
    {
      params: { id: conversationId },
      body: { id: "client-message-1", text: " Hello " },
    },
  );

  assert.equal(first.code, 200);
  assert.deepEqual(retry.value, first.value);
  assert.equal(first.value.message.senderId, "firebase-viewer");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].sender_id, viewerId);
  assert.equal(inserts[0].text, "Hello");
});
