import { Worker as QueueWorker } from 'bullmq';
import { prisma } from '@ytbot/db';
import {
  CAPTURE_QUEUE_NAME,
  EXPORT_QUEUE_NAME,
  type CaptureControlJob,
  type ExportQueueJob
} from '@ytbot/shared';
import { PublicYouTubeLiveChatAdapter } from './capture/PublicYouTubeLiveChatAdapter';
import { CaptureManager } from './capture/CaptureManager';
import { processExportJob } from './export/exportProcessor';
import { env } from './lib/env';
import { logger } from './lib/logger';
import { redis } from './lib/redis';

const captureManager = new CaptureManager(new PublicYouTubeLiveChatAdapter(), env.WORKER_ID);
const bullConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null
};

const captureWorker = new QueueWorker<CaptureControlJob>(
  CAPTURE_QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, data: job.data }, 'Processing capture control job');
    await captureManager.handleControl(job.data);
  },
  {
    connection: bullConnection,
    concurrency: 10
  },
);

const exportWorker = new QueueWorker<ExportQueueJob>(
  EXPORT_QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, exportJobId: job.data.exportJobId }, 'Processing export job');
    await processExportJob(job.data.exportJobId);
  },
  {
    connection: bullConnection,
    concurrency: 2
  },
);

captureWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Capture control job failed');
});

exportWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Export job failed');
});

const heartbeat = setInterval(() => {
  void captureManager.heartbeat().catch((error) => {
    logger.warn({ err: error }, 'Worker heartbeat failed');
  });
}, 10_000);

const recoveryScheduler = setInterval(() => {
  void captureManager.processScheduledRecoveries().catch((error) => {
    logger.warn({ err: error }, 'Stream recovery scheduler failed');
  });
}, 5_000);

const cleanup = setInterval(() => {
  void cleanupRetention().catch((error) => {
    logger.warn({ err: error }, 'Retention cleanup failed');
  });
}, 60 * 60_000);

async function cleanupRetention() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'retentionDays' } });
  const retentionDays = Number(setting?.value ?? 365);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
  const result = await prisma.chatMessage.deleteMany({
    where: { capturedAt: { lt: cutoff } }
  });
  if (result.count > 0) {
    logger.info({ deletedMessages: result.count, cutoff }, 'Retention cleanup deleted old messages');
  }
}

async function start() {
  logger.info({ workerId: env.WORKER_ID }, 'Worker starting');
  await captureManager.resumeRestartSafeStreams();
  await captureManager.heartbeat();
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Worker shutting down');
  clearInterval(heartbeat);
  clearInterval(recoveryScheduler);
  clearInterval(cleanup);
  await captureManager.shutdown();
  await Promise.allSettled([captureWorker.close(), exportWorker.close(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start().catch((error) => {
  logger.fatal({ err: error }, 'Worker startup failed');
  process.exit(1);
});
