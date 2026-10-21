export type StreamStatus =
  | 'PENDING'
  | 'CAPTURING'
  | 'PAUSED'
  | 'ENDED'
  | 'FAILED'
  | 'RETRYING'
  | 'STOPPED';

export type MessageType =
  | 'NORMAL'
  | 'SUPERCHAT'
  | 'MEMBERSHIP'
  | 'PINNED'
  | 'MODERATOR'
  | 'OWNER'
  | 'SYSTEM';

export type RealtimeEvent =
  | {
      type: 'chat.message';
      at: string;
      payload: {
        id: string;
        streamId: string;
        videoId: string;
        streamTitle?: string | null;
        authorChannelId?: string | null;
        authorName: string;
        authorAvatarUrl?: string | null;
        messageText: string;
        messageType: MessageType;
        badges?: unknown;
        amount?: string | number | null;
        currency?: string | null;
        capturedAt: string;
        rawPayload?: unknown;
      };
    }
  | {
      type: 'stream.status';
      at: string;
      payload: {
        streamId: string;
        videoId: string;
        title?: string | null;
        status: StreamStatus;
        errorMessage?: string | null;
      };
    }
  | {
      type: 'worker.heartbeat';
      at: string;
      payload: {
        workerId: string;
        activeStreams: number;
      };
    }
  | {
      type: 'export.status';
      at: string;
      payload: {
        exportJobId: string;
        status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
        fileName?: string | null;
        errorMessage?: string | null;
      };
    }
  | {
      type: 'capture.log';
      at: string;
      payload: {
        streamId?: string;
        level: 'info' | 'warn' | 'error';
        message: string;
      };
    };
