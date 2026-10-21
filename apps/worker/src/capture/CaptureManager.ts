import { Prisma, prisma } from '@ytbot/db';
import type { CaptureControlJob } from '@ytbot/shared';
import { nowEventTime, publishRealtime } from '../lib/realtime';
import { redis } from '../lib/redis';
import { getExcludedChatUsers, getWorkerSettings } from '../lib/settings';
import { logger } from '../lib/logger';
import { deliverFcmNotificationsForMessage, deliverFcmStreamRecoveryAlert } from '../notifications/fcmNotifier';
import type { CapturedChatMessage, ChatCaptureAdapter } from './types';
import { isExcludedAuthor } from './messageUtils';

interface ActiveCapture {
  streamId: string;
  videoId: string;
  controller: AbortController;
  sessionId?: string;
}

export class CaptureManager {
  private readonly active = new Map<string, ActiveCapture>();
  private shuttingDown = false;

  constructor(
    private readonly adapter: ChatCaptureAdapter,
    private readonly workerId: string,
  ) {}

  activeCount() {
    return this.active.size;
  }

  async handleControl(job: CaptureControlJob) {
    switch (job.action) {
      case 'start':
      case 'resume':
        await this.start(job.streamId);
        break;
      case 'pause':
        await this.pause(job.streamId);
        break;
      case 'stop':
      case 'delete':
        await this.stop(job.streamId);
        break;
    }
  }

  async resumeRestartSafeStreams() {
    await prisma.stream.updateMany({
      where: { deletedAt: null, recoveryStatus: 'RUNNING' },
      data: {
        recoveryStatus: 'WAITING',
        recoveryNextAttemptAt: new Date(Date.now() + 30_000)
      }
    });
    const streams = await prisma.stream.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDING', 'CAPTURING', 'RETRYING'] }
      },
      orderBy: { updatedAt: 'asc' }
    });

    for (const stream of streams) {
      await this.start(stream.id);
    }
  }

  async start(streamId: string) {
    if (this.shuttingDown || this.active.has(streamId)) {
      return;
    }

    const settings = await getWorkerSettings();
    if (this.active.size >= settings.maxConcurrentStreams) {
      await prisma.stream.update({
        where: { id: streamId },
        data: {
          status: 'RETRYING',
          errorMessage: `Worker concurrency limit reached (${settings.maxConcurrentStreams}).`
        }
      });
      await this.emitStreamStatus(streamId);
      return;
    }

    const stream = await prisma.stream.findFirst({
      where: { id: streamId, deletedAt: null }
    });
    if (!stream || ['PAUSED', 'STOPPED', 'ENDED'].includes(stream.status)) {
      return;
    }

    const controller = new AbortController();
    const active: ActiveCapture = {
      streamId,
      videoId: stream.videoId,
      controller
    };
    this.active.set(streamId, active);

    void this.runCapture(active, settings.captureSpeedMs);
  }

  async pause(streamId: string) {
    this.active.get(streamId)?.controller.abort();
    await prisma.stream.update({
      where: { id: streamId },
      data: { status: 'PAUSED' }
    });
    await this.emitStreamStatus(streamId);
  }

  async stop(streamId: string) {
    this.active.get(streamId)?.controller.abort();
    await prisma.stream.update({
      where: { id: streamId },
      data: { status: 'STOPPED', endedAt: new Date() }
    });
    await this.emitStreamStatus(streamId);
  }

  async shutdown() {
    this.shuttingDown = true;
    for (const capture of this.active.values()) {
      capture.controller.abort();
    }
  }

  private async runCapture(active: ActiveCapture, captureSpeedMs: number) {
    let sessionId: string | undefined;
    try {
      const session = await prisma.captureSession.create({
        data: {
          streamId: active.streamId,
          workerId: this.workerId,
          status: 'RUNNING'
        }
      });
      sessionId = session.id;
      active.sessionId = session.id;

      await prisma.stream.update({
        where: { id: active.streamId },
        data: {
          status: 'CAPTURING',
          errorMessage: null,
          startedAt: new Date()
        }
      });
      await this.emitStreamStatus(active.streamId);

      await this.adapter.capture(
        {
          streamId: active.streamId,
          videoId: active.videoId,
          captureSpeedMs,
          signal: active.controller.signal
        },
        {
          onMetadata: async (metadata) => {
            const data: Prisma.StreamUpdateInput = {};
            if (metadata.liveChatUrl !== undefined) data.liveChatUrl = metadata.liveChatUrl;
            if (metadata.channelId !== undefined) data.channelId = metadata.channelId;
            if (Object.keys(data).length > 0) {
              await prisma.stream.update({
                where: { id: active.streamId },
                data
              });
            }
            if (typeof metadata.title === 'string' && metadata.title.trim()) {
              await prisma.stream.updateMany({
                where: {
                  id: active.streamId,
                  OR: [{ title: null }, { title: '' }]
                },
                data: { title: metadata.title }
              });
            }
          },
          onMessage: async (message) => {
            await this.persistMessage(active.streamId, message);
          },
          onLog: async (level, message, metadata) => {
            logger[level]({ streamId: active.streamId, ...metadata }, message);
            await publishRealtime({
              type: 'capture.log',
              at: nowEventTime(),
              payload: {
                streamId: active.streamId,
                level,
                message
              }
            });
          },
          onEnded: async (reason) => {
            if (active.controller.signal.aborted || this.shuttingDown) return;
            await prisma.stream.update({
              where: { id: active.streamId },
              data: {
                status: 'ENDED',
                endedAt: new Date(),
                errorMessage: reason
              }
            });
            await this.emitStreamStatus(active.streamId);
            await this.beginRecovery(active.streamId, reason, 'ENDED');
          }
        },
      );

      await prisma.captureSession.update({
        where: { id: sessionId },
        data: {
          status: 'STOPPED',
          endedAt: new Date()
        }
      });
    } catch (error) {
      if (active.controller.signal.aborted || this.shuttingDown) {
        await this.closeSession(sessionId, 'STOPPED');
        return;
      }

      logger.error({ err: error, streamId: active.streamId }, 'Capture failed');
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown capture failure. Check worker logs.';

      await this.closeSession(sessionId, 'FAILED', errorMessage);
      await this.beginRecovery(active.streamId, errorMessage, 'FAILED');
    } finally {
      this.active.delete(active.streamId);
    }
  }

  private async closeSession(
    sessionId: string | undefined,
    status: 'STOPPED' | 'FAILED',
    errorMessage?: string,
  ) {
    if (!sessionId) return;
    const data: Prisma.CaptureSessionUpdateInput = {
      status,
      endedAt: new Date()
    };
    if (errorMessage !== undefined) data.errorMessage = errorMessage;
    await prisma.captureSession
      .update({
        where: { id: sessionId },
        data
      })
      .catch(() => undefined);
  }

  async beginRecovery(streamId: string, reason: string, status: 'ENDED' | 'FAILED' = 'FAILED') {
    const now = new Date();
    const started = await prisma.stream.updateMany({
      where: {
        id: streamId,
        deletedAt: null,
        OR: [{ recoveryStatus: null }, { recoveryStatus: 'RECOVERED' }]
      },
      data: {
        status,
        endedAt: now,
        errorMessage: reason,
        recoveryStatus: 'WAITING',
        recoveryAttempts: 0,
        recoveryStartedAt: now,
        recoveryNextAttemptAt: now,
        recoveryAcknowledgedAt: null,
        recoveryLastError: reason
      }
    });
    if (started.count === 0) return;

    const stream = await prisma.stream.findUnique({ where: { id: streamId } });
    if (!stream) return;
    await this.emitStreamStatus(streamId);
    void deliverFcmStreamRecoveryAlert({
      streamId,
      videoId: stream.videoId,
      streamName: stream.title ?? stream.videoId
    }).catch((error) => {
      logger.warn({ err: error, streamId }, 'Stream recovery notification dispatch failed');
    });
    logger.warn({ streamId, videoId: stream.videoId, reason }, 'Unexpected stream stop; recovery scheduled');
  }

  async processScheduledRecoveries() {
    if (this.shuttingDown) return;
    const now = new Date();
    const due = await prisma.stream.findMany({
      where: {
        deletedAt: null,
        recoveryStatus: 'WAITING',
        recoveryNextAttemptAt: { lte: now }
      },
      orderBy: { recoveryNextAttemptAt: 'asc' },
      take: 10
    });

    for (const stream of due) {
      if (this.shuttingDown) return;
      if (this.active.has(stream.id) && stream.status === 'CAPTURING') {
        await prisma.stream.updateMany({
          where: { id: stream.id, recoveryStatus: 'WAITING' },
          data: {
            recoveryStatus: 'RECOVERED',
            recoveryNextAttemptAt: null,
            recoveryLastError: null,
            errorMessage: null
          }
        });
        await this.emitStreamStatus(stream.id);
        continue;
      }

      if (stream.recoveryAttempts >= 5) {
        await prisma.stream.updateMany({
          where: { id: stream.id, recoveryStatus: 'WAITING', recoveryAttempts: { gte: 5 } },
          data: {
            recoveryStatus: 'FAILED',
            recoveryNextAttemptAt: null,
            recoveryLastError: stream.recoveryLastError ?? 'Capture did not resume after five recovery attempts.'
          }
        });
        await this.emitStreamStatus(stream.id);
        continue;
      }

      const claimed = await prisma.stream.updateMany({
        where: {
          id: stream.id,
          recoveryStatus: 'WAITING',
          recoveryAttempts: stream.recoveryAttempts,
          recoveryNextAttemptAt: { lte: now }
        },
        data: {
          recoveryStatus: 'RUNNING',
          recoveryAttempts: { increment: 1 }
        }
      });
      if (claimed.count === 0) continue;

      await this.runRecoveryAttempt(stream.id, stream.recoveryAttempts + 1);
    }
  }

  private async runRecoveryAttempt(streamId: string, attempt: number) {
    let currentId = streamId;
    let attemptError: string | null = null;
    try {
      const stream = await prisma.stream.findUnique({ where: { id: streamId } });
      if (!stream || stream.deletedAt || stream.recoveryStatus !== 'RUNNING') return;

      if (attempt <= 2) {
        await prisma.stream.update({
          where: { id: streamId },
          data: { status: 'PENDING', endedAt: null, errorMessage: null }
        });
        await this.start(streamId);
      } else if (attempt <= 4) {
        const recreated = await this.recreateStream(stream, stream.videoId, stream.title, stream.channelId, true);
        currentId = recreated.id;
        await this.moveSeenMessageSet(stream.id, recreated.id);
        await this.start(recreated.id);
      } else {
        if (!stream.channelId || !this.adapter.findReplacementVideoId) {
          throw new Error('Could not look up the channel for a replacement live stream.');
        }
        const replacementId = await this.adapter.findReplacementVideoId(stream.channelId, stream.videoId);
        if (!replacementId) {
          throw new Error('No new live stream was found on the channel during the final recovery attempt.');
        }
        const metadata = await this.adapter.fetchMetadata(replacementId);
        if (metadata.channelId !== stream.channelId) {
          throw new Error('The candidate replacement stream did not match the original channel.');
        }
        const recreated = await this.recreateStream(
          stream,
          replacementId,
          metadata.title ?? stream.title,
          metadata.channelId,
          false
        );
        currentId = recreated.id;
        await this.start(recreated.id);
      }

      await this.emitStreamStatus(currentId);
    } catch (error) {
      attemptError = error instanceof Error ? error.message : 'Automatic recovery attempt failed.';
      logger.warn({ err: error, streamId, attempt }, 'Stream recovery attempt failed');
    }

    const nextAt = new Date(Date.now() + 30_000);
    await prisma.stream.updateMany({
      where: { id: currentId, recoveryStatus: 'RUNNING' },
      data: {
        recoveryStatus: 'WAITING',
        recoveryNextAttemptAt: nextAt,
        recoveryLastError: attemptError,
        ...(attemptError !== null ? { errorMessage: attemptError } : {})
      }
    });
    await this.emitStreamStatus(currentId);
  }

  private async recreateStream(
    stream: NonNullable<Awaited<ReturnType<typeof prisma.stream.findUnique>>>,
    videoId: string,
    title: string | null,
    channelId: string | null,
    preserveHistory: boolean
  ) {
    const replacement = await prisma.$transaction(async (tx) => {
      const retired = await tx.stream.updateMany({
        where: { id: stream.id, deletedAt: null, recoveryStatus: 'RUNNING' },
        data: {
          deletedAt: new Date(),
          status: 'STOPPED',
          recoveryStatus: null,
          recoveryNextAttemptAt: null
        }
      });
      if (retired.count !== 1) {
        throw new Error('Recovery was acknowledged or changed before the stream could be recreated.');
      }
      const created = await tx.stream.create({
        data: {
          videoId,
          title,
          channelId,
          status: 'PENDING',
          createdByUserId: stream.createdByUserId,
          lastMessageAt: preserveHistory ? stream.lastMessageAt : null,
          recoveryStatus: 'RUNNING',
          recoveryAttempts: stream.recoveryAttempts,
          recoveryStartedAt: stream.recoveryStartedAt,
          recoveryNextAttemptAt: stream.recoveryNextAttemptAt,
          recoveryLastError: stream.recoveryLastError
        }
      });
      if (preserveHistory) {
        await tx.chatMessage.updateMany({ where: { streamId: stream.id }, data: { streamId: created.id } });
        await tx.captureSession.updateMany({ where: { streamId: stream.id }, data: { streamId: created.id } });
      }
      return created;
    });
    return replacement;
  }

  private async moveSeenMessageSet(previousStreamId: string, nextStreamId: string) {
    const previousKey = `ytbot:stream:${previousStreamId}:seen-message-ids`;
    const nextKey = `ytbot:stream:${nextStreamId}:seen-message-ids`;
    if (await redis.exists(previousKey)) {
      await redis.sunionstore(nextKey, previousKey, nextKey);
      await redis.expire(nextKey, 60 * 60 * 24 * 30);
      await redis.del(previousKey);
    }
  }

  private async persistMessage(streamId: string, message: CapturedChatMessage) {
    if (isExcludedAuthor(message.authorName, message.authorChannelId, await getExcludedChatUsers())) {
      return;
    }

    const seenKey = `ytbot:stream:${streamId}:seen-message-ids`;
    const firstSeen = await redis.sadd(seenKey, message.messageId);
    await redis.expire(seenKey, 60 * 60 * 24 * 30);
    if (firstSeen === 0) {
      return;
    }

    try {
      const authorId = await this.upsertAuthor(message);
      const created = await prisma.chatMessage.create({
        data: {
          messageId: message.messageId,
          streamId,
          videoId: message.videoId,
          authorId: authorId ?? null,
          authorChannelId: message.authorChannelId ?? null,
          authorName: message.authorName,
          authorAvatarUrl: message.authorAvatarUrl ?? null,
          messageText: message.messageText,
          messageType: message.messageType,
          badges: message.badges as Prisma.InputJsonValue,
          amount: message.amount ?? null,
          currency: message.currency ?? null,
          originalTimestamp: message.originalTimestamp ?? null,
          rawPayload: message.rawPayload as Prisma.InputJsonValue
        },
        include: {
          stream: {
            select: {
              title: true,
              videoId: true
            }
          }
        }
      });

      await prisma.stream.updateMany({
        where: {
          id: streamId,
          status: { in: ['PENDING', 'CAPTURING', 'RETRYING'] }
        },
        data: {
          status: 'CAPTURING',
          lastMessageAt: created.capturedAt,
          errorMessage: null,
          retryCount: 0
        }
      });
      await prisma.stream.updateMany({
        where: { id: streamId, recoveryStatus: { in: ['WAITING', 'RUNNING'] } },
        data: {
          recoveryStatus: 'RECOVERED',
          recoveryNextAttemptAt: null,
          recoveryLastError: null
        }
      });
      await this.emitStreamStatus(streamId);

      await publishRealtime({
        type: 'chat.message',
        at: nowEventTime(),
        payload: {
          id: created.id,
          streamId,
          videoId: created.videoId,
          streamTitle: created.stream.title,
          authorChannelId: created.authorChannelId,
          authorName: created.authorName,
          authorAvatarUrl: created.authorAvatarUrl,
          messageText: created.messageText,
          messageType: created.messageType,
          badges: created.badges,
          amount: created.amount?.toString() ?? null,
          currency: created.currency,
          capturedAt: created.capturedAt.toISOString(),
          rawPayload: created.rawPayload
        }
      });

      void deliverFcmNotificationsForMessage({
        chatMessageId: created.id,
        authorId: created.authorId,
        authorName: created.authorName,
        streamName: created.stream.title ?? created.stream.videoId,
        messageText: created.messageText
      }).catch((error) => {
        logger.warn({ err: error, chatMessageId: created.id }, 'Notification dispatch failed');
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  private async upsertAuthor(message: CapturedChatMessage): Promise<string | undefined> {
    if (message.authorChannelId) {
      const author = await prisma.chatAuthor.upsert({
        where: { authorChannelId: message.authorChannelId },
        update: {
          displayName: message.authorName,
          avatarUrl: message.authorAvatarUrl ?? null,
          lastSeenAt: new Date()
        },
        create: {
          authorChannelId: message.authorChannelId,
          displayName: message.authorName,
          avatarUrl: message.authorAvatarUrl ?? null
        }
      });
      return author.id;
    }

    const existing = await prisma.chatAuthor.findFirst({
      where: {
        authorChannelId: null,
        displayName: message.authorName
      },
      orderBy: { lastSeenAt: 'desc' }
    });

    if (existing) {
      const updated = await prisma.chatAuthor.update({
        where: { id: existing.id },
        data: {
          avatarUrl: message.authorAvatarUrl ?? null,
          lastSeenAt: new Date()
        }
      });
      return updated.id;
    }

    const author = await prisma.chatAuthor.create({
      data: {
        displayName: message.authorName,
        avatarUrl: message.authorAvatarUrl ?? null
      }
    });
    return author.id;
  }

  async heartbeat() {
    for (const capture of this.active.values()) {
      if (capture.sessionId) {
        await prisma.captureSession
          .update({
            where: { id: capture.sessionId },
            data: { heartbeatAt: new Date() }
          })
          .catch(() => undefined);
      }
    }

    const payload = {
      workerId: this.workerId,
      activeStreams: this.active.size,
      at: new Date().toISOString()
    };
    await redis.set('ytbot:worker:last-heartbeat', JSON.stringify(payload), 'EX', 45);
    await publishRealtime({
      type: 'worker.heartbeat',
      at: nowEventTime(),
      payload: {
        workerId: this.workerId,
        activeStreams: this.active.size
      }
    });
  }

  private async emitStreamStatus(streamId: string) {
    const stream = await prisma.stream.findUnique({
      where: { id: streamId }
    });
    if (!stream) return;
    await publishRealtime({
      type: 'stream.status',
      at: nowEventTime(),
      payload: {
        streamId: stream.id,
        videoId: stream.videoId,
        title: stream.title,
        status: stream.status,
        errorMessage: stream.errorMessage
      }
    });
  }
}
