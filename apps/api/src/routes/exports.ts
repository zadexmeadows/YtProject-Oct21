import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { exportCreateSchema, exportDeleteSchema } from '@ytbot/shared';
import { Prisma, prisma } from '@ytbot/db';
import { auditLog } from '../lib/audit';
import { env } from '../lib/env';
import { asyncHandler, validateBody } from '../lib/http';
import { exportQueue } from '../lib/queues';
import { requireRole } from '../middleware/auth';

export const exportsRouter = Router();

exportsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const jobs = await prisma.exportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { createdBy: { select: { id: true, name: true, email: true } } }
    });
    res.json({ jobs });
  }),
);

exportsRouter.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = validateBody(exportCreateSchema, req.body);
    const data: Prisma.ExportJobUncheckedCreateInput = {
      createdById: req.session.user?.id ?? null,
      format: input.format,
      type: input.type,
      filters: input.filters as any
    };
    const job = await prisma.exportJob.create({
      data
    });

    await exportQueue.add(
      `export:${job.id}`,
      { exportJobId: job.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000
      },
    );

    await auditLog(req, 'export.requested', {
      entityType: 'export_job',
      entityId: job.id,
      metadata: { format: input.format, type: input.type, filters: input.filters }
    });

    res.status(201).json({ job });
  }),
);

exportsRouter.delete(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = validateBody(exportDeleteSchema, req.body);
    const jobs = await prisma.exportJob.findMany({
      where: { id: { in: input.ids } }
    });
    const activeJobs = jobs.filter((job) => job.status === 'PENDING' || job.status === 'PROCESSING');

    if (activeJobs.length > 0) {
      res.status(409).json({
        error: 'Wait for active exports to finish before deleting them',
        code: 'EXPORTS_ACTIVE',
        activeIds: activeJobs.map((job) => job.id)
      });
      return;
    }

    for (const job of jobs) {
      await exportQueue.remove(`export:${job.id}`).catch(() => undefined);
      if (!job.filePath) continue;

      const absolutePath = path.resolve(job.filePath);
      if (!isInsideExportRoot(absolutePath)) continue;
      await fs.rm(absolutePath, { force: true });
    }

    const deleted = await prisma.exportJob.deleteMany({
      where: { id: { in: jobs.map((job) => job.id) } }
    });

    await auditLog(req, 'export.deleted', {
      entityType: 'export_job',
      metadata: {
        requestedIds: input.ids,
        deletedIds: jobs.map((job) => job.id),
        deletedCount: deleted.count
      }
    });

    res.json({ deletedCount: deleted.count });
  }),
);

exportsRouter.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const readyExport = await getReadyExport(String(req.params.id));
    if (!readyExport) {
      res.status(404).json({ error: 'Export is not ready', code: 'NOT_FOUND' });
      return;
    }

    if (!isInsideExportRoot(readyExport.absolutePath)) {
      res.status(403).json({ error: 'Invalid export path', code: 'FORBIDDEN' });
      return;
    }

    res.download(readyExport.absolutePath, readyExport.fileName);
  }),
);

exportsRouter.get(
  '/:id/content',
  asyncHandler(async (req, res) => {
    const readyExport = await getReadyExport(String(req.params.id));
    if (!readyExport) {
      res.status(404).json({ error: 'Export is not ready', code: 'NOT_FOUND' });
      return;
    }

    if (!isInsideExportRoot(readyExport.absolutePath)) {
      res.status(403).json({ error: 'Invalid export path', code: 'FORBIDDEN' });
      return;
    }

    const file = await fs.readFile(readyExport.absolutePath);
    res.json({
      fileName: readyExport.fileName,
      mimeType: mimeTypeForFile(readyExport.fileName),
      base64: file.toString('base64')
    });
  }),
);

async function getReadyExport(id: string) {
  const job = await prisma.exportJob.findUnique({
    where: { id }
  });

  if (!job || job.status !== 'COMPLETED' || !job.filePath || !job.fileName) {
    return null;
  }

  return {
    absolutePath: path.resolve(job.filePath),
    fileName: job.fileName
  };
}

function isInsideExportRoot(absolutePath: string) {
  const exportRoot = path.resolve(env.EXPORT_DIR);
  const relative = path.relative(exportRoot, absolutePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mimeTypeForFile(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.csv':
      return 'text/csv;charset=utf-8';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}
