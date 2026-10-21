import { Router } from 'express';
import { REALTIME_CHANNEL, type RealtimeEvent } from '@ytbot/shared';
import { createRedisConnection } from '../lib/redis';

export const realtimeRouter = Router();

realtimeRouter.get('/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('\n');

  const subscriber = createRedisConnection();
  await subscriber.subscribe(REALTIME_CHANNEL);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  }, 15_000);

  subscriber.on('message', (_channel, message) => {
    const event = JSON.parse(message) as RealtimeEvent;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', async () => {
    clearInterval(keepAlive);
    await subscriber.unsubscribe(REALTIME_CHANNEL);
    subscriber.disconnect();
  });
});
