import { prisma } from '@ytbot/db';
import { createApp } from './app';
import { env } from './lib/env';
import { logger } from './lib/logger';
import { redis } from './lib/redis';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API server');
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
