-- Allow historical (soft-deleted) stream records to coexist with a new
-- stream for the same YouTube video, while preventing duplicate active
-- captures.
ALTER TABLE streams DROP CONSTRAINT IF EXISTS streams_video_id_key;
CREATE UNIQUE INDEX streams_active_video_id_unique
  ON streams(video_id)
  WHERE deleted_at IS NULL;
