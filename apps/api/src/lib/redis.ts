import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export function createRedisConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null
  });
}
