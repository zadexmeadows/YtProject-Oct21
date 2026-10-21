'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Download, Loader2 } from 'lucide-react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { ChatFeed } from '@/components/ChatFeed';
import { apiFetch } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useToast } from '@/components/Toast';

const PAGE_SIZE = 250;

export interface ChatHistoryInitialParams {
  streamId?: string;
  from?: string;
  to?: string;
}

interface MessageRow {
  id: string;
  streamId: string;
  videoId: string;
  streamTitle: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  authorChannelId: string | null;
  messageText: string;
  messageType: string;
  badges: unknown;
  amount: string | null;
  currency: string | null;
  capturedAt: string;
  rawPayload: unknown;
}

interface StreamRow {
  id: string;
  videoId: string;
  title: string | null;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export function ChatHistoryClient({ initialParams }: { initialParams: ChatHistoryInitialParams }) {
  return (
    <DashboardShell>
      <ChatHistoryContent initialParams={initialParams} />
    </DashboardShell>
  );
}

function ChatHistoryContent({ initialParams }: { initialParams: ChatHistoryInitialParams }) {
  const { pushToast } = useToast();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    pageCount: 0
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const hasRequiredRange = Boolean(initialParams.from && initialParams.to);

  useEffect(() => {
    void apiFetch<{ streams: StreamRow[] }>('/streams').then((data) => setStreams(data.streams));
  }, []);

  const load = useCallback(async () => {
    if (!hasRequiredRange || !initialParams.from || !initialParams.to) {
      setLoading(false);
      setError('Choose a start and end time from the Live Chat page.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        from: initialParams.from,
        to: initialParams.to,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      if (initialParams.streamId) params.set('streamId', initialParams.streamId);

      const data = await apiFetch<{ messages: MessageRow[]; pagination: PaginationState }>(`/messages/history?${params}`);
      setMessages(data.messages);
      setPagination(data.pagination);
    } catch (err) {
      setMessages([]);
      setPagination({ page, pageSize: PAGE_SIZE, total: 0, pageCount: 0 });
      setError(err instanceof Error ? err.message : 'Could not load this chat extract.');
    } finally {
      setLoading(false);
    }
  }, [hasRequiredRange, initialParams.from, initialParams.streamId, initialParams.to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const streamLabel = useMemo(() => {
    if (!initialParams.streamId) return 'All streams';
    const stream = streams.find((item) => item.id === initialParams.streamId);
    return stream?.title ?? stream?.videoId ?? 'Selected stream';
  }, [initialParams.streamId, streams]);

  const rangeLabel = useMemo(() => {
    if (!initialParams.from || !initialParams.to) return 'No range selected';
    return `${formatDate(initialParams.from)} to ${formatDate(initialParams.to)}`;
  }, [initialParams.from, initialParams.to]);

  async function exportExtract() {
    if (!initialParams.from || !initialParams.to) return;

    setExporting(true);
    try {
      await apiFetch('/exports', {
        method: 'POST',
        body: JSON.stringify({
          format: 'PDF',
          type: 'DATE_RANGE',
          filters: {
            ...(initialParams.streamId ? { streamId: initialParams.streamId } : {}),
            from: initialParams.from,
            to: initialParams.to
          }
        })
      });
      pushToast('Past chat PDF queued', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not queue past chat PDF', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Past Chat Extract"
        action={
          <Link
            href="/chat"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronLeft size={16} />
            Live Chat
          </Link>
        }
      />

      <Panel className="mb-4">
        <PanelHeader
          title="Extract Window"
          action={
            loading ? (
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Loading
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void exportExtract()}
                disabled={!hasRequiredRange || pagination.total === 0 || exporting}
              >
                <Download size={15} />
                {exporting ? 'Queuing' : 'Export PDF'}
              </Button>
            )
          }
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <InfoCard label="Stream" value={streamLabel} />
          <InfoCard label="Time range" value={rangeLabel} />
          <InfoCard label="Messages found" value={formatNumber(pagination.total)} />
        </div>
      </Panel>

      {error ? (
        <Panel className="mb-4 border-red-500/30 bg-red-500/10">
          <div className="flex items-start gap-3 p-4 text-sm text-red-700 dark:text-red-200">
            <Clock3 size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        </Panel>
      ) : null}

      <ChatFeed
        title="Timeline Chat"
        compact
        messages={messages}
        className="h-[calc(100vh-310px)] min-h-[430px]"
        bodyClassName="h-[calc(100%-56px)] pb-4"
        rightLabel={`${formatNumber(messages.length)} shown`}
        emptyText={loading ? 'Loading chat messages...' : 'No messages found in this time range'}
      />

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-slate-600 dark:text-slate-400">
          Page {pagination.page} of {Math.max(1, pagination.pageCount)}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <ChevronLeft size={16} />
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={loading || page >= pagination.pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}
