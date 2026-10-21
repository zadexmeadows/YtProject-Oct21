import { Router } from 'express';
import { prisma } from '@ytbot/db';
import { notificationEventCreateSchema, notificationEventUpdateSchema, pushDeviceCreateSchema } from '@ytbot/shared';
import { auditLog } from '../lib/audit';
import { env } from '../lib/env';
import { ApiError, asyncHandler, validateBody } from '../lib/http';
import { requireRole } from '../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const config = firebaseWebConfig();
    const devices = await prisma.pushDevice.findMany({
      where: { userId: req.session.user!.id },
      orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        userAgent: true,
        isEnabled: true,
        lastSeenAt: true,
        createdAt: true
      }
    });
    res.json({ configured: Boolean(config), config, devices });
  }),
);

notificationsRouter.post(
  '/devices',
  asyncHandler(async (req, res) => {
    const input = validateBody(pushDeviceCreateSchema, req.body);
    const device = await prisma.pushDevice.upsert({
      where: { token: input.token },
      update: {
        userId: req.session.user!.id,
        name: input.name,
        userAgent: input.userAgent ?? null,
        isEnabled: true,
        lastSeenAt: new Date()
      },
      create: {
        userId: req.session.user!.id,
        token: input.token,
        name: input.name,
        userAgent: input.userAgent ?? null
      },
      select: { id: true, name: true, isEnabled: true, lastSeenAt: true, createdAt: true }
    });
    await auditLog(req, 'push_device.registered', {
      entityType: 'push_device',
      entityId: device.id,
      metadata: { name: device.name }
    });
    res.status(201).json({ device });
  }),
);

notificationsRouter.delete(
  '/devices/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const result = await prisma.pushDevice.deleteMany({
      where: { id, userId: req.session.user!.id }
    });
    if (result.count === 0) throw new ApiError(404, 'Push device not found', 'NOT_FOUND');
    await auditLog(req, 'push_device.removed', { entityType: 'push_device', entityId: id });
    res.status(204).send();
  }),
);

notificationsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const events = await prisma.notificationEvent.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          include: { author: true },
          orderBy: { createdAt: 'asc' }
        },
        _count: {
          select: { deliveries: true }
        }
      }
    });

    res.json({ events });
  }),
);

notificationsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = validateBody(notificationEventCreateSchema, req.body);
    const authorIds = uniqueAuthorIds(input.authorIds);
    await ensureAuthorsExist(authorIds);

    const event = await prisma.notificationEvent.create({
      data: {
        name: input.name,
        isEnabled: input.isEnabled ?? true,
        createdById: req.session.user?.id ?? null,
        users: {
          create: authorIds.map((authorId) => ({ authorId }))
        }
      },
      include: {
        users: { include: { author: true } },
        _count: { select: { deliveries: true } }
      }
    });

    await auditLog(req, 'notification_event.created', {
      entityType: 'notification_event',
      entityId: event.id,
      metadata: {
        name: event.name,
        authorIds
      }
    });

    res.status(201).json({ event });
  }),
);

notificationsRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const input = validateBody(notificationEventUpdateSchema, req.body);
    const existing = await prisma.notificationEvent.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, 'Notification event not found', 'NOT_FOUND');
    }

    const authorIds = input.authorIds ? uniqueAuthorIds(input.authorIds) : null;
    if (authorIds) await ensureAuthorsExist(authorIds);

    const event = await prisma.$transaction(async (tx) => {
      if (authorIds) {
        await tx.notificationEventUser.deleteMany({ where: { eventId: id } });
        await tx.notificationEventUser.createMany({
          data: authorIds.map((authorId) => ({ eventId: id, authorId })),
          skipDuplicates: true
        });
      }

      return tx.notificationEvent.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {})
        },
        include: {
          users: {
            include: { author: true },
            orderBy: { createdAt: 'asc' }
          },
          _count: { select: { deliveries: true } }
        }
      });
    });

    await auditLog(req, 'notification_event.updated', {
      entityType: 'notification_event',
      entityId: event.id,
      metadata: {
        name: event.name,
        isEnabled: event.isEnabled,
        ...(authorIds ? { authorIds } : {})
      }
    });

    res.json({ event });
  }),
);

notificationsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.notificationEvent.findUnique({
      where: { id },
      select: { id: true, name: true }
    });
    if (!existing) {
      throw new ApiError(404, 'Notification event not found', 'NOT_FOUND');
    }

    await prisma.notificationEvent.delete({ where: { id } });
    await auditLog(req, 'notification_event.deleted', {
      entityType: 'notification_event',
      entityId: id,
      metadata: existing
    });

    res.status(204).send();
  }),
);

function uniqueAuthorIds(authorIds: string[]) {
  return Array.from(new Set(authorIds));
}

function firebaseWebConfig() {
  const values = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
    vapidKey: env.FIREBASE_VAPID_KEY
  };
  const required = [values.apiKey, values.projectId, values.messagingSenderId, values.appId, values.vapidKey];
  return required.every(Boolean) ? values as Record<keyof typeof values, string> : null;
}

async function ensureAuthorsExist(authorIds: string[]) {
  const count = await prisma.chatAuthor.count({
    where: { id: { in: authorIds } }
  });
  if (count !== authorIds.length) {
    throw new ApiError(400, 'One or more tracked users were not found', 'VALIDATION_ERROR');
  }
}
