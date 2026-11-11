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

test("profile routes query public profile data with UUID parameters", async () => {
  const app = routeApp();
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [
          {
            id: peerId,
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
    params: { uid: peerId },
  });

  assert.equal(response.code, 200);
  assert.equal(response.value.profile.id, peerId);
  assert.equal(response.value.profile.fullName, "Public Member");
  assert.equal(response.value.profile.age, 34);
  assert.deepEqual(response.value.profile.interests, ["Walking & outdoors"]);
  assert.equal(calls[0].values[0], peerId);
  assert.match(calls[0].sql, /\$1::uuid/);
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
    params: { uid: peerId },
  });

  assert.equal(response.code, 404);
  assert.deepEqual(response.value, { message: "Profile not found." });
});

test("people route exposes user UUIDs and parameterizes the current user", async () => {
  const app = routeApp();
  let call;
  const db = {
    async query(sql, values) {
      call = { sql, values };
      return {
        rows: [{ id: peerId, full_name: "Member", area: null }],
      };
    },
  };
  installMessagingRoutes(app, db);

  const response = await invoke(app.routes.get("GET /api/people"));

  assert.deepEqual(response.value.people, [
    { id: peerId, name: "Member", area: "" },
  ]);
  assert.deepEqual(call.values, [viewerId]);
  assert.match(call.sql, /\$1::uuid/);
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
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].text, "Hello");
});
