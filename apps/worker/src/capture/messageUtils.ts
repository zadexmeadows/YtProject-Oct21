import crypto from 'node:crypto';
import type { MessageType } from '@ytbot/shared';
import type { ExcludedChatUser } from '../lib/settings';

export interface RawDomMessage {
  domId?: string | null;
  tagName: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  rawAuthorUrl?: string | null;
  messageText: string;
  messageParts?: Array<{
    type: 'text' | 'emoji';
    text: string;
    alt?: string | null;
    src?: string | null;
    emojiId?: string | null;
  }>;
  timestampText?: string | null;
  badges: Array<{ type?: string; label?: string; text?: string }>;
  amountText?: string | null;
}

export function isExcludedAuthor(authorName: string, authorChannelId: string | null | undefined, excludedUsers: ExcludedChatUser[]): boolean {
  const normalizedAuthorName = authorName.trim().toLowerCase();
  return excludedUsers.some((user) => {
    if (!user.authorId) return user.displayName.trim().toLowerCase() === normalizedAuthorName;
    if (authorChannelId) return user.authorChannelId === authorChannelId;
    return !user.authorChannelId && user.displayName.trim().toLowerCase() === normalizedAuthorName;
  });
}

export function stableMessageId(videoId: string, raw: RawDomMessage): string {
  if (raw.domId && raw.domId.length > 6) {
    return raw.domId;
  }

  const hash = crypto
    .createHash('sha256')
    .update([videoId, raw.tagName, raw.authorName, raw.messageText, raw.timestampText ?? ''].join('|'))
    .digest('hex')
    .slice(0, 32);

  return `dom-${hash}`;
}

export function detectMessageType(raw: RawDomMessage): MessageType {
  const tag = raw.tagName.toLowerCase();
  const badgeTypes = raw.badges.map((badge) => String(badge.type ?? badge.label ?? '').toLowerCase());

  if (tag.includes('paid') || raw.amountText) return 'SUPERCHAT';
  if (tag.includes('membership')) return 'MEMBERSHIP';
  if (tag.includes('banner')) return 'PINNED';
  if (tag.includes('viewer-engagement')) return 'SYSTEM';
  if (badgeTypes.some((badge) => badge.includes('owner'))) return 'OWNER';
  if (badgeTypes.some((badge) => badge.includes('moderator'))) return 'MODERATOR';
  return 'NORMAL';
}

export function parseAmount(amountText?: string | null): { amount?: number; currency?: string } {
  if (!amountText) return {};
  const trimmed = amountText.trim();
  const numeric = trimmed.match(/[0-9]+(?:[.,][0-9]+)?/)?.[0]?.replace(',', '.');
  const amount = numeric ? Number(numeric) : undefined;
  const currency =
    trimmed.match(/[A-Z]{3}/)?.[0] ??
    trimmed.match(/^[^\d\s]+/)?.[0] ??
    trimmed.match(/[^\d\s]+$/)?.[0];
  const result: { amount?: number; currency?: string } = {};
  if (typeof amount === 'number' && Number.isFinite(amount)) result.amount = amount;
  if (currency) result.currency = currency;
  return result;
}

export function parseTimestamp(timestampText?: string | null): Date | null {
  if (!timestampText) return null;
  const now = new Date();
  const parts = timestampText
    .trim()
    .split(':')
    .map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const date = new Date(now);
  if (parts.length === 2) {
    date.setHours(now.getHours(), parts[0] ?? 0, parts[1] ?? 0, 0);
    return date;
  }

  if (parts.length === 3) {
    date.setHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
    return date;
  }

  return null;
}
