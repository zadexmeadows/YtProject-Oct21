import { Prisma, PrismaClient } from '@prisma/client';

export interface MessageQueryFilters {
  streamId?: string;
  videoId?: string;
  authorIds?: string[];
  timelineAuthorId?: string;
  authorName?: string;
  authorChannelId?: string;
  q?: string;
  messageType?: string;
  from?: string;
  to?: string;
  hasModeratorBadge?: boolean;
  hasMemberBadge?: boolean;
  hasOwnerBadge?: boolean;
}

export interface MessageListOptions {
  page?: number;
  pageSize?: number;
  order?: 'asc' | 'desc';
}

export interface MessageRow {
  id: string;
  messageId: string;
  streamId: string;
  videoId: string;
  streamTitle: string | null;
  authorChannelId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  messageText: string;
  messageType: string;
  badges: unknown;
  amount: string | null;
  currency: string | null;
  originalTimestamp: Date | null;
  capturedAt: Date;
  rawPayload: unknown;
}

function buildWhere(filters: MessageQueryFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`s.deleted_at IS NULL`];

  if (filters.streamId) clauses.push(Prisma.sql`m.stream_id = ${filters.streamId}::uuid`);
  if (filters.videoId) clauses.push(Prisma.sql`m.video_id = ${filters.videoId}`);
  if (filters.authorIds?.length) {
    const authorIds = Prisma.join(filters.authorIds.map((authorId) => Prisma.sql`${authorId}::uuid`));
    clauses.push(Prisma.sql`m.author_id IN (${authorIds})`);
  }
  if (filters.authorName) clauses.push(Prisma.sql`m.author_name ILIKE ${`%${filters.authorName}%`}`);
  if (filters.authorChannelId)
    clauses.push(Prisma.sql`m.author_channel_id = ${filters.authorChannelId}`);
  if (filters.messageType) clauses.push(Prisma.sql`m.message_type = ${filters.messageType}::"MessageType"`);
  if (filters.from) clauses.push(Prisma.sql`m.captured_at >= ${new Date(filters.from)}`);
  if (filters.to) clauses.push(Prisma.sql`m.captured_at <= ${new Date(filters.to)}`);
  if (filters.q) {
    clauses.push(
      Prisma.sql`to_tsvector('simple', coalesce(m.message_text, '')) @@ plainto_tsquery('simple', ${filters.q})`,
    );
  }
  if (filters.hasModeratorBadge) clauses.push(Prisma.sql`m.badges @> '[{"type":"moderator"}]'::jsonb`);
  if (filters.hasMemberBadge) clauses.push(Prisma.sql`m.badges @> '[{"type":"member"}]'::jsonb`);
  if (filters.hasOwnerBadge) clauses.push(Prisma.sql`m.badges @> '[{"type":"owner"}]'::jsonb`);
  if (filters.timelineAuthorId) {
    const streamClause = filters.streamId
      ? Prisma.sql`AND primary_message.stream_id = ${filters.streamId}::uuid`
      : Prisma.sql``;
    const fromClause = filters.from
      ? Prisma.sql`AND primary_message.captured_at >= ${new Date(filters.from)}`
      : Prisma.sql``;
    const toClause = filters.to
      ? Prisma.sql`AND primary_message.captured_at <= ${new Date(filters.to)}`
      : Prisma.sql``;

    clauses.push(Prisma.sql`
      EXISTS (
        WITH primary_ordered AS (
          SELECT
            primary_message.id,
            primary_message.captured_at,
            CASE
              WHEN lag(primary_message.captured_at) OVER (
                ORDER BY primary_message.captured_at ASC, primary_message.id ASC
              ) IS NULL THEN 1
              WHEN primary_message.captured_at - lag(primary_message.captured_at) OVER (
                ORDER BY primary_message.captured_at ASC, primary_message.id ASC
              ) >= (30 * interval '1 minute') THEN 1
              ELSE 0
            END AS starts_new_session
          FROM chat_messages primary_message
          INNER JOIN streams primary_stream ON primary_stream.id = primary_message.stream_id
          WHERE primary_message.author_id = ${filters.timelineAuthorId}::uuid
            AND primary_stream.deleted_at IS NULL
            ${streamClause}
            ${fromClause}
            ${toClause}
        ),
        primary_numbered AS (
          SELECT
            id,
            captured_at,
            SUM(starts_new_session) OVER (
              ORDER BY captured_at ASC, id ASC
            )::int AS session_number
          FROM primary_ordered
        ),
        primary_windows AS (
          SELECT
            MIN(captured_at) AS start_at,
            MAX(captured_at) AS end_at
          FROM primary_numbered
          GROUP BY session_number
        )
        SELECT 1
        FROM primary_windows
        WHERE m.captured_at >= primary_windows.start_at
          AND m.captured_at <= primary_windows.end_at
      )
    `);
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`;
}

export async function findMessages(
  db: PrismaClient,
  filters: MessageQueryFilters,
  options: MessageListOptions = {},
): Promise<MessageRow[]> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, options.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const where = buildWhere(filters);
  const orderBy =
    options.order === 'asc'
      ? Prisma.sql`ORDER BY m.captured_at ASC, m.id ASC`
      : Prisma.sql`ORDER BY m.captured_at DESC, m.id DESC`;

  return db.$queryRaw<MessageRow[]>`
    SELECT
      m.id::text AS "id",
      m.message_id AS "messageId",
      m.stream_id::text AS "streamId",
      m.video_id AS "videoId",
      s.title AS "streamTitle",
      m.author_channel_id AS "authorChannelId",
      m.author_name AS "authorName",
      m.author_avatar_url AS "authorAvatarUrl",
      m.message_text AS "messageText",
      m.message_type::text AS "messageType",
      m.badges AS "badges",
      m.amount::text AS "amount",
      m.currency AS "currency",
      m.original_timestamp AS "originalTimestamp",
      m.captured_at AS "capturedAt",
      m.raw_payload AS "rawPayload"
    FROM chat_messages m
    INNER JOIN streams s ON s.id = m.stream_id
    ${where}
    ${orderBy}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `;
}

export async function countMessages(
  db: PrismaClient,
  filters: MessageQueryFilters,
): Promise<number> {
  const where = buildWhere(filters);
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM chat_messages m
    INNER JOIN streams s ON s.id = m.stream_id
    ${where}
  `;
  return rows[0]?.count ?? 0;
}

export async function findMessagesForExport(
  db: PrismaClient,
  filters: MessageQueryFilters,
  maxRows = 100000,
): Promise<MessageRow[]> {
  const where = buildWhere(filters);
  return db.$queryRaw<MessageRow[]>`
    SELECT
      m.id::text AS "id",
      m.message_id AS "messageId",
      m.stream_id::text AS "streamId",
      m.video_id AS "videoId",
      s.title AS "streamTitle",
      m.author_channel_id AS "authorChannelId",
      m.author_name AS "authorName",
      m.author_avatar_url AS "authorAvatarUrl",
      m.message_text AS "messageText",
      m.message_type::text AS "messageType",
      m.badges AS "badges",
      m.amount::text AS "amount",
      m.currency AS "currency",
      m.original_timestamp AS "originalTimestamp",
      m.captured_at AS "capturedAt",
      m.raw_payload AS "rawPayload"
    FROM chat_messages m
    INNER JOIN streams s ON s.id = m.stream_id
    ${where}
    ORDER BY m.captured_at ASC
    LIMIT ${maxRows}
  `;
}
