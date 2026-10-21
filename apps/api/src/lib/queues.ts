import { Queue } from 'bullmq';
import {
  CAPTURE_QUEUE_NAME,
  CaptureControlJob,
  EXPORT_QUEUE_NAME,
  ExportQueueJob
} from '@ytbot/shared';
import { env } from './env';

const connection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null
};

export const captureQueue = new Queue<CaptureControlJob>(CAPTURE_QUEUE_NAME, {
  connection
});

export const exportQueue = new Queue<ExportQueueJob>(EXPORT_QUEUE_NAME, {
  connection
});
