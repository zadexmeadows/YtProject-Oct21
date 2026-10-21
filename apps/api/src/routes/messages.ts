import { Router } from 'express';
import { countMessages, findMessages, prisma, type MessageQueryFilters } from '@ytbot/db';
import { messageFilterSchema } from '@ytbot/shared';
import { z } from 'zod';
import { asyncHandler, validateQuery } from '../lib/http';

export const messagesRouter = Router();

const messageHistoryQuerySchema = z
  .object({
    streamId: z.string().uuid().optional(),
    from: z.string().datetime(),
    to: z.string().datetime(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(200)
  })
  .refine((value) => new Date(value.from).getTime() <= new Date(value.to).getTime(), {
    message: 'Start time must be before end time',
    path: ['from']
  });

messagesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = validateQuery(messageFilterSchema, req.query);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    const messageFilters: MessageQueryFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      if (key !== 'page' && key !== 'pageSize' && value !== undefined) {
        (messageFilters as any)[key] = value;
      }
    }
    const [messages, total] = await Promise.all([
      findMessages(prisma, messageFilters, { page, pageSize }),
      countMessages(prisma, messageFilters)
    ]);

    res.json({
      messages,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize)
      }
    });
  }),
);

messagesRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const filters = validateQuery(messageHistoryQuerySchema, req.query);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 200;
    const messageFilters: MessageQueryFilters = {
      from: filters.from,
      to: filters.to
    };
    if (filters.streamId) messageFilters.streamId = filters.streamId;

    const [messages, total] = await Promise.all([
      findMessages(prisma, messageFilters, { page, pageSize, order: 'asc' }),
      countMessages(prisma, messageFilters)
    ]);

    res.json({
      messages,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize)
      }
    });
  }),
);

messagesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const message = await prisma.chatMessage.findUnique({
      where: { id: String(req.params.id) },
      include: { stream: true, author: true }
    });

    if (!message) {
      res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
      return;
    }

    res.json({ message });
  }),
);
