'use client';

import { useEffect } from 'react';
import { API_URL } from '@/lib/api';

export function useRealtime(onEvent: (event: MessageEvent) => void) {
  useEffect(() => {
    const source = new EventSource(`${API_URL}/realtime/events`, {
      withCredentials: true
    });
    const eventNames = ['chat.message', 'stream.status', 'worker.heartbeat', 'export.status', 'capture.log'];
    eventNames.forEach((eventName) => source.addEventListener(eventName, onEvent));
    return () => {
      eventNames.forEach((eventName) => source.removeEventListener(eventName, onEvent));
      source.close();
    };
  }, [onEvent]);
}
