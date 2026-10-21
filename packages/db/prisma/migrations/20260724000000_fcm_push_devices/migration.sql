ALTER TABLE "notification_events"
  DROP COLUMN "ntfy_topic";

ALTER TABLE "notification_deliveries"
  DROP COLUMN "ntfy_topic";

CREATE TABLE "push_devices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "user_agent" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "push_devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_user_id_is_enabled_idx" ON "push_devices"("user_id", "is_enabled");
CREATE INDEX "push_devices_last_seen_at_idx" ON "push_devices"("last_seen_at");
