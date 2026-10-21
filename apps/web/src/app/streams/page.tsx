'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Check,
  CirclePause,
  CirclePlay,
  PenLine,
  Plus,
  RefreshCcw,
  RotateCw,
  ShieldX,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react';
import { clsx } from 'clsx';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { apiFetch } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useToast } from '@/components/Toast';

interface StreamRow {
  id: string;
  videoId: string;
  title: string | null;
  status: string;
  errorMessage: string | null;
  recoveryStatus: 'WAITING' | 'RUNNING' | 'FAILED' | 'ACKNOWLEDGED' | 'RECOVERED' | null;
  recoveryAttempts: number;
  lastMessageAt: string | null;
  createdAt: string;
  _count: { messages: number };
}

type CaptureAction = {
  action: 'start' | 'pause' | 'resume' | 'stop';
  label: string;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'info' | 'neutral';
};

export default function StreamsPage() {
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [inputs, setInputs] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<{ streams: StreamRow[] }>('/streams');
    setStreams(data.streams);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [load]);

  async function addStream(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    await apiFetch('/streams', {
      method: 'POST',
      body: JSON.stringify({ inputs: inputs.split('\n').filter(Boolean) })
    });
    setInputs('');
    setLoading(false);
    await load();
  }

  return (
    <DashboardShell>
      <PageHeader title="Streams" />
      <Panel className="mb-4">
        <PanelHeader title="Add Stream" />
        <form className="grid gap-3 p-4 md:grid-cols-[1fr_auto]" onSubmit={addStream}>
          <textarea
            value={inputs}
            onChange={(event) => setInputs(event.target.value)}
            rows={3}
            className="min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-950"
            placeholder="Video IDs or YouTube URLs"
            required
          />
          <Button type="submit" disabled={loading} className="self-end">
            <Plus size={16} />
            Add
          </Button>
        </form>
      </Panel>

      <Panel>
        <PanelHeader title="All Streams" action={<Button variant="secondary" onClick={load}><RotateCw size={15} />Refresh</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Stream</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Message</th>
                <th className="px-4 py-3 text-right">Messages</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((stream) => (
                <StreamTableRow key={stream.id} stream={stream} reload={load} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </DashboardShell>
  );
}

function StreamTableRow({ stream, reload }: { stream: StreamRow; reload: () => Promise<void> }) {
  const { pushToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(stream.title ?? stream.videoId);
  const [savingRename, setSavingRename] = useState(false);
  const [acknowledgingRecovery, setAcknowledgingRecovery] = useState(false);
  const captureActions = getCaptureActions(stream.status);

  const control = async (action: string) => {
    if (action === 'delete' && !window.confirm('Delete this stream?')) return;
    await apiFetch(`/streams/${stream.id}${action === 'delete' ? '' : `/${action}`}`, {
      method: action === 'delete' ? 'DELETE' : 'POST'
    });
    pushToast(`Stream ${action} queued`, 'success');
    await reload();
  };

  const startRename = () => {
    setTitle(stream.title ?? stream.videoId);
    setEditing(true);
  };

  const cancelRename = () => {
    setTitle(stream.title ?? stream.videoId);
    setEditing(false);
  };

  const saveRename = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      pushToast('Stream name is required', 'error');
      return;
    }

    setSavingRename(true);
    try {
      await apiFetch(`/streams/${stream.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: nextTitle })
      });
      pushToast('Stream renamed', 'success');
      setEditing(false);
      await reload();
    } finally {
      setSavingRename(false);
    }
  };

  const acknowledgeRecovery = async () => {
    setAcknowledgingRecovery(true);
    try {
      await apiFetch(`/streams/${stream.id}/recovery/acknowledge`, { method: 'POST' });
      pushToast('Alert acknowledged; automatic recovery stopped', 'success');
      await reload();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not acknowledge stream alert', 'error');
    } finally {
      setAcknowledgingRecovery(false);
    }
  };

  return (
    <tr className="border-b border-slate-100 align-top dark:border-slate-800">
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex max-w-lg items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveRename();
                }
                if (event.key === 'Escape') {
                  cancelRename();
                }
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-950"
              autoFocus
              maxLength={300}
            />
            <Button
              type="button"
              className="h-8 w-8 p-0"
              aria-label="Save stream name"
              disabled={savingRename}
              onClick={() => void saveRename()}
            >
              <Check size={14} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 w-8 p-0"
              aria-label="Cancel rename"
              disabled={savingRename}
              onClick={cancelRename}
            >
              <X size={14} />
            </Button>
          </div>
        ) : (
          <div className="flex max-w-lg items-start gap-2">
            <div className="min-w-0 font-medium">{stream.title ?? stream.videoId}</div>
            <button
              type="button"
              title="Rename stream"
              aria-label="Rename stream"
              onClick={startRename}
              className="group/rename inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-400/20 bg-blue-500/10 text-blue-300 shadow-sm shadow-blue-950/20 transition hover:-translate-y-0.5 hover:border-blue-300/50 hover:bg-blue-500/20 hover:text-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <PenLine size={13} strokeWidth={2.4} />
            </button>
          </div>
        )}
        <div className="text-xs text-slate-500">{stream.videoId}</div>
        {stream.errorMessage ? (
          <div className="mt-1 max-w-lg text-xs text-red-600 dark:text-red-300">{stream.errorMessage}</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <Badge value={stream.status} />
        {stream.recoveryStatus && ['WAITING', 'RUNNING', 'FAILED'].includes(stream.recoveryStatus) ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="alert">
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              {stream.recoveryStatus === 'FAILED'
                ? 'Recovery stopped after 5 attempts'
                : `Auto-recovery · ${stream.recoveryAttempts}/5`}
            </span>
            <Button
              type="button"
              variant="secondary"
              className="h-7 px-2 text-[11px]"
              disabled={acknowledgingRecovery}
              onClick={() => void acknowledgeRecovery()}
            >
              I’ve noticed
            </Button>
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatDate(stream.lastMessageAt)}</td>
      <td className="px-4 py-3 text-right">{formatNumber(stream._count.messages)}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/70 px-2 py-1.5 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-950/40">
            {captureActions.map((item) => (
              <StreamActionButton
                key={item.action}
                label={item.label}
                icon={item.icon}
                tone={item.tone}
                onClick={() => void control(item.action)}
              />
            ))}
            <span className="mx-0.5 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            <StreamActionButton label="Delete stream" icon={Trash2} tone="danger" onClick={() => void control('delete')} />
          </div>
        </div>
      </td>
    </tr>
  );
}

function getCaptureActions(status: string): CaptureAction[] {
  switch (status) {
    case 'CAPTURING':
      return [
        { action: 'pause', label: 'Pause capture', icon: CirclePause, tone: 'warning' },
        { action: 'stop', label: 'Stop capture', icon: ShieldX, tone: 'neutral' }
      ];
    case 'PAUSED':
      return [
        { action: 'resume', label: 'Resume capture', icon: RefreshCcw, tone: 'info' },
        { action: 'stop', label: 'Stop capture', icon: ShieldX, tone: 'neutral' }
      ];
    case 'PENDING':
    case 'RETRYING':
      return [
        { action: 'pause', label: 'Pause capture', icon: CirclePause, tone: 'warning' },
        { action: 'stop', label: 'Stop capture', icon: ShieldX, tone: 'neutral' }
      ];
    default:
      return [{ action: 'start', label: 'Start capture', icon: CirclePlay, tone: 'success' }];
  }
}

function StreamActionButton({
  label,
  icon: Icon,
  tone,
  onClick
}: {
  label: string;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'info' | 'neutral' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        'group relative inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition duration-150',
        'hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 active:translate-y-0',
        tone === 'success' &&
          'border-emerald-400/25 bg-emerald-500/10 text-emerald-600 hover:border-emerald-400/50 hover:bg-emerald-500/20 focus:ring-emerald-400 dark:text-emerald-300',
        tone === 'warning' &&
          'border-amber-400/25 bg-amber-500/10 text-amber-600 hover:border-amber-400/50 hover:bg-amber-500/20 focus:ring-amber-400 dark:text-amber-300',
        tone === 'info' &&
          'border-sky-400/25 bg-sky-500/10 text-sky-600 hover:border-sky-400/50 hover:bg-sky-500/20 focus:ring-sky-400 dark:text-sky-300',
        tone === 'neutral' &&
          'border-slate-400/20 bg-slate-500/10 text-slate-600 hover:border-slate-400/50 hover:bg-slate-500/20 focus:ring-slate-400 dark:text-slate-300',
        tone === 'danger' &&
          'border-red-400/25 bg-red-600 text-white shadow-red-950/20 hover:border-red-300/60 hover:bg-red-500 focus:ring-red-400',
      )}
    >
      <Icon size={16} strokeWidth={2.35} />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}
