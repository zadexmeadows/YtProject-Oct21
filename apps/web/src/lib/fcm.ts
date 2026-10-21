'use client';

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

export interface FirebasePushConfig extends FirebaseOptions {
  vapidKey: string;
}

export async function enableFcmPush(config: FirebasePushConfig) {
  if (!window.isSecureContext) throw new Error('Push notifications require HTTPS');
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('This browser does not support push notifications');
  }
  if (!(await isSupported())) throw new Error('Firebase notifications are not supported in this browser');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const registration = await navigator.serviceWorker.register(serviceWorkerUrl(config));
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const token = await getToken(getMessaging(app), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error('Firebase did not return a device token');

  return { token, name: deviceName(), userAgent: navigator.userAgent };
}

export async function listenForForegroundMessages(config: FirebasePushConfig) {
  if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted' || !(await isSupported())) {
    return () => {};
  }
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  return onMessage(getMessaging(app), (payload) => {
    const notification = new Notification(
      payload.notification?.title ?? payload.data?.title ?? 'YouTube Chat Alert',
      {
        body: payload.notification?.body ?? payload.data?.message ?? 'New tracked message',
        ...(payload.data?.chatMessageId ? { tag: payload.data.chatMessageId } : {})
      },
    );
    notification.onclick = () => {
      window.focus();
      window.location.assign(payload.data?.url ?? '/notifications');
    };
  });
}

function serviceWorkerUrl(config: FirebasePushConfig) {
  const params = new URLSearchParams();
  for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const) {
    const value = config[key];
    if (value) params.set(key, String(value));
  }
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

function deviceName() {
  const platform = navigator.platform || 'Device';
  const browser = navigator.userAgent.includes('Edg/')
    ? 'Edge'
    : navigator.userAgent.includes('Firefox/')
      ? 'Firefox'
      : navigator.userAgent.includes('Chrome/')
        ? 'Chrome'
        : navigator.userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  return `${platform} · ${browser}`;
}
