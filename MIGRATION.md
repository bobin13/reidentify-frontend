# Backend persistence migration

This note explains the change from the previous Firestore-backed backend to
PostgreSQL while keeping Firebase Authentication.

## What changed

- Firebase Authentication remains responsible for sign-up, sign-in, and user
  identity. The backend verifies each Firebase ID token.
- PostgreSQL is the backend's application-data store. The verified Firebase
  UID maps to `users.firebase_uid`; the corresponding PostgreSQL UUID is used
  for foreign keys.
- The mobile app continues to call the Node API. PostgreSQL credentials,
  Firebase service-account credentials, and database TLS certificates must
  never be shipped in the mobile app.
- The existing API routes are being retained so clients can continue using
  profiles, interests, groups, group membership, messaging, events, map
  features, places, and news through the backend.

## Database upgrade

Run the additive, repeatable migration from the repository root:

```bash
npm run db:migrate --prefix backend
```

The migration creates/extends the profile, interest, group, membership,
message, event, contact-block, report, photo, external-event-cache, and
application-metadata schema. It seeds any missing entries from the app's
interest catalogue. Existing PostgreSQL rows are preserved; repeated runs do
not duplicate the catalogue, and the schema version is recorded in
`schema_migrations`.

The migration does not drop old tables or columns.

## Existing Firestore data

Applying the PostgreSQL schema does **not** copy existing Firestore documents.
Firebase accounts remain valid, but existing Firestore profile, group, event,
and message records need a separate, explicitly configured data import before
they will appear from PostgreSQL-backed routes. Keep the old Firestore project
and its data until that import has been planned and verified.

## Backend configuration

The backend reads the repository-root `.env`. Required settings are
`FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `HOST_NAME`,
`PG_PORT`, `PG_DATABASE`, `PG_USER`, and `PG_PASSWORD`. PostgreSQL TLS
certificate verification is enabled; `PG_CA_PATH` defaults to
`credentials/ca.pem`.

Start the backend after applying the schema:

```bash
npm start --prefix backend
```

The Firebase service-account file and `.env` are local secrets. Do not commit
them, expose them through an `EXPO_PUBLIC_` variable, or embed them in the app.
