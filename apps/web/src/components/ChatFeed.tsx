'use client';

import { Check, ChevronDown, MessageSquare, Pin, Star, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { PAKISTAN_TIME_ZONE } from '@ytbot/shared';
import {
  formatCalendarDate,
  formatDate,
  formatNumber,
  formatTime,
  pakistanDateKey,
} from '@/lib/format';

export interface ChatFeedMessage {
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
  videoId?: string;
  streamTitle?: string | null;
  stream?: { title?: string | null; videoId?: string | null } | null;
  author?: {
    displayName?: string | null;
    avatarUrl?: string | null;
    authorChannelId?: string | null;
  } | null;
}

interface ChatMessagePart {
  type: 'text' | 'emoji';
  text: string;
  alt?: string | null;
  src?: string | null;
  emojiId?: string | null;
}

interface ChatFeedProps {
  title: string;
  messages: ChatFeedMessage[];
  className?: string;
  bodyClassName?: string;
  compact?: boolean;
  density?: 'normal' | 'tight';
  live?: boolean;
  showHeader?: boolean;
  bodyOverlay?: React.ReactNode;
  rightLabel?: string | undefined;
  emptyText?: string;
  bottomRef?: React.Ref<HTMLDivElement>;
  bodyRef?: React.Ref<HTMLDivElement>;
  onBodyScroll?: React.UIEventHandler<HTMLDivElement> | undefined;
  onMessageClick?: ((message: ChatFeedMessage) => void) | undefined;
  groupByDate?: boolean;
  groupByOrderWindow?: { hours: number; anchor: string } | undefined;
}

const NAME_COLORS = [
  'text-pink-300',
  'text-blue-300',
  'text-orange-300',
  'text-emerald-300',
  'text-violet-300',
  'text-cyan-300',
  'text-rose-300',
  'text-amber-300',
];

export function ChatFeed({
  title,
  messages,
  className,
  bodyClassName,
  compact = false,
  density = 'normal',
  live = false,
  showHeader = true,
  bodyOverlay,
  rightLabel,
  emptyText = 'No messages found',
  bottomRef,
  bodyRef,
  onBodyScroll,
  onMessageClick,
  groupByDate = false,
  groupByOrderWindow,
}: ChatFeedProps) {
  const pinnedMessages = messages.filter(
    (message) => normalizeType(message.messageType) === 'PINNED',
  );
  const normalMessages = messages.filter(
    (message) => normalizeType(message.messageType) !== 'PINNED',
  );
  const featuredPinned = pinnedMessages[0];
  const visibleMessages = featuredPinned
    ? [...pinnedMessages.slice(1), ...normalMessages]
    : normalMessages;
  const tight = density === 'tight';

  return (
    <section
      className={clsx(
        'app-chat-feed relative overflow-hidden rounded-2xl bg-[#070b12] text-slate-100 shadow-[0_18px_50px_rgba(2,6,23,0.26)]',
        className,
      )}
    >
      {showHeader ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/12 text-violet-300">
              <MessageSquare size={18} />
            </span>
            <h2 className="truncate text-lg font-semibold tracking-normal text-white sm:text-xl">
              {title}
            </h2>
            {live ? (
              <span className="inline-flex items-center gap-2 rounded-md bg-red-500/80 px-2.5 py-1 text-[11px] font-semibold uppercase text-white shadow-lg shadow-red-950/30">
                <span className="h-1.5 w-1.5 rounded-full bg-red-200" />
                Live
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-slate-300">
            {rightLabel ? (
              <span className="hidden items-center gap-2 sm:inline-flex">
                <Users size={17} />
                {rightLabel}
              </span>
            ) : null}
            <ChevronDown size={18} className="text-slate-400" />
          </div>
        </div>
      ) : null}

      {bodyOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-10">{bodyOverlay}</div>
      ) : null}

      <div
        ref={bodyRef}
        onScroll={onBodyScroll}
        className={clsx(
          'app-chat-feed-body overflow-y-auto [overflow-anchor:none]',
          tight ? 'space-y-1.5 px-2.5 py-2 sm:px-3' : 'space-y-2 px-3 py-3 sm:px-4',
          !showHeader && (tight ? 'pt-3' : 'pt-4'),
          bodyClassName,
        )}
      >
        {messages.length > 0 && groupByOrderWindow ? (
          <OrderWindowGroupedMessages
            messages={messages}
            compact={compact}
            tight={tight}
            onMessageClick={onMessageClick}
            hours={groupByOrderWindow.hours}
            anchor={groupByOrderWindow.anchor}
          />
        ) : null}
        {messages.length > 0 && groupByDate && !groupByOrderWindow ? (
          <DateGroupedMessages
            messages={messages}
            compact={compact}
            tight={tight}
            onMessageClick={onMessageClick}
          />
        ) : null}
        {messages.length > 0 && !groupByDate && !groupByOrderWindow ? (
          <>
            {featuredPinned ? (
              <PinnedMessage message={featuredPinned} compact={compact} tight={tight} />
            ) : null}
            {visibleMessages.map((message) => (
              <ChatMessageItem
                key={`${message.id}-${message.capturedAt}`}
                message={message}
                compact={compact}
                tight={tight}
                onClick={onMessageClick ? () => onMessageClick(message) : undefined}
              />
            ))}
          </>
        ) : null}
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-slate-400">
            {emptyText}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

function DateGroupedMessages({
  messages,
  compact,
  tight,
  onMessageClick,
}: {
  messages: ChatFeedMessage[];
  compact: boolean;
  tight: boolean;
  onMessageClick?: ((message: ChatFeedMessage) => void) | undefined;
}) {
  const groups = groupMessagesByDate(messages);

  return (
    <div className={clsx(tight ? 'space-y-3' : 'space-y-4')}>
      {groups.map((group) => (
        <section key={group.key} className="space-y-1.5">
          <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0d1320]/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            <span>{group.label}</span>
            <span className="text-slate-500">{formatNumber(group.messages.length)} messages</span>
          </div>
          <div className="space-y-1.5">
            {group.messages.map((message) => (
              <ChatMessageItem
                key={`${message.id}-${message.capturedAt}`}
                message={message}
                compact={compact}
                tight={tight}
                onClick={onMessageClick ? () => onMessageClick(message) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OrderWindowGroupedMessages({
  messages,
  compact,
  tight,
  onMessageClick,
  hours,
  anchor,
}: {
  messages: ChatFeedMessage[];
  compact: boolean;
  tight: boolean;
  onMessageClick?: ((message: ChatFeedMessage) => void) | undefined;
  hours: number;
  anchor: string;
}) {
  const groups = groupMessagesByOrderWindow(messages, hours, anchor);

  return (
    <div className={clsx(tight ? 'space-y-3' : 'space-y-4')}>
      {groups.map((group) => (
        <section key={group.key} className="space-y-1.5">
          <div className="sticky top-0 z-[1] flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-[#0d1320]/95 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 shadow-lg shadow-black/20 backdrop-blur">
            <span>{group.label}</span>
            <span className="text-slate-500">{formatNumber(group.messages.length)} messages</span>
          </div>
          <div className="space-y-1.5">
            {group.messages.map((message) => (
              <ChatMessageItem
                key={`${message.id}-${message.capturedAt}`}
                message={message}
                compact={compact}
                tight={tight}
                onClick={onMessageClick ? () => onMessageClick(message) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PinnedMessage({
  message,
  compact,
  tight,
}: {
  message: ChatFeedMessage;
  compact: boolean;
  tight: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-xl bg-violet-500/10 shadow-inner shadow-violet-950/30',
        tight ? 'px-3 py-2' : 'px-4 py-3',
      )}
    >
      <div
        className={clsx(
          'flex items-center gap-3 font-semibold text-violet-300',
          tight ? 'mb-2 text-xs' : 'mb-3 text-sm',
        )}
      >
        <Pin size={tight ? 15 : 18} />
        Pinned
      </div>
      <ChatMessageItem message={message} compact={compact} tight={tight} pinned />
    </div>
  );
}

function ChatMessageItem({
  message,
  compact,
  tight,
  pinned = false,
  onClick,
}: {
  message: ChatFeedMessage;
  compact: boolean;
  tight: boolean;
  pinned?: boolean;
  onClick?: (() => void) | undefined;
}) {
  const messageType = normalizeType(message.messageType);
  const isSuperChat = messageType === 'SUPERCHAT';
  const Component = onClick ? 'button' : 'div';
  const authorName = message.author?.displayName ?? message.authorName;
  const avatarUrl = message.author?.avatarUrl ?? message.authorAvatarUrl;

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'grid w-full items-start rounded-xl text-left transition',
        tight ? 'grid-cols-[30px_1fr] gap-2.5 px-2 py-1.5' : 'grid-cols-[36px_1fr] gap-3',
        !tight && (compact ? 'px-2.5 py-2' : 'px-3 py-2.5'),
        onClick && 'hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-violet-400/60',
        !pinned && !isSuperChat && 'bg-transparent',
        !pinned && !isSuperChat && onClick && 'hover:shadow-inner',
        isSuperChat &&
          'border border-emerald-400/40 bg-emerald-500/12 shadow-[inset_0_0_28px_rgba(16,185,129,0.10)]',
        pinned && 'px-0 py-0',
      )}
    >
      <Avatar name={authorName} url={avatarUrl} compact={compact} tight={tight} />
      <div className="min-w-0">
        <div
          className={clsx(
            'flex flex-wrap items-center gap-y-0.5',
            tight ? 'gap-x-2' : 'gap-x-3 gap-y-1',
          )}
        >
          <span
            className={clsx(tight ? 'text-xs' : 'text-sm', 'text-slate-400')}
            title={formatDate(message.capturedAt)}
          >
            {formatChatTime(message.capturedAt)}
          </span>
          <span
            className={clsx(
              'min-w-0 truncate font-semibold',
              tight
                ? 'max-w-[8.5rem] text-[13px] sm:max-w-[12rem]'
                : compact
                  ? 'max-w-[8.5rem] text-sm sm:max-w-[11rem]'
                  : 'max-w-[11rem] text-base sm:max-w-[15rem]',
              nameColor(authorName),
            )}
          >
            {authorName}
          </span>
          {message.authorChannelId || message.author?.authorChannelId ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 text-white">
              <Check size={11} strokeWidth={3} />
            </span>
          ) : null}
          <MessageBadges message={message} />
          {isSuperChat ? <SuperChatBadge message={message} /> : null}
        </div>
        <MessageContent
          message={message}
          messageType={messageType}
          compact={compact}
          tight={tight}
        />
        {getStreamLabel(message) ? (
          <div
            className={clsx(
              'truncate text-slate-500',
              tight ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs',
            )}
          >
            {getStreamLabel(message)}
          </div>
        ) : null}
      </div>
    </Component>
  );
}

function MessageContent({
  message,
  messageType,
  compact,
  tight,
}: {
  message: ChatFeedMessage;
  messageType: string;
  compact: boolean;
  tight: boolean;
}) {
  const parts = getMessageParts(message);
  const fallback = message.messageText || systemMessageText(messageType);

  return (
    <p
      className={clsx(
        'break-words text-slate-100 [unicode-bidi:plaintext] whitespace-pre-wrap',
        tight ? 'mt-0.5 text-[13px] leading-snug' : 'mt-1 leading-relaxed',
        !tight && (compact ? 'text-sm' : 'text-[14px]'),
      )}
      dir="auto"
    >
      {parts.length > 0
        ? parts.map((part, index) =>
            part.type === 'emoji' && part.src ? (
              <img
                key={`${part.type}-${index}-${part.src}`}
                src={part.src}
                alt={part.alt ?? part.text}
                title={part.alt ?? part.text}
                className="mx-0.5 inline-block h-[1.35em] w-[1.35em] align-[-0.25em]"
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

function Avatar({
  name,
  url,
  compact,
  tight,
}: {
  name: string;
  url?: string | null | undefined;
  compact: boolean;
  tight: boolean;
}) {
  const size = tight ? 'h-7 w-7' : compact ? 'h-8 w-8' : 'h-9 w-9';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={clsx(size, 'rounded-full object-cover ring-1 ring-white/10')}
      />
    );
  }

  return (
    <span
      className={clsx(
        size,
        'flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-semibold text-white ring-1 ring-white/10',
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function MessageBadges({ message }: { message: ChatFeedMessage }) {
  const type = normalizeType(message.messageType);
  const badges = badgeTypes(message.badges);
  const values = new Set<string>();

  if (type === 'MODERATOR') values.add('MOD');
  if (type === 'OWNER') values.add('OWNER');
  if (type === 'MEMBERSHIP') values.add('MEMBER');
  if (badges.has('moderator')) values.add('MOD');
  if (badges.has('owner')) values.add('OWNER');
  if (badges.has('member')) values.add('MEMBER');

  return (
    <>
      {Array.from(values).map((value) => (
        <span
          key={value}
          className={clsx(
            'rounded-md px-2 py-0.5 text-[11px] font-bold uppercase',
            value === 'MEMBER' && 'bg-emerald-500/20 text-emerald-300',
            value === 'MOD' && 'bg-violet-500/30 text-violet-200',
            value === 'OWNER' && 'bg-amber-400/25 text-amber-200',
          )}
        >
          {value}
        </span>
      ))}
    </>
  );
}

function SuperChatBadge({ message }: { message: ChatFeedMessage }) {
  const amount = message.amount
    ? `${message.currency ?? ''}${formatNumber(message.amount)}`
    : 'Super Chat';
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-0.5 text-xs font-bold text-emerald-300">
      <Star size={13} fill="currentColor" />
      {amount}
    </span>
  );
}

function normalizeType(type: string | null | undefined) {
  return String(type ?? 'NORMAL').toUpperCase();
}

function getMessageParts(message: ChatFeedMessage): ChatMessagePart[] {
  const rawPayload = message.rawPayload;
  if (!rawPayload || typeof rawPayload !== 'object' || !('messageParts' in rawPayload)) {
    return [];
  }

  const parts = (rawPayload as { messageParts?: unknown }).messageParts;
  if (!Array.isArray(parts)) return [];

  return parts
    .map((part): ChatMessagePart | null => {
      if (!part || typeof part !== 'object') return null;
      const candidate = part as Record<string, unknown>;
      const type = candidate.type === 'emoji' ? 'emoji' : 'text';
      const text = typeof candidate.text === 'string' ? candidate.text : '';
      if (!text && type !== 'emoji') return null;

      return {
        type,
        text: text || '[emoji]',
        alt: typeof candidate.alt === 'string' ? candidate.alt : null,
        src: typeof candidate.src === 'string' ? candidate.src : null,
        emojiId: typeof candidate.emojiId === 'string' ? candidate.emojiId : null,
      };
    })
    .filter((part): part is ChatMessagePart => Boolean(part));
}

function formatChatTime(value: string) {
  return formatTime(value);
}

function groupMessagesByDate(messages: ChatFeedMessage[]) {
  const grouped = new Map<
    string,
    { key: string; label: string; sortTime: number; messages: ChatFeedMessage[] }
  >();
  const sortedMessages = [...messages].sort(
    (a, b) => messageTime(a) - messageTime(b) || a.id.localeCompare(b.id),
  );

  for (const message of sortedMessages) {
    const key = pakistanDateKey(message.capturedAt) ?? 'unknown-date';
    const validDate = key !== 'unknown-date';
    const sortTime = validDate ? Number(key.replaceAll('-', '')) : Number.NEGATIVE_INFINITY;
    const label = validDate ? formatMessageDate(message.capturedAt) : 'Unknown date';

    const group = grouped.get(key) ?? { key, label, sortTime, messages: [] };
    group.messages.push(message);
    grouped.set(key, group);
  }

  return Array.from(grouped.values()).sort((a, b) => b.sortTime - a.sortTime);
}

function groupMessagesByOrderWindow(messages: ChatFeedMessage[], hours: number, anchor: string) {
  const windowMs = Math.max(1, hours) * 60 * 60 * 1000;
  const anchorTime = new Date(anchor).getTime();
  const validAnchor = Number.isFinite(anchorTime) ? anchorTime : Date.now();
  const grouped = new Map<number, ChatFeedMessage[]>();

  for (const message of messages) {
    const time = messageTime(message);
    const index = Number.isFinite(time)
      ? Math.max(0, Math.floor(Math.max(0, validAnchor - time) / windowMs))
      : Number.MAX_SAFE_INTEGER;
    const group = grouped.get(index) ?? [];
    group.push(message);
    grouped.set(index, group);
  }

  return Array.from(grouped.entries())
    .sort(([first], [second]) => first - second)
    .map(([index, groupMessages]) => {
      const start = validAnchor - (index + 1) * windowMs;
      const end = validAnchor - index * windowMs;
      const label = formatOrderWindowLabel(start, end, hours);
      return {
        key: String(index),
        label,
        messages: groupMessages.sort((a, b) => messageTime(a) - messageTime(b) || a.id.localeCompare(b.id))
      };
    });
}

function formatOrderWindowLabel(start: number, end: number, hours: number) {
  const inclusiveEnd = end - 1;
  const startDate = pakistanDateKey(new Date(start));
  const endDate = pakistanDateKey(new Date(inclusiveEnd));

  if (hours <= 12) {
    const startTime = formatOrderWindowTime(start);
    const endTime = formatOrderWindowTime(end);
    if (startDate === endDate) return `${startTime} – ${endTime}`;
    return `${formatCalendarDate(new Date(start))} · ${startTime} – ${formatCalendarDate(new Date(inclusiveEnd))} · ${endTime}`;
  }

  const startLabel = formatCalendarDate(new Date(start));
  const endLabel = formatCalendarDate(new Date(inclusiveEnd));
  return startDate === endDate ? startLabel : `${startLabel} – ${endLabel}`;
}

function formatOrderWindowTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  }).format(value);
}

function messageTime(message: ChatFeedMessage) {
  const time = new Date(message.capturedAt).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function formatMessageDate(value: string) {
  return formatCalendarDate(value);
}

function getStreamLabel(message: ChatFeedMessage) {
  return (
    message.stream?.title ?? message.streamTitle ?? message.stream?.videoId ?? message.videoId ?? ''
  );
}

function nameColor(name: string) {
  const hash = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return NAME_COLORS[hash % NAME_COLORS.length];
}

function badgeTypes(rawBadges: unknown) {
  const types = new Set<string>();
  if (!Array.isArray(rawBadges)) return types;

  for (const badge of rawBadges) {
    if (badge && typeof badge === 'object' && 'type' in badge) {
      const type = String((badge as { type?: unknown }).type ?? '').toLowerCase();
      if (type) types.add(type);
    }
  }

  return types;
}

function systemMessageText(type: string) {
  return type === 'SYSTEM' ? 'System message' : '';
}
