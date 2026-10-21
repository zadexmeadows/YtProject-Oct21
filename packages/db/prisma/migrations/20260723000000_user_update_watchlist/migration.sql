CREATE TABLE user_update_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES chat_authors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_update_watches_user_author_unique UNIQUE (user_id, author_id)
);

CREATE INDEX user_update_watches_user_created_idx ON user_update_watches(user_id, created_at);
CREATE INDEX user_update_watches_author_id_idx ON user_update_watches(author_id);

-- Production creates this index concurrently before running migrations.
-- IF NOT EXISTS keeps this migration complete for fresh installations.
CREATE INDEX IF NOT EXISTS chat_messages_author_session_idx
  ON chat_messages(author_id, captured_at, id);
