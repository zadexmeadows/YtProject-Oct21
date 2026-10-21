import { Router } from 'express';
import { prisma } from '@ytbot/db';
import { redis } from '../lib/redis';
import { asyncHandler } from '../lib/http';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [db, redisPong] = await Promise.all([
      prisma.$queryRaw`SELECT 1 AS ok`,
      redis.ping()
    ]);
    const heartbeatRaw = await redis.get('ytbot:worker:last-heartbeat');
    const heartbeat = parseWorkerHeartbeat(heartbeatRaw);

    res.json({
      ok: true,
      service: 'api',
      uptime: process.uptime(),
      database: Array.isArray(db) ? 'ok' : 'unknown',
      redis: redisPong === 'PONG' ? 'ok' : 'unknown',
      worker: heartbeat
    });
  }),
);

function parseWorkerHeartbeat(value: string | null) {
  if (!value) {
    return {
      online: false,
      activeStreams: 0,
      workerId: null,
      lastHeartbeatAt: null
    };
  }

  try {
    const parsed = JSON.parse(value) as {
      workerId?: string;
      activeStreams?: number;
      at?: string;
    };
    return {
      online: true,
      activeStreams: parsed.activeStreams ?? 0,
      workerId: parsed.workerId ?? null,
      lastHeartbeatAt: parsed.at ?? null
    };
  } catch {
    return {
      online: false,
      activeStreams: 0,
      workerId: null,
      lastHeartbeatAt: null
    };
  }
}
