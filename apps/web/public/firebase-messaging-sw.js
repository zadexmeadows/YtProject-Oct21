/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId')
};

if (config.apiKey && config.projectId && config.messagingSenderId && config.appId) {
  firebase.initializeApp(config);
  firebase.messaging();
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.FCM_MSG?.data?.url || '/notifications';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => 'focus' in client);
      return existing ? existing.focus().then(() => existing.navigate(target)) : clients.openWindow(target);
    }),
  );
});
