CREATE TYPE "StreamRecoveryStatus" AS ENUM (
  'WAITING',
  'RUNNING',
  'FAILED',
  'ACKNOWLEDGED',
  'RECOVERED'
);

ALTER TABLE "streams"
  ADD COLUMN "channel_id" TEXT,
  ADD COLUMN "recovery_status" "StreamRecoveryStatus",
  ADD COLUMN "recovery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recovery_started_at" TIMESTAMPTZ,
  ADD COLUMN "recovery_next_attempt_at" TIMESTAMPTZ,
  ADD COLUMN "recovery_acknowledged_at" TIMESTAMPTZ,
  ADD COLUMN "recovery_last_error" TEXT;

CREATE INDEX "streams_recovery_status_recovery_next_attempt_at_idx"
  ON "streams"("recovery_status", "recovery_next_attempt_at");
