CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'VIEWER');
CREATE TYPE "StreamStatus" AS ENUM ('PENDING', 'CAPTURING', 'PAUSED', 'ENDED', 'FAILED', 'RETRYING', 'STOPPED');
CREATE TYPE "MessageType" AS ENUM ('NORMAL', 'SUPERCHAT', 'MEMBERSHIP', 'PINNED', 'MODERATOR', 'OWNER', 'SYSTEM');
CREATE TYPE "CaptureSessionStatus" AS ENUM ('RUNNING', 'STOPPED', 'FAILED');
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'CSV', 'EXCEL', 'JSON');
CREATE TYPE "ExportJobType" AS ENUM ('FULL_STREAM', 'FILTERED_CHAT', 'USER_CHAT', 'DATE_RANGE');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role "UserRole" NOT NULL DEFAULT 'ADMIN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL UNIQUE,
  title TEXT,
  status "StreamStatus" NOT NULL DEFAULT 'PENDING',
  live_chat_url TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  last_message_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_channel_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  author_id UUID REFERENCES chat_authors(id) ON DELETE SET NULL,
  author_channel_id TEXT,
  author_name TEXT NOT NULL,
  author_avatar_url TEXT,
  message_text TEXT NOT NULL,
  message_type "MessageType" NOT NULL DEFAULT 'NORMAL',
  badges JSONB,
  amount NUMERIC(12, 2),
  currency TEXT,
  original_timestamp TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL,
  CONSTRAINT chat_messages_stream_message_unique UNIQUE (stream_id, message_id)
);

CREATE TABLE capture_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL,
  status "CaptureSessionStatus" NOT NULL DEFAULT 'RUNNING',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT
);

CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
  format "ExportFormat" NOT NULL,
  type "ExportJobType" NOT NULL,
  filters JSONB NOT NULL,
  file_path TEXT,
  file_name TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX streams_status_idx ON streams(status);
CREATE INDEX streams_video_id_idx ON streams(video_id);
CREATE INDEX streams_last_message_at_idx ON streams(last_message_at);

CREATE INDEX chat_authors_display_name_idx ON chat_authors(display_name);

CREATE INDEX chat_messages_stream_id_idx ON chat_messages(stream_id);
CREATE INDEX chat_messages_video_id_idx ON chat_messages(video_id);
CREATE INDEX chat_messages_author_name_idx ON chat_messages(author_name);
CREATE INDEX chat_messages_author_channel_id_idx ON chat_messages(author_channel_id);
CREATE INDEX chat_messages_captured_at_idx ON chat_messages(captured_at);
CREATE INDEX chat_messages_message_type_idx ON chat_messages(message_type);
CREATE INDEX chat_messages_message_text_fts_idx
  ON chat_messages USING GIN (to_tsvector('simple', coalesce(message_text, '')));

CREATE INDEX capture_sessions_stream_id_idx ON capture_sessions(stream_id);
CREATE INDEX capture_sessions_worker_id_idx ON capture_sessions(worker_id);
CREATE INDEX capture_sessions_status_idx ON capture_sessions(status);

CREATE INDEX export_jobs_status_idx ON export_jobs(status);
CREATE INDEX export_jobs_created_at_idx ON export_jobs(created_at);

CREATE INDEX audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX audit_logs_action_idx ON audit_logs(action);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);
