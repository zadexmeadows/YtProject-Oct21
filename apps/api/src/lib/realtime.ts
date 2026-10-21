import { REALTIME_CHANNEL, type RealtimeEvent } from '@ytbot/shared';
import { redis } from './redis';

export async function publishRealtime(event: RealtimeEvent) {
  await redis.publish(REALTIME_CHANNEL, JSON.stringify(event));
}

export function nowEventTime() {
  return new Date().toISOString();
}
