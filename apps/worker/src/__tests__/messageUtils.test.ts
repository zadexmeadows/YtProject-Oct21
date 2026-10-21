import { describe, expect, it } from 'vitest';
import { detectMessageType, parseAmount, stableMessageId } from '../capture/messageUtils';

describe('message utilities', () => {
  it('detects paid messages', () => {
    expect(
      detectMessageType({
        tagName: 'yt-live-chat-paid-message-renderer',
        authorName: 'Ada',
        messageText: 'Great stream',
        amountText: '$10.00',
        badges: []
      }),
    ).toBe('SUPERCHAT');
  });

  it('creates stable fallback IDs', () => {
    const raw = {
      tagName: 'yt-live-chat-text-message-renderer',
      authorName: 'Ada',
      messageText: 'hello',
      timestampText: '12:30',
      badges: []
    };
    expect(stableMessageId('abcDEF_123-', raw)).toBe(stableMessageId('abcDEF_123-', raw));
  });

  it('parses visible Super Chat amounts', () => {
    expect(parseAmount('$10.50')).toEqual({ amount: 10.5, currency: '$' });
    expect(parseAmount('USD 2.00')).toEqual({ amount: 2, currency: 'USD' });
  });
});
