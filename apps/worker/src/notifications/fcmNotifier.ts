import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { Prisma, prisma } from '@ytbot/db';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

interface FcmMessageNotification {
  chatMessageId: string;
  authorId: string | null;
  authorName: string;
  streamName: string;
  messageText: string;
}

let messaging: Messaging | null | undefined;
let warnedNotConfigured = false;

export async function deliverFcmStreamRecoveryAlert(stream: {
  streamId: string;
  videoId: string;
  streamName: string;
}) {
  const fcm = getFcmMessaging();
  if (!fcm) return;

  const devices = await prisma.pushDevice.findMany({
    where: { isEnabled: true },
    select: { id: true, token: true }
  });
  if (devices.length === 0) return;

  for (let offset = 0; offset < devices.length; offset += 500) {
    const batch = devices.slice(offset, offset + 500);
    try {
      const response = await fcm.sendEachForMulticast({
        tokens: batch.map((device) => device.token),
        notification: {
          title: 'YouTube stream needs attention',
          body: `${stream.streamName} stopped unexpectedly. Automatic recovery will start in 30 seconds.`
        },
        data: {
          type: 'stream_recovery',
          streamId: stream.streamId,
          videoId: stream.videoId,
          url: '/streams'
        },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            tag: `ytbot-stream-recovery-${stream.videoId}`,
            renotify: true
          },
          fcmOptions: { link: '/streams' }
        }
      });
      const invalidDeviceIds = response.responses.flatMap((result, index) =>
        !result.success && isInvalidTokenError(result.error?.code) && batch[index]
          ? [batch[index]!.id]
          : [],
      );
      if (invalidDeviceIds.length > 0) {
        await prisma.pushDevice.deleteMany({ where: { id: { in: invalidDeviceIds } } });
      }
      logger.info({
        streamId: stream.streamId,
        successCount: response.successCount,
        failureCount: response.failureCount
      }, 'Stream recovery alert notification dispatched');
    } catch (error) {
      logger.warn({ err: error, streamId: stream.streamId }, 'Stream recovery notification failed');
    }
  }
}

export async function deliverFcmNotificationsForMessage(message: FcmMessageNotification) {
  if (!message.authorId) return;

  const fcm = getFcmMessaging();
  if (!fcm) return;

  const events = await prisma.notificationEvent.findMany({
    where: {
      isEnabled: true,
      users: { some: { authorId: message.authorId } }
    },
    select: { id: true, name: true }
  });
  if (events.length === 0) return;

  const devices = await prisma.pushDevice.findMany({
    where: { isEnabled: true },
    select: { id: true, token: true }
  });
  if (devices.length === 0) return;

  await Promise.allSettled(events.map((event) => deliverEvent(fcm, event, devices, message)));
}

async function deliverEvent(
  fcm: Messaging,
  event: { id: string; name: string },
  devices: Array<{ id: string; token: string }>,
  message: FcmMessageNotification,
) {
  const delivery = await createDelivery(event.id, message.chatMessageId);
  if (!delivery) return;

  const attemptedAt = new Date();
  try {
    const title = `${formatNotificationUsername(message.authorName)} in ${message.streamName}`;
    const response = await fcm.sendEachForMulticast({
      tokens: devices.map((device) => device.token),
      notification: {
        title,
        body: message.messageText || 'New tracked message'
      },
      data: {
        eventId: event.id,
        eventName: event.name,
        chatMessageId: message.chatMessageId,
        username: message.authorName,
        streamName: message.streamName,
        message: message.messageText,
        url: '/notifications'
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          tag: `ytbot-${event.id}-${message.chatMessageId}`,
          renotify: true
        },
        fcmOptions: { link: '/notifications' }
      }
    });

    const invalidDeviceIds = response.responses.flatMap((result, index) =>
      !result.success && isInvalidTokenError(result.error?.code) && devices[index]
        ? [devices[index]!.id]
        : [],
    );
    if (invalidDeviceIds.length > 0) {
      await prisma.pushDevice.deleteMany({ where: { id: { in: invalidDeviceIds } } });
    }

    const failureMessages = response.responses
      .filter((result) => !result.success)
      .map((result) => result.error?.message ?? 'FCM delivery failed');
    const status = response.successCount > 0 ? 'SENT' : 'FAILED';
    await prisma.$transaction([
      prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          attemptedAt,
          sentAt: response.successCount > 0 ? new Date() : null,
          errorMessage: failureMessages.length > 0
            ? `${response.failureCount} of ${devices.length} failed: ${failureMessages[0]}`.slice(0, 1000)
            : null
        }
      }),
      ...(response.successCount > 0
        ? [prisma.notificationEvent.update({
            where: { id: event.id },
            data: { lastTriggeredAt: new Date() }
          })]
        : [])
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'FCM notification failed';
    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', attemptedAt, errorMessage: errorMessage.slice(0, 1000) }
    });
    logger.warn({ err: error, notificationEventId: event.id }, 'FCM notification delivery failed');
  }
}

async function createDelivery(eventId: string, chatMessageId: string) {
  try {
    return await prisma.notificationDelivery.create({
      data: { eventId, chatMessageId, status: 'PENDING' },
      select: { id: true }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

function getFcmMessaging() {
  if (messaging !== undefined) return messaging;
  if (!env.FIREBASE_PROJECT_ID || !env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      logger.warn('FCM is not configured; push delivery is disabled');
    }
    messaging = null;
    return messaging;
  }

  const app = getApps()[0] ?? initializeApp({
    credential: applicationDefault(),
    projectId: env.FIREBASE_PROJECT_ID
  });
  messaging = getMessaging(app);
  return messaging;
}

function isInvalidTokenError(code?: string) {
  return code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token';
}

function formatNotificationUsername(username: string) {
  const trimmed = username.trim();
  if (!trimmed) return '@Unknown';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}
