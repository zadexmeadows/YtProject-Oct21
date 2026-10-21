import { Router } from 'express';
import { prisma } from '@ytbot/db';
import { asyncHandler } from '../lib/http';
import { requireRole } from '../middleware/auth';

export const auditRouter = Router();

auditRouter.get(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: { user: { select: { id: true, email: true, name: true } } }
      }),
      prisma.auditLog.count()
    ]);

    res.json({
      logs,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize)
      }
    });
  }),
);
