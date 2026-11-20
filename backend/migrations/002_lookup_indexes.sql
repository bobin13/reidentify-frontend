BEGIN;

-- The conversation list matches `user_low = $1 OR user_high = $1`. The
-- UNIQUE (user_low, user_high) index covers user_low; this covers user_high.
CREATE INDEX IF NOT EXISTS direct_conversations_user_high_idx
  ON direct_conversations (user_high);

-- "My groups" and the unread indicator look memberships up by member. The
-- primary key (group_id, user_id) cannot serve a lookup by user_id alone.
CREATE INDEX IF NOT EXISTS group_memberships_user_idx
  ON group_memberships (user_id, status);

INSERT INTO schema_migrations (version)
VALUES ('002_lookup_indexes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
