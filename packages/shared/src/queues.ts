export const CAPTURE_QUEUE_NAME = 'ytbot-capture-control';
export const EXPORT_QUEUE_NAME = 'ytbot-exports';
export const REALTIME_CHANNEL = 'ytbot:realtime-events';

export type CaptureAction = 'start' | 'pause' | 'resume' | 'stop' | 'delete';

export interface CaptureControlJob {
  action: CaptureAction;
  streamId: string;
  requestedByUserId?: string;
}

export interface ExportQueueJob {
  exportJobId: string;
}
