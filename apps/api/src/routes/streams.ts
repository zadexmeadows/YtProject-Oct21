import { Router } from 'express';
import { Prisma, prisma } from '@ytbot/db';
import {
  createStreamsSchema,
  extractManyYouTubeVideoIds,
  streamIdParamSchema,
  updateStreamSchema
} from '@ytbot/shared';
import { auditLog } from '../lib/audit';
import { ApiError, asyncHandler, validateBody } from '../lib/http';
import { fetchPublicVideoTitle } from '../lib/publicMetadata';
import { captureQueue } from '../lib/queues';
import { nowEventTime, publishRealtime } from '../lib/realtime';
import { requireRole } from '../middleware/auth';

export const streamsRouter = Router();

streamsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const streams = await prisma.stream.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true }
        }
      }
    });
    res.json({ streams });
  }),
);

streamsRouter.get(
  '/recovery-alerts',
  asyncHandler(async (_req, res) => {
    const count = await prisma.stream.count({
      where: {
        deletedAt: null,
        recoveryStatus: { in: ['WAITING', 'RUNNING', 'FAILED'] }
      }
    });
    res.json({ count });
  }),
);

streamsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = validateBody(createStreamsSchema, req.body);
    const ids = extractManyYouTubeVideoIds(input.inputs.join('\n'));

    if (ids.length === 0) {
      res.status(400).json({ error: 'No valid YouTube video IDs found', code: 'INVALID_VIDEO_ID' });
      return;
    }

    const created = [];
    for (const videoId of ids) {
      const title = await fetchPublicVideoTitle(videoId);
      // Keep one active record per video, but allow a deleted stream to be
      // re-added as a new entity with a fresh id and empty capture history.
      const existing = await prisma.stream.findFirst({
        where: { videoId, deletedAt: null },
        orderBy: { createdAt: 'desc' }
      });
      const shouldResetCaptureState = existing?.status !== 'CAPTURING';
      const update: Prisma.StreamUncheckedUpdateInput = {
        deletedAt: null,
        errorMessage: null,
        recoveryStatus: null,
        recoveryAttempts: 0,
        recoveryStartedAt: null,
        recoveryNextAttemptAt: null,
        recoveryAcknowledgedAt: null,
        recoveryLastError: null
      };
      if (title !== null && !existing?.title) update.title = title;
      if (shouldResetCaptureState) {
        update.status = 'PENDING';
        update.endedAt = null;
      }
      const create: Prisma.StreamUncheckedCreateInput = {
        videoId,
        title,
        status: 'PENDING',
        createdByUserId: req.session.user?.id ?? null
      };
      const stream = existing
        ? await prisma.stream.update({ where: { id: existing.id }, data: update })
        : await prisma.stream.create({ data: create });
      const payload = {
        action: 'start' as const,
        streamId: stream.id,
        ...(req.session.user?.id ? { requestedByUserId: req.session.user.id } : {})
      };
      await captureQueue.add(
        `start:${stream.id}`,
        payload,
        {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 }
        },
      );
      await auditLog(req, 'stream.added', {
        entityType: 'stream',
        entityId: stream.id,
        metadata: { videoId, title, autoStartQueued: true }
      });
      created.push(stream);
    }

    res.status(201).json({ streams: created });
  }),
);

streamsRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = streamIdParamSchema.parse(req.params);
    const input = validateBody(updateStreamSchema, req.body);
    const previous = await prisma.stream.findUniqueOrThrow({
      where: { id },
      select: { videoId: true, title: true }
    });

    const stream = await prisma.stream.update({
      where: { id },
      data: { title: input.title }
    });

    await auditLog(req, 'stream.renamed', {
      entityType: 'stream',
      entityId: id,
      metadata: {
        videoId: stream.videoId,
        previousTitle: previous.title,
        title: stream.title
      }
    });

    await publishRealtime({
      type: 'stream.status',
      at: nowEventTime(),
      payload: {
        streamId: stream.id,
        videoId: stream.videoId,
        title: stream.title,
        status: stream.status,
        errorMessage: stream.errorMessage
      }
    });

    res.json({ stream });
  }),
);

async function controlStream(req: any, res: any, action: 'start' | 'pause' | 'resume' | 'stop') {
  const { id } = streamIdParamSchema.parse(req.params);
  const statusByAction = {
    start: 'PENDING',
    pause: 'PAUSED',
    resume: 'RETRYING',
    stop: 'STOPPED'
  } as const;

  const stream = await prisma.stream.update({
    where: { id },
    data: {
      status: statusByAction[action],
      errorMessage: null,
      recoveryStatus: action === 'start' || action === 'resume' ? null : 'ACKNOWLEDGED',
      recoveryNextAttemptAt: null,
      recoveryLastError: null,
      ...(action === 'start' || action === 'resume'
        ? { recoveryAttempts: 0, recoveryStartedAt: null, recoveryAcknowledgedAt: null }
        : { recoveryAcknowledgedAt: new Date() }),
      ...(action === 'start' ? { startedAt: new Date() } : {}),
      ...(action === 'stop' ? { endedAt: new Date() } : {})
    }
  });

  const payload = {
    action,
    streamId: id,
    ...(req.session.user?.id ? { requestedByUserId: req.session.user.id } : {})
  };
  await captureQueue.add(
    `${action}:${id}`,
    payload,
    {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 }
    },
  );

  await auditLog(req, `capture.${action}`, {
    entityType: 'stream',
    entityId: id,
    metadata: { videoId: stream.videoId }
  });

  res.json({ stream });
}

streamsRouter.post(
  '/:id/recovery/acknowledge',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = streamIdParamSchema.parse(req.params);
    const result = await prisma.stream.updateMany({
      where: {
        id,
        deletedAt: null,
        recoveryStatus: { in: ['WAITING', 'RUNNING', 'FAILED'] }
      },
      data: {
        recoveryStatus: 'ACKNOWLEDGED',
        recoveryAcknowledgedAt: new Date(),
        recoveryNextAttemptAt: null
      }
    });
    if (result.count === 0) throw new ApiError(404, 'This stream has no active recovery alert', 'NOT_FOUND');
    await auditLog(req, 'stream.recovery_acknowledged', { entityType: 'stream', entityId: id });
    res.json({ ok: true });
  }),
);

streamsRouter.post(
  '/:id/start',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => controlStream(req, res, 'start')),
);

streamsRouter.post(
  '/:id/pause',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => controlStream(req, res, 'pause')),
);

streamsRouter.post(
  '/:id/resume',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => controlStream(req, res, 'resume')),
);

streamsRouter.post(
  '/:id/stop',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => controlStream(req, res, 'stop')),
);

streamsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = streamIdParamSchema.parse(req.params);
    const stream = await prisma.stream.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'STOPPED',
        recoveryStatus: 'ACKNOWLEDGED',
        recoveryNextAttemptAt: null,
        recoveryAcknowledgedAt: new Date()
      }
    });

    const payload = {
      action: 'delete' as const,
      streamId: id,
      ...(req.session.user?.id ? { requestedByUserId: req.session.user.id } : {})
    };
    await captureQueue.add(
      `delete:${id}`,
      payload,
      { removeOnComplete: 1000, removeOnFail: 5000 },
    );

    await auditLog(req, 'stream.deleted', {
      entityType: 'stream',
      entityId: id,
      metadata: { videoId: stream.videoId }
    });

    res.json({ ok: true });
  }),
);
