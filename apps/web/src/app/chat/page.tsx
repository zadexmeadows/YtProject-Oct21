'use client';

import { FormEvent, UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  BadgeCheck,
  Clock3,
  ExternalLink,
  Link2Off,
  MessageCircle,
  Pause,
  Play,
  Search,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/DashboardShell';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { useRealtime } from '@/components/RealtimeProvider';
import { ChatFeed } from '@/components/ChatFeed';
import { formatDate, formatTime, parsePakistanDateTimeInput } from '@/lib/format';

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

interface ChatAuthor {
  id: string;
  displayName: string;
  authorChannelId: string | null;
  avatarUrl: string | null;
  _count?: { messages: number };
}

interface MessagePart {
  type: 'text' | 'emoji';
  text: string;
  alt?: string | null;
  src?: string | null;
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [selected, setSelected] = useState<MessageRow | null>(null);
  const [livePaused, setLivePaused] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [unseenMessages, setUnseenMessages] = useState(0);
  const [selectedStreamId, setSelectedStreamId] = useState('');
  const [selectedAuthors, setSelectedAuthors] = useState<ChatAuthor[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<ChatAuthor[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [extractFilters, setExtractFilters] = useState({
    streamId: '',
    from: '',
    to: '',
  });
  const [extractError, setExtractError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const followFrameRef = useRef<number | null>(null);
  const selectedAuthorIds = useMemo(
    () => new Set(selectedAuthors.map((author) => author.id)),
    [selectedAuthors],
  );
  const selectedAuthorFilters = useMemo(
    () =>
      selectedAuthors.map((author) => ({
        channelId: author.authorChannelId,
        nameKey: normalizeAuthorName(author.displayName),
      })),
    [selectedAuthors],
  );

  const messageMatchesSelectedAuthors = useCallback(
    (message: MessageRow) => {
      if (selectedAuthorFilters.length === 0) return true;

      const messageName = normalizeAuthorName(message.authorName);
      return selectedAuthorFilters.some((author) => {
        if (
          author.channelId &&
          message.authorChannelId &&
          author.channelId === message.authorChannelId
        ) {
          return true;
        }

        return author.nameKey === messageName;
      });
    },
    [selectedAuthorFilters],
  );

  const visibleMessages = useMemo(
    () => messages.filter((message) => messageMatchesSelectedAuthors(message)),
    [messageMatchesSelectedAuthors, messages],
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedStreamId) params.set('streamId', selectedStreamId);
    params.set('pageSize', '200');
    const data = await apiFetch<{ messages: MessageRow[] }>(`/messages?${params}`);
    setMessages(data.messages.reverse());
  }, [selectedStreamId]);

  useEffect(() => {
    void apiFetch<{ streams: StreamRow[] }>('/streams').then((data) => setStreams(data.streams));
  }, []);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setUnseenMessages(0);
    void load();
  }, [load]);

  useEffect(() => {
    const query = userQuery.trim();
    if (query.length < 2) {
      setUserResults([]);
      setUserSearchLoading(false);
      return;
    }

    setUserSearchLoading(true);
    const timeout = window.setTimeout(() => {
      void apiFetch<{ users: ChatAuthor[] }>(`/users/search?q=${encodeURIComponent(query)}`)
        .then((data) => setUserResults(data.users))
        .catch(() => setUserResults([]))
        .finally(() => setUserSearchLoading(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [userQuery]);

  useRealtime(
    useCallback(
      (event) => {
        if (event.type === 'stream.status') {
          const data = JSON.parse(event.data) as {
            payload: {
              streamId: string;
              title?: string | null;
            };
          };

          if ('title' in data.payload) {
            setStreams((current) =>
              current.map((stream) =>
                stream.id === data.payload.streamId
                  ? { ...stream, title: data.payload.title ?? null }
                  : stream,
              ),
            );
            setMessages((current) =>
              current.map((message) =>
                message.streamId === data.payload.streamId
                  ? { ...message, streamTitle: data.payload.title ?? null }
                  : message,
              ),
            );
            setSelected((current) =>
              current && current.streamId === data.payload.streamId
                ? { ...current, streamTitle: data.payload.title ?? null }
                : current,
            );
          }
          return;
        }

        if (event.type !== 'chat.message' || livePaused) return;
        const data = JSON.parse(event.data) as {
          payload: MessageRow;
        };
        const message = data.payload as MessageRow;
        if (selectedStreamId && message.streamId !== selectedStreamId) return;

        setMessages((current) => [...current.slice(-249), message]);
        if (!stickToBottomRef.current && messageMatchesSelectedAuthors(message)) {
          setUnseenMessages((count) => count + 1);
        }
      },
      [livePaused, messageMatchesSelectedAuthors, selectedStreamId],
    ),
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = feedScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const scheduleBottomFollow = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
      }
      followFrameRef.current = window.requestAnimationFrame(() => {
        followFrameRef.current = null;
        scrollToBottom(behavior);
      });
    },
    [scrollToBottom],
  );

  const handleFeedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
    const scrollingUp = element.scrollTop < lastScrollTopRef.current - 6;
    lastScrollTopRef.current = element.scrollTop;

    if (nearBottom) {
      stickToBottomRef.current = true;
      setShowJumpToLatest(false);
      setUnseenMessages(0);
      return;
    }

    if (scrollingUp) {
      stickToBottomRef.current = false;
      setShowJumpToLatest(true);
    }
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scheduleBottomFollow('smooth');
  }, [scheduleBottomFollow, visibleMessages]);

  useEffect(() => {
    return () => {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
      }
    };
  }, []);

  const followLatest = () => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setUnseenMessages(0);
    scheduleBottomFollow('smooth');
  };

  const toggleDisplayPause = () => {
    setLivePaused((paused) => {
      const nextPaused = !paused;
      if (paused) {
        void load().then(() => {
          if (stickToBottomRef.current) {
            window.requestAnimationFrame(() => scrollToBottom('smooth'));
          }
        });
      }
      return nextPaused;
    });
  };

  function addSelectedAuthor(author: ChatAuthor) {
    if (selectedAuthorIds.has(author.id)) return;
    setSelectedAuthors((current) => [...current, author]);
    setUserQuery('');
    setUserResults([]);
  }

  function removeSelectedAuthor(authorId: string) {
    setSelectedAuthors((current) => current.filter((author) => author.id !== authorId));
  }

  function clearSelectedAuthors() {
    setSelectedAuthors([]);
  }

  function openPastExtract(event: FormEvent) {
    event.preventDefault();
    setExtractError('');

    if (!extractFilters.from || !extractFilters.to) {
      setExtractError('Choose both start and end time.');
      return;
    }

    const from = parsePakistanDateTimeInput(extractFilters.from);
    const to = parsePakistanDateTimeInput(extractFilters.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      setExtractError('Choose a valid time range.');
      return;
    }

    if (from.getTime() > to.getTime()) {
      setExtractError('Start time must be before end time.');
      return;
    }

    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (extractFilters.streamId) params.set('streamId', extractFilters.streamId);
    router.push(`/chat/history?${params.toString()}`);
  }

  return (
    <DashboardShell hideHeader mainClassName="max-w-none px-3 py-3 sm:px-4 lg:px-5">
      <div className="app-live-chat-page grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ChatFeed
          title="Live Chat"
          live={!livePaused}
          showHeader={false}
          compact
          density="tight"
          messages={visibleMessages}
          onMessageClick={(message) => setSelected(message as MessageRow)}
          bottomRef={bottomRef}
          bodyRef={feedScrollRef}
          onBodyScroll={handleFeedScroll}
          className="app-live-chat-feed h-[calc(100vh-1.5rem)] min-h-[620px] rounded-xl"
          bodyClassName="h-full px-3 py-3 pb-16 pr-12 sm:px-4"
          rightLabel={`${visibleMessages.length} shown`}
          emptyText={
            selectedAuthors.length > 0
              ? 'No live messages from selected users yet'
              : 'No messages found'
          }
          bodyOverlay={
            <>
              <button
                type="button"
                aria-label={livePaused ? 'Resume visible feed' : 'Pause visible feed'}
                title={livePaused ? 'Resume visible feed' : 'Pause visible feed'}
                onClick={toggleDisplayPause}
                className="pointer-events-auto absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-slate-200 shadow-lg shadow-black/30 backdrop-blur transition hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {livePaused ? <Play size={16} /> : <Pause size={16} />}
              </button>
              {showJumpToLatest ? (
                <button
                  type="button"
                  onClick={followLatest}
                  className="pointer-events-auto absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-blue-400/30 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/40 transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300"
                >
                  <ArrowDown size={14} />
                  {unseenMessages > 0 ? `${unseenMessages} new` : 'Latest'}
                </button>
              ) : null}
            </>
          }
        />

        <div className="app-live-chat-controls space-y-4 xl:sticky xl:top-3 xl:max-h-[calc(100vh-1.5rem)] xl:overflow-y-auto xl:pr-1">
          <Panel className="overflow-hidden border-blue-500/20 bg-blue-50/60 dark:bg-blue-950/20">
            <PanelHeader
              title="Past Chat Extract"
              action={
                <span className="inline-flex items-center gap-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                  <Archive size={14} />
                  Timeline
                </span>
              }
            />
            <form className="grid gap-3 p-4" onSubmit={openPastExtract}>
              <select
                value={extractFilters.streamId}
                onChange={(event) =>
                  setExtractFilters((current) => ({ ...current, streamId: event.target.value }))
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">All streams</option>
                {streams.map((stream) => (
                  <option key={stream.id} value={stream.id}>
                    {stream.title ?? stream.videoId}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={extractFilters.from}
                aria-label="Start time (Pakistan Standard Time)"
                onChange={(event) =>
                  setExtractFilters((current) => ({ ...current, from: event.target.value }))
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="datetime-local"
                value={extractFilters.to}
                aria-label="End time (Pakistan Standard Time)"
                onChange={(event) =>
                  setExtractFilters((current) => ({ ...current, to: event.target.value }))
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <Button type="submit" className="h-10 whitespace-nowrap">
                <ExternalLink size={16} />
                Open Extract
              </Button>
              {extractError ? (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
                  {extractError}
                </div>
              ) : null}
            </form>
          </Panel>

          <Panel>
            <PanelHeader title="Display Filters" />
            <div className="grid gap-4 p-4">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Stream
                </span>
                <select
                  value={selectedStreamId}
                  onChange={(event) => setSelectedStreamId(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">All streams</option>
                  {streams.map((stream) => (
                    <option key={stream.id} value={stream.id}>
                      {stream.title ?? stream.videoId}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Users
                  </span>
                  {selectedAuthors.length > 0 ? (
                    <button
                      type="button"
                      onClick={clearSelectedAuthors}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-300"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                    placeholder="Search users to add"
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>

                {userQuery.trim().length >= 2 ? (
                  <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950">
                    {userSearchLoading ? (
                      <div className="px-3 py-2 text-sm text-slate-500">Searching users...</div>
                    ) : userResults.length > 0 ? (
                      userResults.map((author) => (
                        <button
                          key={author.id}
                          type="button"
                          disabled={selectedAuthorIds.has(author.id)}
                          onClick={() => addSelectedAuthor(author)}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-900"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <SmallAuthorAvatar author={author} />
                            <span className="truncate font-medium">{author.displayName}</span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {author._count?.messages ?? 0} messages
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-slate-500">
                        No matching users found.
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {selectedAuthors.length === 0 ? (
                    <span className="inline-flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 dark:border-slate-700">
                      <UserPlus size={14} />
                      All users are visible
                    </span>
                  ) : (
                    selectedAuthors.map((author) => (
                      <span
                        key={author.id}
                        className="inline-flex max-w-full items-center gap-2 rounded-md bg-blue-50 px-2 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-950/70 dark:text-blue-200"
                      >
                        <SmallAuthorAvatar author={author} size="sm" />
                        <span className="truncate">{author.displayName}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${author.displayName}`}
                          onClick={() => removeSelectedAuthor(author.id)}
                          className="rounded-full p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {selected ? <MessageInspector message={selected} onClose={() => setSelected(null)} /> : null}
    </DashboardShell>
  );
}

function SmallAuthorAvatar({ author, size = 'md' }: { author: ChatAuthor; size?: 'sm' | 'md' }) {
  const className = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  if (author.avatarUrl) {
    return (
      <img
        src={author.avatarUrl}
        alt=""
        className={`${className} rounded-full object-cover ring-1 ring-white/10`}
      />
    );
  }

  return (
    <span
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white`}
    >
      {Array.from(author.displayName.replace(/^@/, '').trim())[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function normalizeAuthorName(value: string) {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function MessageInspector({ message, onClose }: { message: MessageRow; onClose: () => void }) {
  const channelUrl = getPublicChannelUrl(message);
  const badges = getVisibleBadges(message);
  const streamLabel = message.streamTitle ?? message.videoId;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-slate-800 bg-[#070b12] text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
        <div>
          <h2 className="text-base font-semibold">Message Inspector</h2>
          <p className="text-xs text-slate-400">Clean view of the selected chat message</p>
        </div>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 text-slate-200 hover:bg-white/10"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>

      <div className="h-[calc(100%-4rem)] space-y-4 overflow-y-auto p-4 sm:p-5">
        <InspectorSection icon={<UserRound size={17} />} title="User">
          <div className="flex items-start gap-4">
            <Avatar name={message.authorName} url={message.authorAvatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Channel Username
              </div>
              <div className="mt-1 break-words text-lg font-semibold text-white">
                {message.authorName}
              </div>
              {message.authorChannelId ? (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-500/12 px-2.5 py-1 text-xs font-medium text-blue-200">
                  <BadgeCheck size={13} />
                  Public channel detected
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Badges
            </div>
            {badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-md bg-violet-500/20 px-2.5 py-1 text-xs font-semibold text-violet-100"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400">No public badges visible.</div>
            )}
          </div>
        </InspectorSection>

        <InspectorSection icon={<MessageCircle size={17} />} title="Message">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-lg leading-relaxed text-white shadow-inner shadow-black/20">
            <MessageBubble message={message} />
          </div>
        </InspectorSection>

        <InspectorSection icon={<Clock3 size={17} />} title="Message Information">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoTile
              label="Message Time"
              value={formatMessageTime(message.capturedAt)}
              helper={formatDate(message.capturedAt)}
            />
            <InfoTile label="Message Type" value={friendlyMessageType(message)} />
            <InfoTile
              label="Stream"
              value={streamLabel}
              helper={message.streamTitle ? message.videoId : undefined}
              wide
            />
          </div>
        </InspectorSection>

        <InspectorSection title="Channel">
          {channelUrl ? (
            <a
              href={channelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <ExternalLink size={16} />
              Open YouTube Channel
            </a>
          ) : (
            <div>
              <button
                type="button"
                disabled
                className="inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-slate-500"
              >
                <Link2Off size={16} />
                Open YouTube Channel
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">Channel link unavailable.</p>
            </div>
          )}
        </InspectorSection>
      </div>
    </aside>
  );
}

function InspectorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.22)]">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-100">
        {icon ? <span className="text-blue-300">{icon}</span> : null}
        {title}
      </div>
      {children}
    </section>
  );
}

function InfoTile({
  label,
  value,
  helper,
  wide = false,
}: {
  label: string;
  value: string;
  helper?: string | undefined;
  wide?: boolean;
}) {
  return (
    <div
      className={clsx('rounded-xl border border-white/10 bg-black/20 p-3', wide && 'sm:col-span-2')}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-100">{value}</div>
      {helper ? <div className="mt-1 break-words text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <img src={url} alt="" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10" />
    );
  }

  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-xl font-semibold text-white ring-1 ring-white/10">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  const parts = getMessageParts(message);
  const fallback = message.messageText || systemMessageText(message.messageType);

  return (
    <p className="whitespace-pre-wrap break-words [unicode-bidi:plaintext]" dir="auto">
      {parts.length > 0
        ? parts.map((part, index) =>
            part.type === 'emoji' && part.src ? (
              <img
                key={`${part.type}-${index}-${part.src}`}
                src={part.src}
                alt={part.alt ?? part.text}
                title={part.alt ?? part.text}
                className="mx-0.5 inline-block h-[1.45em] w-[1.45em] align-[-0.25em]"
                loading="lazy"
              />
            ) : (
              <span key={`${part.type}-${index}`}>{part.text}</span>
            ),
          )
        : fallback}
    </p>
  );
}

function getMessageParts(message: MessageRow): MessagePart[] {
  if (!isRecord(message.rawPayload)) return [];
  const parts = message.rawPayload.messageParts;
  if (!Array.isArray(parts)) return [];

  return parts
    .map((part): MessagePart | null => {
      if (!isRecord(part)) return null;
      const type = part.type === 'emoji' ? 'emoji' : 'text';
      const text = typeof part.text === 'string' ? part.text : '';
      if (!text && type !== 'emoji') return null;

      return {
        type,
        text: text || '[emoji]',
        alt: typeof part.alt === 'string' ? part.alt : null,
        src: typeof part.src === 'string' ? part.src : null,
      };
    })
    .filter((part): part is MessagePart => Boolean(part));
}

function getVisibleBadges(message: MessageRow) {
  if (!Array.isArray(message.badges)) return [];
  const labels = new Set<string>();

  for (const badge of message.badges) {
    if (!isRecord(badge)) continue;
    const label = typeof badge.label === 'string' && badge.label.trim() ? badge.label.trim() : null;
    const type = typeof badge.type === 'string' && badge.type.trim() ? badge.type.trim() : null;
    if (label) labels.add(label);
    else if (type) labels.add(type.charAt(0).toUpperCase() + type.slice(1));
  }

  return Array.from(labels);
}

function getPublicChannelUrl(message: MessageRow) {
  if (!isRecord(message.rawPayload)) return youtubeHandleUrl(message.authorName);
  const rawAuthorUrl = message.rawPayload.rawAuthorUrl;
  if (typeof rawAuthorUrl !== 'string' || !rawAuthorUrl.trim())
    return youtubeHandleUrl(message.authorName);

  try {
    const parsed = new URL(rawAuthorUrl, 'https://www.youtube.com');
    const host = parsed.hostname.replace(/^www\./, '');
    const isYoutube = host === 'youtube.com' || host === 'm.youtube.com';
    const isChannelPath =
      parsed.pathname.startsWith('/channel/') ||
      parsed.pathname.startsWith('/@') ||
      parsed.pathname.startsWith('/c/') ||
      parsed.pathname.startsWith('/user/');

    if (!isYoutube || !isChannelPath) return youtubeHandleUrl(message.authorName);
    return `https://www.youtube.com${parsed.pathname}`;
  } catch {
    return youtubeHandleUrl(message.authorName);
  }
}

function youtubeHandleUrl(authorName: string) {
  const handle = authorName.trim().replace(/^@+/, '');
  if (!handle) return null;
  return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
}

function friendlyMessageType(message: MessageRow) {
  const type = message.messageType.toUpperCase();
  if (type === 'SUPERCHAT')
    return message.amount
      ? `Super Chat (${message.currency ?? ''}${message.amount})`
      : 'Super Chat';
  if (type === 'MEMBERSHIP') return 'Membership';
  if (type === 'PINNED') return 'Pinned';
  if (type === 'MODERATOR') return 'Moderator';
  if (type === 'OWNER') return 'Owner';
  if (type === 'SYSTEM') return 'System';

  const parts = getMessageParts(message);
  if (parts.length > 0 && parts.every((part) => part.type === 'emoji')) return 'Emoji';
  return 'Text';
}

function formatMessageTime(value: string) {
  return formatTime(value);
}

function systemMessageText(type: string) {
  return type.toUpperCase() === 'SYSTEM' ? 'System message' : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
