import type { MessageType } from '@ytbot/shared';

export interface CapturedChatMessage {
  messageId: string;
  videoId: string;
  authorChannelId?: string | null;
  authorName: string;
  authorAvatarUrl?: string | null;
  messageText: string;
  messageType: MessageType;
  badges: Array<Record<string, unknown>>;
  amount?: number | null;
  currency?: string | null;
  originalTimestamp?: Date | null;
  rawPayload: Record<string, unknown>;
}

export interface CaptureMetadata {
  title?: string | null;
  channelId?: string | null;
  liveChatUrl?: string | null;
}

export interface CaptureContext {
  streamId: string;
  videoId: string;
  captureSpeedMs: number;
  signal: AbortSignal;
}

export interface CaptureHandlers {
  onMetadata(metadata: CaptureMetadata): Promise<void>;
  onMessage(message: CapturedChatMessage): Promise<void>;
  onLog(level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, unknown>): Promise<void>;
  onEnded(reason: string): Promise<void>;
}

export interface ChatCaptureAdapter {
  name: string;
  fetchMetadata(videoId: string): Promise<CaptureMetadata>;
  findReplacementVideoId?(channelId: string, currentVideoId: string): Promise<string | null>;
  capture(context: CaptureContext, handlers: CaptureHandlers): Promise<void>;
}
