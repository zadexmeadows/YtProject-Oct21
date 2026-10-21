CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ntfy_topic TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_event_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES chat_authors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_event_users_unique UNIQUE (event_id, author_id)
);

CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  chat_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  ntfy_topic TEXT NOT NULL,
  status "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  attempted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_deliveries_unique UNIQUE (event_id, chat_message_id)
);

CREATE INDEX notification_events_enabled_created_idx ON notification_events(is_enabled, created_at);
CREATE INDEX notification_events_last_triggered_at_idx ON notification_events(last_triggered_at);
CREATE INDEX notification_event_users_author_id_idx ON notification_event_users(author_id);
CREATE INDEX notification_deliveries_status_idx ON notification_deliveries(status);
CREATE INDEX notification_deliveries_created_at_idx ON notification_deliveries(created_at);
