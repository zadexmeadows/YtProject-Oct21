import { Router } from 'express';
import { Prisma, prisma } from '@ytbot/db';
import { userUpdateCreateSchema } from '@ytbot/shared';
import { auditLog } from '../lib/audit';
import { ApiError, asyncHandler, validateBody } from '../lib/http';

export const usersRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GROUPED_AUTHORS = 10;
const GROUPED_MESSAGE_LIMIT = 500;
const SESSION_GAP_MINUTES = 30;
const DEFAULT_SESSION_PAGE_SIZE = 25;
const MAX_SESSION_PAGE_SIZE = 100;
const DEFAULT_SESSION_MESSAGE_PAGE_SIZE = 200;
const MAX_SESSION_MESSAGE_PAGE_SIZE = 500;
const DEFAULT_INTELLIGENCE_MESSAGE_PAGE_SIZE = 500;
const MAX_INTELLIGENCE_MESSAGE_PAGE_SIZE = 500;
const MAX_USER_UPDATE_WATCHES = 100;

usersRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.chatAuthor.findMany({
      where: {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { authorChannelId: { equals: q } }
        ]
      },
      take: 25,
      orderBy: { lastSeenAt: 'desc' },
      include: {
        _count: { select: { messages: true } }
      }
    });

    res.json({ users });
  }),
);

usersRouter.get(
  '/updates',
  asyncHandler(async (req, res) => {
    res.json({ users: await getUserUpdateRows(req.session.user!.id) });
  }),
);

usersRouter.post(
  '/updates',
  asyncHandler(async (req, res) => {
    const input = validateBody(userUpdateCreateSchema, req.body);
    const [author, watchCount] = await Promise.all([
      prisma.chatAuthor.findUnique({
        where: { id: input.authorId },
        select: { id: true }
      }),
      prisma.userUpdateWatch.count({
        where: { userId: req.session.user!.id }
      })
    ]);

    if (!author) {
      throw new ApiError(404, 'Chat user not found', 'NOT_FOUND');
    }
    if (watchCount >= MAX_USER_UPDATE_WATCHES) {
      throw new ApiError(400, `You can follow up to ${MAX_USER_UPDATE_WATCHES} users`, 'WATCHLIST_LIMIT');
    }

    try {
      await prisma.userUpdateWatch.create({
        data: {
          userId: req.session.user!.id,
          authorId: input.authorId
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'User is already in Users Update', 'ALREADY_ADDED');
      }
      throw error;
    }

    await auditLog(req, 'user_update.added', {
      entityType: 'chat_author',
      entityId: input.authorId
    });

    res.status(201).json({ users: await getUserUpdateRows(req.session.user!.id) });
  }),
);

usersRouter.delete(
  '/updates/:authorId',
  asyncHandler(async (req, res) => {
    const authorId = String(req.params.authorId ?? '');
    if (!UUID_PATTERN.test(authorId)) {
      throw new ApiError(400, 'Invalid chat user ID', 'VALIDATION_ERROR');
    }

    const result = await prisma.userUpdateWatch.deleteMany({
      where: {
        userId: req.session.user!.id,
        authorId
      }
    });

    if (result.count === 0) {
      throw new ApiError(404, 'User is not in Users Update', 'NOT_FOUND');
    }

    await auditLog(req, 'user_update.removed', {
      entityType: 'chat_author',
      entityId: authorId
    });

    res.json({ users: await getUserUpdateRows(req.session.user!.id) });
  }),
);

usersRouter.get(
  '/intelligence',
  asyncHandler(async (req, res) => {
    const authorIds = parseAuthorIds(req.query.authorIds);

    if (authorIds.length === 0) {
      res.status(400).json({ error: 'Select at least one chat user', code: 'VALIDATION_ERROR' });
      return;
    }

    if (authorIds.some((authorId) => !UUID_PATTERN.test(authorId))) {
      res.status(400).json({ error: 'Invalid chat user ID', code: 'VALIDATION_ERROR' });
      return;
    }

    const streamId = typeof req.query.streamId === 'string' ? req.query.streamId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const primaryAuthorId = typeof req.query.primaryAuthorId === 'string' ? req.query.primaryAuthorId.trim() : authorIds[0];

    if (!primaryAuthorId || !authorIds.includes(primaryAuthorId)) {
      res.status(400).json({ error: 'Primary user must be one of the selected chat users', code: 'VALIDATION_ERROR' });
      return;
    }

    const intelligence = await getUserIntelligence(authorIds, {
      ...(streamId ? { streamId } : {}),
      from,
      to,
      primaryAuthorId
    });

    if (intelligence.authors.length === 0) {
      res.status(404).json({ error: 'Chat users not found', code: 'NOT_FOUND' });
      return;
    }

    res.json(intelligence);
  }),
);

usersRouter.get(
  '/intelligence/messages',
  asyncHandler(async (req, res) => {
    const authorIds = parseAuthorIds(req.query.authorIds);
    if (authorIds.length === 0 || authorIds.some((authorId) => !UUID_PATTERN.test(authorId))) {
      throw new ApiError(400, 'Select valid chat users', 'VALIDATION_ERROR');
    }

    const primaryAuthorId = typeof req.query.primaryAuthorId === 'string'
      ? req.query.primaryAuthorId.trim()
      : authorIds[0];
    if (!primaryAuthorId || !authorIds.includes(primaryAuthorId)) {
      throw new ApiError(400, 'Primary user must be one of the selected chat users', 'VALIDATION_ERROR');
    }

    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(
      parsePositiveInt(req.query.pageSize, DEFAULT_INTELLIGENCE_MESSAGE_PAGE_SIZE),
      MAX_INTELLIGENCE_MESSAGE_PAGE_SIZE,
    );
    const orderWindowHours = parsePositiveInt(req.query.orderWindowHours, 0);
    const orderAnchor = parseOptionalDate(req.query.orderAnchor) ?? new Date();
    const result = await getUserIntelligenceMessagePage(authorIds, {
      primaryAuthorId,
      ...(typeof req.query.streamId === 'string' ? { streamId: req.query.streamId } : {}),
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to),
      ...(orderWindowHours > 0 ? { orderWindowSeconds: orderWindowHours * 60 * 60 } : {}),
      orderAnchor,
      page,
      pageSize
    });

    res.json(result);
  }),
);

usersRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const authorId = String(req.query.authorId ?? '').trim();
    if (!UUID_PATTERN.test(authorId)) {
      res.status(400).json({ error: 'Invalid chat user ID', code: 'VALIDATION_ERROR' });
      return;
    }

    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const streamId = typeof req.query.streamId === 'string' && UUID_PATTERN.test(req.query.streamId)
      ? req.query.streamId
      : undefined;
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, DEFAULT_SESSION_PAGE_SIZE), MAX_SESSION_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const fromClause = from ? Prisma.sql`AND captured_at >= ${from}` : Prisma.sql``;
    const toClause = to ? Prisma.sql`AND captured_at <= ${to}` : Prisma.sql``;
    const streamClause = streamId ? Prisma.sql`AND stream_id = ${streamId}::uuid` : Prisma.sql``;

    const rows = await prisma.$queryRaw<
      Array<{
        sessionNumber: number;
        streamId: string;
        videoId: string;
        streamTitle: string | null;
        startAt: Date;
        endAt: Date;
        durationSeconds: number;
        totalMessages: number;
        preview: string | null;
      }>
    >`
      WITH ordered AS (
        SELECT
          id,
          stream_id,
          captured_at,
          message_text,
          CASE
            WHEN lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) IS NULL THEN 1
            WHEN stream_id IS DISTINCT FROM lag(stream_id) OVER (ORDER BY captured_at ASC, id ASC) THEN 1
            WHEN captured_at - lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) >= (${SESSION_GAP_MINUTES} * interval '1 minute') THEN 1
            ELSE 0
          END AS starts_new_session
        FROM chat_messages
        WHERE author_id = ${authorId}::uuid
        ${fromClause}
        ${toClause}
        ${streamClause}
      ),
      numbered AS (
        SELECT
          id,
          stream_id,
          captured_at,
          message_text,
          SUM(starts_new_session) OVER (ORDER BY captured_at ASC, id ASC)::int AS session_number
        FROM ordered
      ),
      grouped AS (
        SELECT
          session_number AS "sessionNumber",
          (ARRAY_AGG(stream_id ORDER BY captured_at ASC, id ASC))[1]::text AS "streamId",
          MIN(captured_at) AS "startAt",
          MAX(captured_at) AS "endAt",
          EXTRACT(EPOCH FROM (MAX(captured_at) - MIN(captured_at)))::int AS "durationSeconds",
          COUNT(*)::int AS "totalMessages",
          (ARRAY_AGG(NULLIF(message_text, '') ORDER BY captured_at ASC, id ASC))[1] AS preview
        FROM numbered
        GROUP BY session_number
      )
      SELECT
        grouped.*,
        streams.video_id AS "videoId",
        streams.title AS "streamTitle"
      FROM grouped
      INNER JOIN streams ON streams.id = grouped."streamId"::uuid
      ORDER BY grouped."sessionNumber" DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const countRows = await prisma.$queryRaw<Array<{ count: number }>>`
      WITH ordered AS (
        SELECT
          id,
          stream_id,
          captured_at,
          CASE
            WHEN lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) IS NULL THEN 1
            WHEN stream_id IS DISTINCT FROM lag(stream_id) OVER (ORDER BY captured_at ASC, id ASC) THEN 1
            WHEN captured_at - lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) >= (${SESSION_GAP_MINUTES} * interval '1 minute') THEN 1
            ELSE 0
          END AS starts_new_session
        FROM chat_messages
        WHERE author_id = ${authorId}::uuid
        ${fromClause}
        ${toClause}
        ${streamClause}
      ),
      numbered AS (
        SELECT
          SUM(starts_new_session) OVER (ORDER BY captured_at ASC, id ASC)::int AS session_number
        FROM ordered
      )
      SELECT COUNT(DISTINCT session_number)::int AS count
      FROM numbered
    `;

    res.json({
      sessions: rows,
      totalSessions: countRows[0]?.count ?? 0,
      page,
      pageSize
    });
  }),
);

usersRouter.get(
  '/session-messages',
  asyncHandler(async (req, res) => {
    const authorIds = parseAuthorIds(req.query.authorIds);
    if (authorIds.length === 0) {
      res.status(400).json({ error: 'Select at least one chat user', code: 'VALIDATION_ERROR' });
      return;
    }
    if (authorIds.some((authorId) => !UUID_PATTERN.test(authorId))) {
      res.status(400).json({ error: 'Invalid chat user ID', code: 'VALIDATION_ERROR' });
      return;
    }

    const from = parseRequiredDate(req.query.from);
    const to = parseRequiredDate(req.query.to);
    if (!from || !to || from.getTime() > to.getTime()) {
      res.status(400).json({ error: 'Invalid session time range', code: 'VALIDATION_ERROR' });
      return;
    }

    const streamId = typeof req.query.streamId === 'string' ? req.query.streamId.trim() : '';
    if (streamId && !UUID_PATTERN.test(streamId)) {
      res.status(400).json({ error: 'Invalid stream ID', code: 'VALIDATION_ERROR' });
      return;
    }

    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.pageSize, DEFAULT_SESSION_MESSAGE_PAGE_SIZE), MAX_SESSION_MESSAGE_PAGE_SIZE);
    const where: Prisma.ChatMessageWhereInput = {
      authorId: { in: authorIds },
      ...(streamId ? { streamId } : {}),
      capturedAt: {
        gte: from,
        lte: to
      }
    };

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where,
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { stream: true, author: true }
      }),
      prisma.chatMessage.count({ where })
    ]);

    res.json({
      messages,
      total,
      page,
      pageSize
    });
  }),
);

usersRouter.get(
  '/:authorId/intelligence',
  asyncHandler(async (req, res) => {
    const authorId = String(req.params.authorId);
    if (!UUID_PATTERN.test(authorId)) {
      res.status(400).json({ error: 'Invalid chat user ID', code: 'VALIDATION_ERROR' });
      return;
    }

    const streamId = typeof req.query.streamId === 'string' ? req.query.streamId : undefined;
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    const intelligence = await getUserIntelligence([authorId], {
      ...(streamId ? { streamId } : {}),
      from,
      to,
      primaryAuthorId: authorId
    });

    if (intelligence.authors.length === 0) {
      res.status(404).json({ error: 'Chat user not found', code: 'NOT_FOUND' });
      return;
    }

    res.json({
      ...intelligence,
      author: intelligence.authors[0]
    });
  }),
);

interface UserIntelligenceOptions {
  streamId?: string;
  from?: Date | null;
  to?: Date | null;
  primaryAuthorId?: string;
  orderWindowSeconds?: number;
  orderAnchor?: Date;
  page?: number;
  pageSize?: number;
}

interface TimelineWindow {
  startAt: Date;
  endAt: Date;
}

interface LatestUserSession {
  authorId: string;
  startAt: Date;
  endAt: Date;
  durationSeconds: number;
  totalMessages: number;
}

async function getUserUpdateRows(userId: string) {
  const watches = await prisma.userUpdateWatch.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      author: {
        include: {
          _count: { select: { messages: true } }
        }
      }
    }
  });

  const latestSessions = await getLatestUserSessions(watches.map((watch) => watch.authorId));
  const latestByAuthor = new Map(latestSessions.map((session) => [session.authorId, session]));

  const rows = watches.map((watch) => ({
    id: watch.id,
    addedAt: watch.createdAt,
    author: watch.author,
    latestSession: latestByAuthor.get(watch.authorId) ?? null
  }));

  return rows.sort((left, right) => {
    const leftActivity = left.latestSession?.endAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightActivity = right.latestSession?.endAt.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    return left.addedAt.getTime() - right.addedAt.getTime();
  });
}

async function getLatestUserSessions(authorIds: string[]) {
  if (authorIds.length === 0) return [];
  const authorIdSql = Prisma.join(authorIds.map((authorId) => Prisma.sql`${authorId}::uuid`));

  return prisma.$queryRaw<LatestUserSession[]>`
    WITH ordered AS (
      SELECT
        author_id,
        id,
        captured_at,
        CASE
          WHEN lag(captured_at) OVER (
            PARTITION BY author_id
            ORDER BY captured_at ASC, id ASC
          ) IS NULL THEN 1
          WHEN captured_at - lag(captured_at) OVER (
            PARTITION BY author_id
            ORDER BY captured_at ASC, id ASC
          ) >= (${SESSION_GAP_MINUTES} * interval '1 minute') THEN 1
          ELSE 0
        END AS starts_new_session
      FROM chat_messages
      WHERE author_id IN (${authorIdSql})
    ),
    numbered AS (
      SELECT
        author_id,
        captured_at,
        SUM(starts_new_session) OVER (
          PARTITION BY author_id
          ORDER BY captured_at ASC, id ASC
        )::int AS session_number
      FROM ordered
    ),
    grouped AS (
      SELECT
        author_id AS "authorId",
        session_number,
        MIN(captured_at) AS "startAt",
        MAX(captured_at) AS "endAt",
        EXTRACT(EPOCH FROM (MAX(captured_at) - MIN(captured_at)))::int AS "durationSeconds",
        COUNT(*)::int AS "totalMessages"
      FROM numbered
      GROUP BY author_id, session_number
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY "authorId"
          ORDER BY "endAt" DESC, session_number DESC
        ) AS session_rank
      FROM grouped
    )
    SELECT
      "authorId",
      "startAt",
      "endAt",
      "durationSeconds",
      "totalMessages"
    FROM ranked
    WHERE session_rank = 1
  `;
}

async function getUserIntelligence(authorIds: string[], options: UserIntelligenceOptions = {}) {
  const primaryAuthorId = options.primaryAuthorId ?? authorIds[0];
  if (!primaryAuthorId) {
    return {
      authors: [],
      totalMessages: 0,
      firstSeen: null,
      lastSeen: null,
      streams: [],
      timeline: [],
      mostUsedWords: [],
      messages: []
    };
  }

  const authorOrder = new Map(authorIds.map((authorId, index) => [authorId, index]));
  const [authors, primaryWindows] = await Promise.all([
    prisma.chatAuthor.findMany({
      where: { id: { in: authorIds } },
      include: { _count: { select: { messages: true } } }
    }),
    getPrimaryTimelineWindows(primaryAuthorId, options)
  ]);

  const orderedAuthors = authors.sort((a, b) => (authorOrder.get(a.id) ?? 0) - (authorOrder.get(b.id) ?? 0));

  if (primaryWindows.length === 0) {
    return {
      authors: orderedAuthors,
      totalMessages: 0,
      firstSeen: null,
      lastSeen: null,
      streams: [],
      timeline: [],
      mostUsedWords: [],
      messages: []
    };
  }

  const firstWindow = primaryWindows[0];
  const lastWindow = primaryWindows[primaryWindows.length - 1];
  const timelineWhere = primaryTimelineWhere(primaryWindows);
  const where: Prisma.ChatMessageWhereInput = {
    authorId: { in: authorIds },
    ...(options.streamId ? { streamId: options.streamId } : {}),
    ...timelineWhere
  };
  const authorIdSql = Prisma.join(authorIds.map((authorId) => Prisma.sql`${authorId}::uuid`));
  const streamClause = options.streamId ? Prisma.sql`AND stream_id = ${options.streamId}::uuid` : Prisma.sql``;
  const timelineValues = Prisma.join(
    primaryWindows.map((window) => Prisma.sql`(${window.startAt}::timestamptz, ${window.endAt}::timestamptz)`),
  );

  const [totalMessages, messages, streamGroups, timeline] = await Promise.all([
    prisma.chatMessage.count({ where }),
    prisma.chatMessage.findMany({
      where,
      orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
      take: GROUPED_MESSAGE_LIMIT,
      include: { stream: true, author: true }
    }),
    prisma.chatMessage.groupBy({
      by: ['streamId', 'videoId'],
      where,
      _count: { streamId: true },
      orderBy: { _count: { streamId: 'desc' } }
    }),
    prisma.$queryRaw<Array<{ bucket: Date; count: number }>>`
      WITH primary_windows(start_at, end_at) AS (
        VALUES ${timelineValues}
      )
      SELECT date_trunc('minute', captured_at) AS bucket, COUNT(*)::int AS count
      FROM chat_messages
      WHERE author_id IN (${authorIdSql})
      ${streamClause}
      AND EXISTS (
        SELECT 1
        FROM primary_windows
        WHERE captured_at >= start_at
          AND captured_at <= end_at
      )
      GROUP BY bucket
      ORDER BY bucket ASC
    `.catch(() => [])
  ]);

  const words = new Map<string, number>();
  for (const message of messages) {
    for (const word of message.messageText.toLowerCase().match(/[a-z0-9_#@]{3,}/g) ?? []) {
      words.set(word, (words.get(word) ?? 0) + 1);
    }
  }
  const streams = await attachStreamTitles(streamGroups);

  return {
    authors: orderedAuthors,
    totalMessages,
    firstSeen: firstWindow?.startAt ?? null,
    lastSeen: lastWindow?.endAt ?? null,
    streams,
    timeline,
    mostUsedWords: Array.from(words.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([word, count]) => ({ word, count })),
    messages
  };
}

async function getUserIntelligenceMessagePage(authorIds: string[], options: UserIntelligenceOptions) {
  const primaryAuthorId = options.primaryAuthorId ?? authorIds[0];
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? DEFAULT_INTELLIGENCE_MESSAGE_PAGE_SIZE;
  if (!primaryAuthorId) return { messages: [], total: 0, page, pageSize };

  const windows = await getPrimaryTimelineWindows(primaryAuthorId, options);
  if (windows.length === 0) return { messages: [], total: 0, page, pageSize };

  const where: Prisma.ChatMessageWhereInput = {
    authorId: { in: authorIds },
    ...(options.streamId ? { streamId: options.streamId } : {}),
    ...primaryTimelineWhere(windows)
  };
  const authorIdSql = Prisma.join(authorIds.map((authorId) => Prisma.sql`${authorId}::uuid`));
  const timelineValues = Prisma.join(
    windows.map((window) => Prisma.sql`(${window.startAt}::timestamptz, ${window.endAt}::timestamptz)`),
  );
  const streamClause = options.streamId ? Prisma.sql`AND stream_id = ${options.streamId}::uuid` : Prisma.sql``;
  const orderWindowSeconds = options.orderWindowSeconds ?? 0;
  const orderAnchor = options.orderAnchor ?? new Date();
  const orderedIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM chat_messages
    WHERE author_id IN (${authorIdSql})
      ${streamClause}
      AND EXISTS (
        SELECT 1
        FROM (VALUES ${timelineValues}) AS primary_windows(start_at, end_at)
        WHERE chat_messages.captured_at >= primary_windows.start_at
          AND chat_messages.captured_at <= primary_windows.end_at
      )
    ORDER BY
      CASE WHEN ${orderWindowSeconds} > 0
        THEN FLOOR(GREATEST(EXTRACT(EPOCH FROM (${orderAnchor}::timestamptz - captured_at)), 0) / ${orderWindowSeconds})
        ELSE 0
      END ASC,
      captured_at ASC,
      id ASC
    LIMIT ${pageSize}
    OFFSET ${(page - 1) * pageSize}
  `;
  const [messages, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { ...where, id: { in: orderedIds.map(({ id }) => id) } },
      include: { stream: true, author: true }
    }),
    prisma.chatMessage.count({ where })
  ]);
  const positionById = new Map(orderedIds.map(({ id }, index) => [id, index]));
  messages.sort((a, b) => (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0));

  return { messages, total, page, pageSize };
}

async function getPrimaryTimelineWindows(primaryAuthorId: string, options: UserIntelligenceOptions) {
  const streamClause = options.streamId ? Prisma.sql`AND stream_id = ${options.streamId}::uuid` : Prisma.sql``;
  const fromClause = options.from ? Prisma.sql`AND captured_at >= ${options.from}` : Prisma.sql``;
  const toClause = options.to ? Prisma.sql`AND captured_at <= ${options.to}` : Prisma.sql``;

  return prisma.$queryRaw<TimelineWindow[]>`
    WITH ordered AS (
      SELECT
        id,
        captured_at,
        CASE
          WHEN lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) IS NULL THEN 1
          WHEN captured_at - lag(captured_at) OVER (ORDER BY captured_at ASC, id ASC) >= (${SESSION_GAP_MINUTES} * interval '1 minute') THEN 1
          ELSE 0
        END AS starts_new_session
      FROM chat_messages
      WHERE author_id = ${primaryAuthorId}::uuid
      ${streamClause}
      ${fromClause}
      ${toClause}
    ),
    numbered AS (
      SELECT
        id,
        captured_at,
        SUM(starts_new_session) OVER (ORDER BY captured_at ASC, id ASC)::int AS session_number
      FROM ordered
    )
    SELECT
      MIN(captured_at) AS "startAt",
      MAX(captured_at) AS "endAt"
    FROM numbered
    GROUP BY session_number
    ORDER BY "startAt" ASC
  `;
}

function primaryTimelineWhere(windows: TimelineWindow[]): Pick<Prisma.ChatMessageWhereInput, 'OR'> {
  return {
    OR: windows.map((window) => ({
      capturedAt: {
        gte: window.startAt,
        lte: window.endAt
      }
    }))
  };
}

async function attachStreamTitles(streamGroups: Array<{ streamId: string; videoId: string; _count: { streamId: number } }>) {
  if (streamGroups.length === 0) return [];

  const streams = await prisma.stream.findMany({
    where: { id: { in: streamGroups.map((stream) => stream.streamId) } },
    select: { id: true, title: true }
  });
  const titleById = new Map(streams.map((stream) => [stream.id, stream.title]));

  return streamGroups.map((stream) => ({
    ...stream,
    title: titleById.get(stream.streamId) ?? null
  }));
}

function parseAuthorIds(value: unknown) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((authorId) => authorId.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_GROUPED_AUTHORS);
}

function parsePositiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRequiredDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
