'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

interface ToastMessage {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

const ToastContext = createContext<{
  pushToast: (message: string, tone?: ToastMessage['tone']) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((message: string, tone: ToastMessage['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-panel dark:border-slate-800 dark:bg-slate-900"
          >
            <span
              className={
                toast.tone === 'error'
                  ? 'text-red-700 dark:text-red-300'
                  : toast.tone === 'success'
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-slate-700 dark:text-slate-200'
              }
            >
              {toast.message}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="h-6 w-6 p-0"
              aria-label="Dismiss"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            >
              <X size={14} />
            </Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
