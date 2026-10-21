'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, Trash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';
import { useToast } from '@/components/Toast';

interface ChatAuthor {
  id: string;
  displayName: string;
  authorChannelId: string | null;
  avatarUrl: string | null;
  _count: { messages: number };
}

interface LatestSession {
  startAt: string;
  endAt: string;
  durationSeconds: number;
  totalMessages: number;
}

interface UserUpdateRow {
  id: string;
  addedAt: string;
  author: ChatAuthor;
  latestSession: LatestSession | null;
}

export default function UsersUpdatePage() {
  return (
    <DashboardShell>
      <UsersUpdateContent />
    </DashboardShell>
  );
}

function UsersUpdateContent() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [rows, setRows] = useState<UserUpdateRow[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingAuthorId, setSavingAuthorId] = useState<string | null>(null);

  const watchedAuthorIds = useMemo(() => new Set(rows.map((row) => row.author.id)), [rows]);

  const loadRows = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const data = await apiFetch<{ users: UserUpdateRow[] }>('/users/updates');
        setRows(data.users);
      } catch (error) {
        if (!quiet) {
          pushToast(
            error instanceof Error ? error.message : 'Could not load Users Update',
            'error',
          );
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [pushToast],
  );

  useEffect(() => {
    void loadRows();
    const interval = window.setInterval(() => {
      void loadRows(true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadRows]);

  async function search(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const data = await apiFetch<{ users: ChatAuthor[] }>(
        `/users/search?q=${encodeURIComponent(value)}`,
      );
      setResults(data.users);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not search users', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function addUser(author: ChatAuthor) {
    setSavingAuthorId(author.id);
    try {
      const data = await apiFetch<{ users: UserUpdateRow[] }>('/users/updates', {
        method: 'POST',
        body: JSON.stringify({ authorId: author.id }),
      });
      setRows(data.users);
      setResults((current) => current.filter((result) => result.id !== author.id));
      setQuery('');
      pushToast(`${author.displayName} added to Users Update`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not add user', 'error');
    } finally {
      setSavingAuthorId(null);
    }
  }

  async function removeUser(row: UserUpdateRow) {
    if (
      !window.confirm(
        `Remove ${row.author.displayName} from Users Update? Their chat history will not be deleted.`,
      )
    ) {
      return;
    }

    setSavingAuthorId(row.author.id);
    try {
      const data = await apiFetch<{ users: UserUpdateRow[] }>(
        `/users/updates/${encodeURIComponent(row.author.id)}`,
        { method: 'DELETE' },
      );
      setRows(data.users);
      pushToast(`${row.author.displayName} removed from Users Update`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not remove user', 'error');
    } finally {
      setSavingAuthorId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Users Update"
        subtitle="Keep selected chat users here and follow their latest conversation session."
        action={
          <Button type="button" variant="secondary" onClick={() => loadRows()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />

      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Add User" />
          <form className="flex flex-col gap-2 p-4 sm:flex-row" onSubmit={search}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search username or channel ID"
              className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <Button type="submit" disabled={searching || !query.trim()}>
              <Search size={15} />
              {searching ? 'Searching' : 'Search'}
            </Button>
          </form>

          {results.length > 0 ? (
            <div className="border-t border-slate-200 p-4 dark:border-slate-800">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {results.map((author) => {
                  const alreadyAdded = watchedAuthorIds.has(author.id);
                  return (
                    <div
                      key={author.id}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <UserAvatar author={author} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{author.displayName}</div>
                        <div className="text-xs text-slate-500">
                          {formatNumber(author._count.messages)} messages
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="h-8 shrink-0 px-2 text-xs"
                        variant={alreadyAdded ? 'secondary' : 'primary'}
                        disabled={alreadyAdded || savingAuthorId === author.id}
                        onClick={() => addUser(author)}
                      >
                        <Plus size={13} />
                        {alreadyAdded ? 'Added' : 'Add'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            title="Tracked Users"
            action={
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                {formatNumber(rows.length)}
              </span>
            }
          />

          {loading && rows.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">Loading tracked users...</div>
          ) : rows.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">
              No users added yet. Search above and add a user to keep their latest session here.
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>Users remain in this list until you remove them.</span>
                <span className="shrink-0">Auto-refresh: 30 seconds</span>
              </div>

              <div className="app-users-table-scroll overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="app-users-table w-full min-w-[880px]">
                  <div className="app-users-table-header grid grid-cols-[minmax(200px,1.5fr)_minmax(150px,1.1fr)_minmax(150px,1.1fr)_minmax(120px,.85fr)_minmax(76px,.55fr)_72px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/70">
                    <div>Username</div>
                    <div>Start</div>
                    <div>End</div>
                    <div>Duration</div>
                    <div>Messages</div>
                    <div className="text-right">Actions</div>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="app-users-table-row grid grid-cols-[minmax(200px,1.5fr)_minmax(150px,1.1fr)_minmax(150px,1.1fr)_minmax(120px,.85fr)_minmax(76px,.55fr)_72px] items-center gap-3 bg-white px-4 py-4 transition hover:bg-slate-50 dark:bg-slate-950/20 dark:hover:bg-slate-900/40"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar author={row.author} />
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100 dark:hover:text-blue-300"
                              title={`Open ${row.author.displayName} conversation sessions`}
                              onClick={() => router.push(`/users?authorId=${encodeURIComponent(row.author.id)}&view=sessions`)}
                            >
                              {row.author.displayName}
                            </button>
                            <div className="truncate text-xs text-slate-500" title={`Last seen ${formatTimeAgo(row.latestSession?.endAt)}`}>
                              Last seen {formatTimeAgo(row.latestSession?.endAt)}
                            </div>
                          </div>
                        </div>

                        <SessionField
                          label="Start"
                          value={formatDate(row.latestSession?.startAt)}
                        />
                        <SessionField label="End" value={formatDate(row.latestSession?.endAt)} />
                        <SessionField
                          label="Duration"
                          value={
                            row.latestSession
                              ? formatSessionDuration(row.latestSession.durationSeconds)
                              : '-'
                          }
                        />
                        <SessionField
                          label="Messages"
                          value={
                            row.latestSession ? formatNumber(row.latestSession.totalMessages) : '-'
                          }
                        />

                        <div className="app-users-table-actions flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 w-9 rounded-xl border border-red-400/25 bg-red-600 p-0 text-white shadow-sm shadow-red-950/20 transition hover:-translate-y-0.5 hover:border-red-300/60 hover:bg-red-500 hover:shadow-md focus-visible:ring-2 focus-visible:ring-red-400 active:translate-y-0"
                            aria-label={`Remove ${row.author.displayName}`}
                            title={`Remove ${row.author.displayName}`}
                            disabled={savingAuthorId === row.author.id}
                            onClick={() => removeUser(row)}
                          >
                            <Trash size={18} strokeWidth={2.5} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function UserAvatar({ author }: { author: ChatAuthor }) {
  if (author.avatarUrl) {
    return (
      <img src={author.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {Array.from(author.displayName.replace(/^@/, '').trim())[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function SessionField({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="app-users-session-field min-w-0"
      data-label={label}
      aria-label={`${label}: ${value}`}
    >
      <div
        className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function formatSessionDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1 minute';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTimeAgo(value: string | Date | null | undefined) {
  if (!value) return 'not seen yet';
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(value).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return 'not seen yet';
  if (minutes < 1) return 'just now';
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainingMinutes = minutes % 60;
  if (days >= 2) return `${days} days ago`;
  if (days === 1) return `1 day${hours ? ` ${hours} ${hours === 1 ? 'hour' : 'hours'}` : ''} ago`;
  if (hours) return `${hours} ${hours === 1 ? 'hour' : 'hours'}${remainingMinutes ? ` ${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}` : ''} ago`;
  return `${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'} ago`;
}
