-- ReIdentify PostgreSQL schema.
-- Firebase remains responsible for authentication; firebase_uid links an
-- authenticated Firebase account to its PostgreSQL application profile.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  handle TEXT UNIQUE
    CHECK (handle IS NULL OR handle ~ '^@[A-Za-z0-9_.-]+$'),
  area TEXT NOT NULL DEFAULT '' CHECK (char_length(area) <= 120),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 1000),
  languages TEXT[] NOT NULL DEFAULT '{}',
  avatar_url TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_area_idx ON users (area);

CREATE TABLE IF NOT EXISTS interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO interests (name)
VALUES
  ('Walking & outdoors'),
  ('Learning & books'),
  ('Volunteering'),
  ('Music & culture')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_interests (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, interest_id)
);

CREATE INDEX IF NOT EXISTS user_interests_interest_idx
  ON user_interests (interest_id, user_id);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('light', 'dark')),
  activity_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  message_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  meeting_details TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_groups_area_idx
  ON community_groups (area);

CREATE TABLE IF NOT EXISTS group_interests (
  group_id UUID NOT NULL REFERENCES community_groups (id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests (id) ON DELETE RESTRICT,
  PRIMARY KEY (group_id, interest_id)
);

CREATE INDEX IF NOT EXISTS group_interests_interest_idx
  ON group_interests (interest_id, group_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  group_id UUID NOT NULL REFERENCES community_groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'left', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_memberships_user_idx
  ON group_memberships (user_id, status, group_id);

CREATE INDEX IF NOT EXISTS group_memberships_group_status_idx
  ON group_memberships (group_id, status, user_id);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES community_groups (id) ON DELETE SET NULL,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location_name TEXT NOT NULL DEFAULT '',
  location_address TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(8, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS activities_upcoming_idx
  ON activities (starts_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS activities_group_idx
  ON activities (group_id, starts_at);

CREATE TABLE IF NOT EXISTS activity_interests (
  activity_id UUID NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests (id) ON DELETE RESTRICT,
  PRIMARY KEY (activity_id, interest_id)
);

CREATE INDEX IF NOT EXISTS activity_interests_interest_idx
  ON activity_interests (interest_id, activity_id);

CREATE TABLE IF NOT EXISTS activity_rsvps (
  activity_id UUID NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'going'
    CHECK (status IN ('interested', 'going', 'waitlisted', 'cancelled')),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX IF NOT EXISTS activity_rsvps_user_idx
  ON activity_rsvps (user_id, status, activity_id);

CREATE TABLE IF NOT EXISTS saved_activities (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, activity_id)
);

CREATE TABLE IF NOT EXISTS user_connections (
  user_low_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_high_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by IN (user_low_id, user_high_id))
);

CREATE INDEX IF NOT EXISTS user_connections_high_idx
  ON user_connections (user_high_id, status, user_low_id);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
  ON conversation_participants (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
    REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users (id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS messages_conversation_order_idx
  ON messages (conversation_id, sent_at, id);

CREATE INDEX IF NOT EXISTS messages_sender_idx
  ON messages (sender_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS news_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO news_sources (name, url)
VALUES
  ('City of Toronto', 'https://www.toronto.ca/news/feed/'),
  ('Toronto Public Library', 'https://www.tpl.ca/news/feed/')
ON CONFLICT (url) DO NOTHING;

CREATE TABLE IF NOT EXISTS news_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES news_sources (id) ON DELETE CASCADE,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS news_articles_published_idx
  ON news_articles (published_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS news_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);

INSERT INTO news_topics (slug, name)
VALUES
  ('community', 'Community'),
  ('health-safety', 'Health & safety'),
  ('culture-learning', 'Culture & learning')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS news_article_topics (
  article_id UUID NOT NULL REFERENCES news_articles (id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES news_topics (id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, topic_id)
);

CREATE TABLE IF NOT EXISTS news_article_interests (
  article_id UUID NOT NULL REFERENCES news_articles (id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests (id) ON DELETE RESTRICT,
  PRIMARY KEY (article_id, interest_id)
);
