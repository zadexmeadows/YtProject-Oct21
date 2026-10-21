import { Router } from 'express';
import { prisma } from '@ytbot/db';
import { asyncHandler } from '../lib/http';
import { redis } from '../lib/redis';

export const dashboardRouter = Router();

interface WorkerHeartbeat {
  workerId?: string;
  activeStreams?: number;
  at: string;
}

dashboardRouter.get(
  '/worker-status',
  asyncHandler(async (_req, res) => {
    const latestHeartbeat = await redis.get('ytbot:worker:last-heartbeat');
    const heartbeat = parseHeartbeat(latestHeartbeat);

    res.json({
      online: heartbeat ? Date.now() - new Date(heartbeat.at).getTime() < 30_000 : false,
      heartbeat,
    });
  }),
);

dashboardRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const cached = await redis.get('ytbot:dashboard:summary');
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    const sinceMinute = new Date(Date.now() - 60_000);
    const [messagesLastMinute, streams, messageEstimate, latestHeartbeat] = await Promise.all([
      prisma.chatMessage.count({ where: { capturedAt: { gte: sinceMinute } } }),
      prisma.stream.findMany({
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          videoId: true,
          title: true,
          status: true,
          lastMessageAt: true,
          errorMessage: true,
        },
      }),
      prisma.$queryRaw<Array<{ estimate: bigint }>>`
        SELECT COALESCE(reltuples, 0)::bigint AS estimate
        FROM pg_class
        WHERE oid = 'public.chat_messages'::regclass
      `,
      redis.get('ytbot:worker:last-heartbeat'),
    ]);

    const heartbeat = parseHeartbeat(latestHeartbeat);

    const summary = {
      activeStreams: streams.filter((stream) =>
        ['PENDING', 'CAPTURING', 'RETRYING'].includes(stream.status),
      ).length,
      totalMessages: Number(messageEstimate[0]?.estimate ?? 0),
      messagesPerMinute: messagesLastMinute,
      streams: streams.map((stream) => ({ ...stream, _count: { messages: null } })),
      worker: {
        online: heartbeat ? Date.now() - new Date(heartbeat.at).getTime() < 30_000 : false,
        heartbeat,
      },
      storage: {
        database: 'ok',
        redis: 'ok',
      },
    };

    await redis.set('ytbot:dashboard:summary', JSON.stringify(summary), 'EX', 60);
    res.json(summary);
  }),
);

function parseHeartbeat(value: string | null): WorkerHeartbeat | null {
  if (!value) return null;

  try {
    const heartbeat = JSON.parse(value) as {
      workerId?: string;
      activeStreams?: number;
      at?: string;
    };
    if (!heartbeat.at || Number.isNaN(new Date(heartbeat.at).getTime())) return null;
    return { ...heartbeat, at: heartbeat.at };
  } catch {
    return null;
  }
}
