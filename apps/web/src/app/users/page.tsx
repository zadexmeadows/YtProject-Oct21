'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Download, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { PAKISTAN_TIME_ZONE } from '@ytbot/shared';
import { formatDate, formatNumber } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { ChatFeed } from '@/components/ChatFeed';

interface ChatAuthor {
  id: string;
  displayName: string;
  authorChannelId: string | null;
  avatarUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  _count: { messages: number };
}

interface Intelligence {
  authors: ChatAuthor[];
  totalMessages: number;
  firstSeen: string | null;
  lastSeen: string | null;
  mostUsedWords: Array<{ word: string; count: number }>;
  messages: Array<{
    id: string;
    authorName: string;
    authorAvatarUrl?: string | null;
    authorChannelId?: string | null;
    messageText: string;
    messageType?: string | null;
    badges?: unknown;
    amount?: string | number | null;
    currency?: string | null;
    capturedAt: string;
    rawPayload?: unknown;
    author: Pick<ChatAuthor, 'id' | 'displayName' | 'authorChannelId' | 'avatarUrl'> | null;
    stream: { title: string | null; videoId: string };
  }>;
  streams: Array<{ streamId: string; videoId: string; title: string | null; _count: { streamId: number } }>;
}

type ChatMessage = Intelligence['messages'][number];
type ViewMode = 'messages' | 'sessions';

interface ConversationSession {
  sessionNumber: number;
  streamId: string;
  videoId: string;
  streamTitle: string | null;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  totalMessages: number;
  preview: string | null;
}

const TIME_FILTERS = [
  { value: '6h', label: 'Past 6 hours', hours: 6 },
  { value: '12h', label: 'Past 12 hours', hours: 12 },
  { value: '24h', label: 'Past 24 hours', hours: 24 },
  { value: '3d', label: 'Past 3 days', hours: 72 },
  { value: '7d', label: 'Past 7 days', hours: 168 },
  { value: 'all', label: 'All time' }
] as const;

const SESSION_PAGE_SIZE = 25;
const SESSION_MESSAGE_PAGE_SIZE = 200;
const INTELLIGENCE_MESSAGE_PAGE_SIZE = 500;

type TimeFilterValue = (typeof TIME_FILTERS)[number]['value'];

export default function UsersPage() {
  return (
    <DashboardShell>
      <UsersContent />
    </DashboardShell>
  );
}

function UsersContent() {
  const router = useRouter();
  const { pushToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const openedLinkedUser = useRef(false);
  const intelligenceOrderAnchor = useRef(getNextOrderWindowAnchor('24h'));
  const [displayOrderAnchor, setDisplayOrderAnchor] = useState(intelligenceOrderAnchor.current);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<ChatAuthor[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<ChatAuthor[]>([]);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [availableStreams, setAvailableStreams] = useState<Intelligence['streams']>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilterValue>('all');
  const [orderFilter, setOrderFilter] = useState<TimeFilterValue>('24h');
  const [streamFilter, setStreamFilter] = useState('');
  const [messagePage, setMessagePage] = useState(1);
  const [messageTotal, setMessageTotal] = useState(0);
  const [loadingIntelligenceMessages, setLoadingIntelligenceMessages] = useState(false);
  const [loadingMoreIntelligenceMessages, setLoadingMoreIntelligenceMessages] = useState(false);
  const [view, setView] = useState<ViewMode>('messages');
  const [searching, setSearching] = useState(false);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [openSession, setOpenSession] = useState<ConversationSession | null>(null);
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([]);
  const [sessionMessageTotal, setSessionMessageTotal] = useState(0);
  const [sessionMessagePage, setSessionMessagePage] = useState(1);
  const [loadingSessionMessages, setLoadingSessionMessages] = useState(false);
  const [sessionParticipants, setSessionParticipants] = useState<ChatAuthor[]>([]);
  const [sessionQ, setSessionQ] = useState('');
  const [sessionUserResults, setSessionUserResults] = useState<ChatAuthor[]>([]);
  const [searchingSessionUsers, setSearchingSessionUsers] = useState(false);
  const [exportingUsers, setExportingUsers] = useState(false);
  const [exportingSession, setExportingSession] = useState(false);

  const primaryUser = selectedUsers[0] ?? null;

  useEffect(() => {
    if (openedLinkedUser.current) return;
    openedLinkedUser.current = true;

    const authorId = new URLSearchParams(window.location.search).get('authorId')?.trim();
    if (!authorId) return;

    setLoadingIntel(true);
    const requestedView = new URLSearchParams(window.location.search).get('view');
    apiFetch<Intelligence>(`/users/${encodeURIComponent(authorId)}/intelligence`)
      .then(async (data) => {
        setSelectedUsers(data.authors);
        if (requestedView === 'sessions') {
          setView('sessions');
          await loadSessions(data.authors[0] ?? null, 'all', 1, false);
        }
        await loadAuthors(data.authors, 'all', '', orderFilter);
      })
      .catch(() => pushToast('Could not open this user’s conversations', 'error'))
      .finally(() => setLoadingIntel(false));
  }, [pushToast]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      const data = await apiFetch<{ users: ChatAuthor[] }>(`/users/search?q=${encodeURIComponent(q)}`);
      setUsers(data.users);
    } catch {
      pushToast('Could not search users', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function loadAuthors(
    nextUsers: ChatAuthor[],
    nextTimeFilter = timeFilter,
    requestedStreamId = streamFilter,
    nextOrderFilter = orderFilter
  ) {
    intelligenceOrderAnchor.current = getNextOrderWindowAnchor(nextOrderFilter);
    setDisplayOrderAnchor(intelligenceOrderAnchor.current);
    if (nextUsers.length === 0) {
      setIntel(null);
      setAvailableStreams([]);
      setMessageTotal(0);
      setMessagePage(1);
      return;
    }

    setLoadingIntel(true);
    try {
      const primary = nextUsers[0];
      if (!primary) return;
      const authorIds = nextUsers.map((user) => user.id).join(',');
      const params = new URLSearchParams({ authorIds, primaryAuthorId: primary.id });
      const from = getTimeFilterStart(nextTimeFilter);
      if (from) params.set('from', from);

      const allData = await apiFetch<Intelligence>(`/users/intelligence?${params.toString()}`);
      setAvailableStreams(allData.streams);
      const effectiveStreamId = requestedStreamId && allData.streams.some((stream) => stream.streamId === requestedStreamId)
        ? requestedStreamId
        : '';
      setStreamFilter(effectiveStreamId);
      const data = effectiveStreamId
        ? await apiFetch<Intelligence>(`/users/intelligence?${new URLSearchParams({
            ...Object.fromEntries(params.entries()),
            streamId: effectiveStreamId
          }).toString()}`)
        : allData;
      setIntel({ ...data, messages: [] });
      await loadIntelligenceMessagePage(nextUsers, nextTimeFilter, nextOrderFilter, effectiveStreamId, 1, false);
    } catch {
      pushToast('Could not load user intelligence', 'error');
    } finally {
      setLoadingIntel(false);
    }
  }

  async function loadIntelligenceMessagePage(
    authors: ChatAuthor[],
    nextTimeFilter: TimeFilterValue,
    nextOrderFilter: TimeFilterValue,
    nextStreamId: string,
    page: number,
    append: boolean
  ) {
    const primary = authors[0];
    if (!primary) return;

    const from = getTimeFilterStart(nextTimeFilter);
    const orderWindow = TIME_FILTERS.find((option) => option.value === nextOrderFilter);
    const orderWindowHours = orderWindow && 'hours' in orderWindow ? orderWindow.hours : 0;
    const params = new URLSearchParams({
      authorIds: authors.map((author) => author.id).join(','),
      primaryAuthorId: primary.id,
      page: String(page),
      pageSize: String(INTELLIGENCE_MESSAGE_PAGE_SIZE),
      orderWindowHours: String(orderWindowHours),
      orderAnchor: intelligenceOrderAnchor.current
    });
    if (from) params.set('from', from);
    if (nextStreamId) params.set('streamId', nextStreamId);

    if (append) setLoadingMoreIntelligenceMessages(true);
    else setLoadingIntelligenceMessages(true);
    try {
      const data = await apiFetch<{
        messages: ChatMessage[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/users/intelligence/messages?${params.toString()}`);
      setIntel((current) => current
        ? { ...current, messages: append ? [...current.messages, ...data.messages] : data.messages }
        : current);
      setMessageTotal(data.total);
      setMessagePage(data.page);
    } catch {
      pushToast('Could not load intelligence messages', 'error');
    } finally {
      setLoadingIntelligenceMessages(false);
      setLoadingMoreIntelligenceMessages(false);
    }
  }

  async function loadSessions(
    author: ChatAuthor | null = primaryUser,
    nextTimeFilter = timeFilter,
    page = 1,
    append = false,
    nextStreamId = streamFilter,
  ) {
    if (!author) {
      setSessions([]);
      setSessionsTotal(0);
      setOpenSession(null);
      return;
    }

    setLoadingSessions(true);
    try {
      const params = new URLSearchParams({
        authorId: author.id,
        page: String(page),
        pageSize: String(SESSION_PAGE_SIZE)
      });
      const from = getTimeFilterStart(nextTimeFilter);
      if (from) params.set('from', from);
      if (nextStreamId) params.set('streamId', nextStreamId);

      const data = await apiFetch<{
        sessions: ConversationSession[];
        totalSessions: number;
        page: number;
        pageSize: number;
      }>(`/users/sessions?${params.toString()}`);

      setSessions((current) => (append ? [...current, ...data.sessions] : data.sessions));
      setSessionsTotal(data.totalSessions);
      setSessionsPage(page);
      if (!append) {
        setOpenSession(null);
        setSessionMessages([]);
        setSessionMessageTotal(0);
        setSessionParticipants([]);
      }
    } catch {
      pushToast('Could not load conversation sessions', 'error');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadSessionMessages(
    session: ConversationSession | null = openSession,
    participants = sessionParticipants,
    page = 1,
    append = false,
  ) {
    if (!primaryUser || !session) return;

    setLoadingSessionMessages(true);
    try {
      const authorIds = uniqueAuthors([primaryUser, ...participants]).map((user) => user.id).join(',');
      const params = new URLSearchParams({
        authorIds,
        streamId: session.streamId,
        from: session.startAt,
        to: session.endAt,
        page: String(page),
        pageSize: String(SESSION_MESSAGE_PAGE_SIZE)
      });
      const data = await apiFetch<{
        messages: ChatMessage[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/users/session-messages?${params.toString()}`);

      setSessionMessages((current) => (append ? [...current, ...data.messages] : data.messages));
      setSessionMessageTotal(data.total);
      setSessionMessagePage(page);
    } catch {
      pushToast('Could not load session messages', 'error');
    } finally {
      setLoadingSessionMessages(false);
    }
  }

  async function addAuthor(user: ChatAuthor) {
    if (selectedUsers.some((selectedUser) => selectedUser.id === user.id)) {
      pushToast('User is already in the combined view');
      return;
    }
    if (selectedUsers.length >= 10) {
      pushToast('You can combine up to 10 users', 'error');
      return;
    }

    const nextUsers = [...selectedUsers, user];
    setSelectedUsers(nextUsers);
    setUsers([]);
    setQ('');
    if (selectedUsers.length === 0) {
      setTimeFilter('all');
      setOrderFilter('24h');
      setStreamFilter('');
      await loadAuthors(nextUsers, 'all', '', '24h');
      if (view === 'sessions') await loadSessions(nextUsers[0], 'all', 1, false, '');
      return;
    }
    await loadAuthors(nextUsers);
    if (view === 'sessions') await loadSessions(nextUsers[0], timeFilter, 1, false);
  }

  async function removeAuthor(authorId: string) {
    const nextUsers = selectedUsers.filter((user) => user.id !== authorId);
    setSelectedUsers(nextUsers);
    await loadAuthors(nextUsers);
    if (view === 'sessions') await loadSessions(nextUsers[0] ?? null, timeFilter, 1, false);
  }

  async function clearAuthors() {
    setSelectedUsers([]);
    setIntel(null);
    setSessions([]);
    setSessionsTotal(0);
    setOpenSession(null);
    setSessionMessages([]);
    setSessionParticipants([]);
  }

  async function changeTimeFilter(nextTimeFilter: TimeFilterValue) {
    setTimeFilter(nextTimeFilter);
    await loadAuthors(selectedUsers, nextTimeFilter, streamFilter, orderFilter);
    if (view === 'sessions') await loadSessions(primaryUser, nextTimeFilter, 1, false);
  }

  async function changeOrderFilter(nextOrderFilter: TimeFilterValue) {
    intelligenceOrderAnchor.current = getNextOrderWindowAnchor(nextOrderFilter);
    setDisplayOrderAnchor(intelligenceOrderAnchor.current);
    setOrderFilter(nextOrderFilter);
    await loadIntelligenceMessagePage(selectedUsers, timeFilter, nextOrderFilter, streamFilter, 1, false);
  }

  async function changeStreamFilter(nextStreamId: string) {
    setStreamFilter(nextStreamId);
    await loadAuthors(selectedUsers, timeFilter, nextStreamId, orderFilter);
    if (view === 'sessions') await loadSessions(primaryUser, timeFilter, 1, false, nextStreamId);
  }

  async function loadMoreIntelligenceMessages() {
    await loadIntelligenceMessagePage(selectedUsers, timeFilter, orderFilter, streamFilter, messagePage + 1, true);
  }

  async function changeView(nextView: ViewMode) {
    setView(nextView);
    if (nextView === 'sessions') await loadSessions(primaryUser, timeFilter, 1, false);
  }

  async function openConversationSession(session: ConversationSession) {
    const initialParticipants = selectedUsers.slice(1);
    setOpenSession(session);
    setSessionParticipants(initialParticipants);
    setSessionUserResults([]);
    setSessionQ('');
    await loadSessionMessages(session, initialParticipants, 1, false);
  }

  function openFullChat(session: ConversationSession) {
    const params = new URLSearchParams({
      streamId: session.streamId,
      from: session.startAt,
      to: session.endAt
    });
    router.push(`/chat/history?${params.toString()}`);
  }

  async function loadMoreSessions() {
    await loadSessions(primaryUser, timeFilter, sessionsPage + 1, true);
  }

  async function loadMoreSessionMessages() {
    await loadSessionMessages(openSession, sessionParticipants, sessionMessagePage + 1, true);
  }

  async function searchSessionUsers(event: FormEvent) {
    event.preventDefault();
    const query = sessionQ.trim();
    if (!query || !primaryUser) return;

    setSearchingSessionUsers(true);
    try {
      const data = await apiFetch<{ users: ChatAuthor[] }>(`/users/search?q=${encodeURIComponent(query)}`);
      const alreadySelected = new Set([primaryUser.id, ...sessionParticipants.map((user) => user.id)]);
      setSessionUserResults(data.users.filter((user) => !alreadySelected.has(user.id)));
    } catch {
      pushToast('Could not search users', 'error');
    } finally {
      setSearchingSessionUsers(false);
    }
  }

  async function addSessionParticipant(user: ChatAuthor) {
    if (!openSession || !primaryUser) return;
    if (user.id === primaryUser.id || sessionParticipants.some((participant) => participant.id === user.id)) return;
    if (sessionParticipants.length >= 9) {
      pushToast('A session PDF can include up to 10 users', 'error');
      return;
    }

    const nextParticipants = [...sessionParticipants, user];
    setSessionParticipants(nextParticipants);
    setSessionUserResults([]);
    setSessionQ('');
    await loadSessionMessages(openSession, nextParticipants, 1, false);
  }

  async function removeSessionParticipant(authorId: string) {
    if (!openSession) return;
    const nextParticipants = sessionParticipants.filter((participant) => participant.id !== authorId);
    setSessionParticipants(nextParticipants);
    await loadSessionMessages(openSession, nextParticipants, 1, false);
  }

  async function exportUser() {
    const primary = selectedUsers[0];
    if (!intel || selectedUsers.length === 0 || !primary) return;

    const from = getTimeFilterStart(timeFilter);
    setExportingUsers(true);
    try {
      await apiFetch('/exports', {
        method: 'POST',
        body: JSON.stringify({
          format: 'PDF',
          type: 'USER_CHAT',
          filters: {
            authorIds: selectedUsers.map((user) => user.id),
            timelineAuthorId: primary.id,
            ...(from ? { from } : {})
          }
        })
      });
      pushToast(`${selectedUsers.length > 1 ? 'Combined user' : 'User'} PDF queued`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not queue user PDF', 'error');
    } finally {
      setExportingUsers(false);
    }
  }

  async function exportConversationSession() {
    if (!primaryUser || !openSession) return;

    const participants = uniqueAuthors([primaryUser, ...sessionParticipants]);
    setExportingSession(true);
    try {
      await apiFetch('/exports', {
        method: 'POST',
        body: JSON.stringify({
          format: 'PDF',
          type: 'USER_CHAT',
          filters: {
            authorIds: participants.map((user) => user.id),
            streamId: openSession.streamId,
            from: openSession.startAt,
            to: openSession.endAt
          }
        })
      });
      pushToast(`Session ${openSession.sessionNumber} PDF queued`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not queue session PDF', 'error');
    } finally {
      setExportingSession(false);
    }
  }

  const hasMoreSessions = sessions.length < sessionsTotal;
  const hasMoreSessionMessages = sessionMessages.length < sessionMessageTotal;
  const hasMoreIntelligenceMessages = Boolean(intel && intel.messages.length < messageTotal);
  const selectedOrderWindow = TIME_FILTERS.find((option) => option.value === orderFilter);
  const orderWindowHours = selectedOrderWindow && 'hours' in selectedOrderWindow ? selectedOrderWindow.hours : 0;

  return (
    <>
      <PageHeader title="User Intelligence" />
      <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Search Users" />
          <form className="flex gap-2 p-4" onSubmit={search}>
            <input
              ref={inputRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Name or channel ID"
              className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <Button type="submit" className="h-10 w-10 p-0" aria-label="Search" disabled={searching}>
              <Search size={16} />
            </Button>
          </form>

          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Selected users</div>
                  {selectedUsers.length > 0 ? (
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-300">
                      {formatNumber(selectedUsers.length)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs leading-5 text-slate-500">Added users appear only inside primary user active sessions.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  inputRef.current?.focus();
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-blue-400/25 bg-blue-500/10 px-3 text-xs font-semibold text-blue-600 transition hover:border-blue-400/50 hover:bg-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-blue-300"
              >
                <Plus size={14} strokeWidth={2.4} />
                Add user
              </button>
            </div>

            {selectedUsers.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((user, index) => (
                    <span
                      key={user.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <span className="h-5 w-5 rounded-full bg-slate-200 dark:bg-slate-800" />
                      )}
                      <span className="max-w-[150px] truncate font-medium">{user.displayName}</span>
                      {index === 0 ? (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-300">
                          Primary
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAuthor(user.id)}
                        className="rounded-full p-0.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-600"
                        aria-label={`Remove ${user.displayName}`}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" className="text-xs font-semibold text-slate-500 transition hover:text-red-500" onClick={clearAuthors}>
                    Clear all
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-3 py-4 dark:border-slate-700 dark:bg-slate-950/40">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">No users selected</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">Search above, then add one or more chat users to build a combined timeline.</div>
              </div>
            )}
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-950"
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
                ) : (
                  <span className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                )}
                <button type="button" onClick={() => addAuthor(user)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{user.displayName}</span>
                  <span className="block text-xs text-slate-500">{formatNumber(user._count.messages)} messages</span>
                </button>
                <Button
                  type="button"
                  variant={selectedUsers.some((selectedUser) => selectedUser.id === user.id) ? 'secondary' : 'primary'}
                  disabled={selectedUsers.some((selectedUser) => selectedUser.id === user.id)}
                  onClick={() => addAuthor(user)}
                >
                  <Plus size={14} />
                  {selectedUsers.some((selectedUser) => selectedUser.id === user.id) ? 'Added' : 'Add'}
                </Button>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4 xl:contents">
          <Panel>
            <PanelHeader
              title={selectedUsers.length > 1 ? 'Combined Profile' : 'Profile'}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void exportUser()}
                  disabled={!intel || selectedUsers.length === 0 || exportingUsers}
                >
                  <Download size={15} />
                  {exportingUsers ? 'Queuing' : 'Export PDF'}
                </Button>
              }
            />
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Message time range</div>
              <div className="flex flex-wrap gap-2">
                {TIME_FILTERS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={timeFilter === option.value ? 'primary' : 'secondary'}
                    className="h-8 px-2 text-xs"
                    onClick={() => changeTimeFilter(option.value)}
                    disabled={loadingIntel && timeFilter === option.value}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                  Message order window · newest block first
                </div>
                <div className="flex flex-wrap gap-2">
                  {TIME_FILTERS.map((option) => (
                    <Button
                      key={`order-${option.value}`}
                      type="button"
                      variant={orderFilter === option.value ? 'primary' : 'secondary'}
                      className="h-8 px-2 text-xs"
                      onClick={() => void changeOrderFilter(option.value)}
                      disabled={loadingIntelligenceMessages && orderFilter === option.value}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-2 max-w-2xl text-xs text-slate-500">
                  Groups messages from the Message time range into consecutive windows. Newest window comes first; messages inside each window run oldest to newest.
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="intelligence-stream-filter" className="text-xs font-semibold uppercase text-slate-500">
                  Stream
                </label>
                <select
                  id="intelligence-stream-filter"
                  value={streamFilter}
                  onChange={(event) => void changeStreamFilter(event.target.value)}
                  disabled={availableStreams.length === 0 || loadingIntel}
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">All streams</option>
                  {availableStreams.map((stream) => (
                    <option key={stream.streamId} value={stream.streamId}>
                      {stream.title || stream.videoId} · {formatNumber(stream._count.streamId)} messages
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={view === 'messages' ? 'primary' : 'secondary'}
                  onClick={() => changeView('messages')}
                >
                  Messages
                </Button>
                <Button
                  type="button"
                  variant={view === 'sessions' ? 'primary' : 'secondary'}
                  onClick={() => changeView('sessions')}
                  disabled={!primaryUser}
                >
                  Conversation Sessions
                </Button>
              </div>
            </div>
            {intel ? (
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800 md:grid-cols-4 md:divide-y-0">
                <ProfileStat label="Total messages" value={formatNumber(intel.totalMessages)} />
                <ProfileStat label="First seen" value={formatProfileDateTime(intel.firstSeen)} title={intel.firstSeen ? formatDate(intel.firstSeen) : undefined} />
                <ProfileStat label="Last seen" value={formatProfileDateTime(intel.lastSeen)} title={intel.lastSeen ? formatDate(intel.lastSeen) : undefined} />
                <ProfileStat label="Streams" value={formatNumber(intel.streams.length)} />
              </div>
            ) : loadingIntel ? (
              <div className="p-4 text-sm text-slate-500">Loading selected users...</div>
            ) : (
              <div className="p-4 text-sm text-slate-500">No users selected</div>
            )}
          </Panel>

          {view === 'messages' ? (
            <>
              <div className="space-y-4 xl:col-span-2">
              <ChatFeed
                title={selectedUsers.length > 1 ? 'Combined Messages' : 'Messages'}
                messages={intel?.messages ?? []}
                className="min-h-[520px]"
                bodyClassName="max-h-[680px]"
                rightLabel={intel ? `${formatNumber(intel.messages.length)} of ${formatNumber(messageTotal)} · ${getTimeFilterLabel(orderFilter)} · oldest to newest` : undefined}
                emptyText="No messages found for the selected users and time range"
                groupByDate={orderWindowHours === 0}
                groupByOrderWindow={orderWindowHours > 0 ? { hours: orderWindowHours, anchor: displayOrderAnchor } : undefined}
              />
              {hasMoreIntelligenceMessages ? (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void loadMoreIntelligenceMessages()}
                    disabled={loadingMoreIntelligenceMessages || loadingIntelligenceMessages}
                  >
                    {loadingMoreIntelligenceMessages ? 'Loading messages…' : `Load more messages (${formatNumber(messageTotal - (intel?.messages.length ?? 0))} remaining)`}
                  </Button>
                </div>
              ) : null}
              </div>
            </>
          ) : openSession ? (
            <>
              <div className="xl:col-span-2">
              <Panel>
                <PanelHeader
                  title={`Session ${openSession.sessionNumber}`}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void exportConversationSession()}
                        disabled={exportingSession}
                      >
                        <Download size={15} />
                        {exportingSession ? 'Queuing' : 'Export PDF'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setOpenSession(null)}>
                        Back to sessions
                      </Button>
                    </div>
                  }
                />
                <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-b border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800 md:grid-cols-4 md:divide-y-0">
                  <Metric label="Start" value={formatProfileDateTime(openSession.startAt)} title={formatDate(openSession.startAt)} />
                  <Metric label="End" value={formatProfileDateTime(openSession.endAt)} title={formatDate(openSession.endAt)} />
                  <Metric label="Duration" value={formatSessionDuration(openSession.durationSeconds)} />
                  <Metric label="Primary messages" value={formatNumber(openSession.totalMessages)} />
                </div>
                <div className="p-4">
                  <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Participants</div>
                  <div className="flex flex-wrap gap-2">
                    {primaryUser ? <ParticipantChip user={primaryUser} label="Primary" /> : null}
                    {sessionParticipants.map((user) => (
                      <ParticipantChip key={user.id} user={user} onRemove={() => removeSessionParticipant(user.id)} />
                    ))}
                  </div>
                  <form className="mt-4 flex gap-2" onSubmit={searchSessionUsers}>
                    <input
                      value={sessionQ}
                      onChange={(event) => setSessionQ(event.target.value)}
                      placeholder="Search another user"
                      className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    <Button type="submit" variant="secondary" disabled={searchingSessionUsers}>
                      <Plus size={15} />
                      Add User
                    </Button>
                  </form>
                  {sessionUserResults.length > 0 ? (
                    <div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {sessionUserResults.map((user) => (
                        <div key={user.id} className="flex items-center gap-3 px-3 py-2">
                          {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
                          ) : (
                            <span className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-800" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{user.displayName}</div>
                            <div className="text-xs text-slate-500">{formatNumber(user._count.messages)} messages</div>
                          </div>
                          <Button type="button" className="h-8 px-2 text-xs" onClick={() => addSessionParticipant(user)}>
                            Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Panel>
              </div>
              <div className="space-y-4 xl:col-span-2">
              <ChatFeed
                title="Session Timeline"
                messages={sessionMessages}
                className="min-h-[520px]"
                bodyClassName="max-h-[680px]"
                rightLabel={`${formatNumber(sessionMessages.length)} of ${formatNumber(sessionMessageTotal)} messages`}
                emptyText="No messages found inside this session window"
              />
              {hasMoreSessionMessages ? (
                <div className="flex justify-center">
                  <Button type="button" variant="secondary" onClick={loadMoreSessionMessages} disabled={loadingSessionMessages}>
                    Load more messages
                  </Button>
                </div>
              ) : null}
              </div>
            </>
          ) : (
            <div className="xl:col-span-2">
            <Panel>
              <PanelHeader
                title="Conversation Sessions"
                action={
                  primaryUser ? (
                    <Button type="button" variant="secondary" onClick={() => loadSessions(primaryUser, timeFilter, 1, false)} disabled={loadingSessions}>
                      Refresh
                    </Button>
                  ) : null
                }
              />
              {!primaryUser ? (
                <div className="p-4 text-sm text-slate-500">Select a primary user to view sessions.</div>
              ) : loadingSessions && sessions.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">Loading conversation sessions...</div>
              ) : sessions.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No sessions found for the selected user and time range.</div>
              ) : (
                <div className="p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-slate-500">
                      Sessions for <span className="font-semibold text-slate-800 dark:text-slate-200">{primaryUser.displayName}</span>
                    </div>
                    <div className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      Newest first
                    </div>
                  </div>

                  <div className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="hidden min-w-0 grid-cols-[minmax(180px,1.4fr)_minmax(175px,1.15fr)_minmax(175px,1.15fr)_minmax(110px,.8fr)_minmax(72px,.55fr)_minmax(120px,.75fr)] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 lg:grid">
                      <div className="truncate">Session</div>
                      <div className="truncate">Start</div>
                      <div className="truncate">End</div>
                      <div className="truncate">Duration</div>
                      <div className="truncate">Messages</div>
                      <div className="truncate text-right">Action</div>
                    </div>
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {sessions.map((session) => (
                        <div
                          key={session.sessionNumber}
                          className="grid min-w-0 gap-2 bg-white px-3 py-3 transition hover:bg-slate-50 dark:bg-slate-950/20 dark:hover:bg-slate-900/40 lg:grid-cols-[minmax(180px,1.4fr)_minmax(175px,1.15fr)_minmax(175px,1.15fr)_minmax(110px,.8fr)_minmax(72px,.55fr)_minmax(120px,.75fr)] lg:items-center"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 lg:hidden">Session</div>
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                              <button type="button" className="text-left text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300" onClick={() => void openConversationSession(session)}>
                                Session {session.sessionNumber}
                              </button>
                              <span className="truncate text-xs text-slate-500" title={session.streamTitle || session.videoId}>
                                {session.streamTitle || session.videoId}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">Last seen {formatTimeAgo(session.endAt)}</div>
                          </div>
                          <CompactSessionField label="Start" value={formatDate(session.startAt)} />
                          <CompactSessionField label="End" value={formatDate(session.endAt)} />
                          <CompactSessionField label="Duration" value={formatSessionDuration(session.durationSeconds)} />
                          <CompactSessionField label="Messages" value={formatNumber(session.totalMessages)} />
                          <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                            <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => openFullChat(session)}>
                              Full Chat
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {hasMoreSessions ? (
                    <div className="flex justify-center pt-2">
                      <Button type="button" variant="secondary" onClick={loadMoreSessions} disabled={loadingSessions}>
                        Load more sessions
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5 md:px-2.5">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 truncate whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-slate-100" title={title ?? value}>{value}</div>
    </div>
  );
}

function ProfileStat({ label, value, title }: { label: string; value: string; title?: string | undefined }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 truncate whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-slate-100" title={title ?? value}>
        {value}
      </div>
    </div>
  );
}

function formatProfileDateTime(value: string | null) {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  }).format(new Date(value));
}

function CompactSessionField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 lg:hidden">{label}</div>
      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={value}>
        {value}
      </div>
    </div>
  );
}

function ParticipantChip({ user, label, onRemove }: { user: ChatAuthor; label?: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-950">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-5 w-5 rounded-full" /> : <span className="h-5 w-5 rounded-full bg-slate-200 dark:bg-slate-800" />}
      <span className="max-w-[220px] truncate">{user.displayName}</span>
      {label ? <span className="text-slate-400">{label}</span> : null}
      {onRemove ? (
        <button type="button" onClick={onRemove} className="rounded text-slate-500 hover:text-red-600" aria-label={`Remove ${user.displayName}`}>
          <X size={13} />
        </button>
      ) : null}
    </span>
  );
}

function getTimeFilterStart(value: TimeFilterValue) {
  const option = TIME_FILTERS.find((filter) => filter.value === value);
  if (!option || !('hours' in option)) return undefined;
  return new Date(Date.now() - option.hours * 60 * 60 * 1000).toISOString();
}

function getNextOrderWindowAnchor(value: TimeFilterValue) {
  const selected = TIME_FILTERS.find((filter) => filter.value === value);
  const hours = selected && 'hours' in selected ? selected.hours : 0;
  const pakistanOffsetMs = 5 * 60 * 60 * 1000;
  const pakistanNow = new Date(Date.now() + pakistanOffsetMs);
  if (hours >= 24) {
    pakistanNow.setUTCHours(24, 0, 0, 0);
  } else if (hours > 0) {
    pakistanNow.setUTCHours(pakistanNow.getUTCHours() + 1, 0, 0, 0);
  }
  return new Date(pakistanNow.getTime() - pakistanOffsetMs).toISOString();
}

function getTimeFilterLabel(value: TimeFilterValue) {
  return TIME_FILTERS.find((filter) => filter.value === value)?.label ?? 'All time';
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

function uniqueAuthors(authors: ChatAuthor[]) {
  const seen = new Set<string>();
  return authors.filter((author) => {
    if (seen.has(author.id)) return false;
    seen.add(author.id);
    return true;
  });
}
