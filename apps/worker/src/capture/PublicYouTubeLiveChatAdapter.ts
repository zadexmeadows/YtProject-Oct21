import { chromium, type Browser, type Page } from 'playwright';
import type {
  CapturedChatMessage,
  CaptureContext,
  CaptureHandlers,
  CaptureMetadata,
  ChatCaptureAdapter
} from './types';
import {
  detectMessageType,
  parseAmount,
  parseTimestamp,
  stableMessageId,
  type RawDomMessage
} from './messageUtils';
import { env } from '../lib/env';

const STALE_VISIBLE_MESSAGES_RELOAD_MS = 120_000;
const LIVE_CHAT_FILTER_REFRESH_MS = 15_000;
const LIVE_CHAT_FILTER_ATTEMPTS = 5;
const LIVE_CHAT_FILTER_RETRY_MS = 1_200;
const YOUTUBE_LANGUAGE = 'en-US';
const YOUTUBE_REGION = 'US';
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

type ChatFilterState = {
  selectedMode: 'top' | 'live' | null;
  selectedLabel: string | null;
  hasSelector: boolean;
  labels: string[];
};

export class PublicYouTubeLiveChatAdapter implements ChatCaptureAdapter {
  name = 'public-youtube-live-chat';

  async fetchMetadata(videoId: string): Promise<CaptureMetadata> {
    const response = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=${YOUTUBE_REGION}`,
      {
        headers: {
          'accept-language': `${YOUTUBE_LANGUAGE},en;q=0.9`,
          'user-agent':
            'Mozilla/5.0 (compatible; YTLiveChatIntelligence/1.0; +https://localhost)'
        }
      },
    );

    if (!response.ok) {
      return {
        liveChatUrl: this.chatUrl(videoId)
      };
    }

    const html = await response.text();
    const title = decodeHtml(
      html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ??
        html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
        '',
    )
      .replace(/\s+-\s+YouTube$/i, '')
      .trim();
    const channelId =
      html.match(/"externalChannelId"\s*:\s*"(UC[\w-]+)"/)?.[1] ??
      html.match(/<link[^>]+itemprop="channelId"[^>]+content="(UC[\w-]+)"/i)?.[1] ??
      html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/)?.[1] ??
      null;

    return {
      title: title || null,
      channelId,
      liveChatUrl: this.chatUrl(videoId)
    };
  }

  async findReplacementVideoId(channelId: string, currentVideoId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live?hl=en&gl=${YOUTUBE_REGION}`,
        {
          headers: {
            'accept-language': `${YOUTUBE_LANGUAGE},en;q=0.9`,
            'user-agent': DESKTOP_USER_AGENT
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(20_000)
        }
      );
      if (!response.ok) return null;
      const html = await response.text();
      const redirectedUrl = new URL(response.url);
      const candidate =
        redirectedUrl.searchParams.get('v') ??
        redirectedUrl.pathname.match(/\/(?:live|embed)\/([\w-]{11})/)?.[1] ??
        null;
      const appearsLiveNow =
        /"isLiveNow"\s*:\s*true/i.test(html) ||
        /"badgeStyle"\s*:\s*"BADGE_STYLE_TYPE_LIVE_NOW"/i.test(html) ||
        /LIVE_NOW/.test(html);
      if (!candidate || candidate === currentVideoId || !appearsLiveNow) return null;

      const metadata = await this.fetchMetadata(candidate);
      return metadata.channelId === channelId ? candidate : null;
    } catch {
      return null;
    }
  }

  async capture(context: CaptureContext, handlers: CaptureHandlers): Promise<void> {
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      browser = await chromium.launch({
        headless: env.HEADLESS_BROWSER,
        args: ['--disable-dev-shm-usage', '--no-sandbox']
      });
      page = await browser.newPage({
        extraHTTPHeaders: {
          'Accept-Language': `${YOUTUBE_LANGUAGE},en;q=0.9`
        },
        locale: YOUTUBE_LANGUAGE,
        viewport: { width: 420, height: 760 },
        userAgent: DESKTOP_USER_AGENT
      });

      const metadata = await this.fetchMetadata(context.videoId);
      await handlers.onMetadata(metadata);
      await handlers.onLog('info', 'Opening public YouTube live chat popout', {
        adapter: this.name,
        liveChatUrl: metadata.liveChatUrl
      });

      await openChatPage(page, metadata.liveChatUrl ?? this.chatUrl(context.videoId));
      let liveChatFilterConfirmed = await prepareChatForCapture(page, handlers.onLog);
      let lastFilterCheckAt = Date.now();

      let consecutiveUnavailable = 0;
      let lastVisibleSignature = '';
      let lastVisibleChangedAt = Date.now();
      while (!context.signal.aborted) {
        const state = await inspectChatPage(page);

        if (state.ended) {
          await handlers.onEnded(state.reason ?? 'Live chat appears to have ended.');
          return;
        }

        if (state.unavailable) {
          consecutiveUnavailable += 1;
          await handlers.onLog('warn', state.reason ?? 'Live chat is temporarily unavailable.', {
            consecutiveUnavailable
          });
          if (consecutiveUnavailable >= 3) {
            await handlers.onEnded(state.reason ?? 'Live chat remained unavailable; capture appears paused.');
            return;
          }
        } else {
          consecutiveUnavailable = 0;
        }

        if (!liveChatFilterConfirmed && Date.now() - lastFilterCheckAt > LIVE_CHAT_FILTER_REFRESH_MS) {
          liveChatFilterConfirmed = await ensureLiveChatFilter(page, handlers.onLog);
          lastFilterCheckAt = Date.now();
        }

        const rawMessages = await readVisibleMessages(page);
        const visibleSignature = rawMessages
          .slice(-8)
          .map((raw) => stableMessageId(context.videoId, raw))
          .join('|');

        if (visibleSignature && visibleSignature !== lastVisibleSignature) {
          lastVisibleSignature = visibleSignature;
          lastVisibleChangedAt = Date.now();
        } else if (
          visibleSignature &&
          Date.now() - lastVisibleChangedAt > STALE_VISIBLE_MESSAGES_RELOAD_MS
        ) {
          await handlers.onLog('warn', 'Live chat page appears stale; reloading public chat popout.', {
            staleForMs: Date.now() - lastVisibleChangedAt
          });
          await reloadChatPage(page);
          liveChatFilterConfirmed = await prepareChatForCapture(page, handlers.onLog);
          lastFilterCheckAt = Date.now();
          lastVisibleSignature = '';
          lastVisibleChangedAt = Date.now();
          continue;
        }

        for (const raw of rawMessages) {
          const message = this.toCapturedMessage(context.videoId, raw);
          if (message.authorName || message.messageText) {
            await handlers.onMessage(message);
          }
        }

        await keepChatAtLiveEdge(page);
        await page.waitForTimeout(context.captureSpeedMs);
      }
    } finally {
      await page?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
    }
  }

  private chatUrl(videoId: string) {
    const params = new URLSearchParams({
      is_popout: '1',
      v: videoId,
      hl: 'en',
      gl: YOUTUBE_REGION,
      persist_hl: '1'
    });
    return `https://www.youtube.com/live_chat?${params.toString()}`;
  }

  private toCapturedMessage(videoId: string, raw: RawDomMessage): CapturedChatMessage {
    const { amount, currency } = parseAmount(raw.amountText);
    const messageType = detectMessageType(raw);
    const authorChannelId =
      raw.rawAuthorUrl?.match(/\/channel\/([^/?]+)/)?.[1] ??
      raw.rawAuthorUrl?.match(/\/@([^/?]+)/)?.[1] ??
      null;

    return {
      messageId: stableMessageId(videoId, raw),
      videoId,
      authorChannelId,
      authorName: raw.authorName || 'System',
      authorAvatarUrl: raw.authorAvatarUrl ?? null,
      messageText: raw.messageText,
      messageType,
      badges: raw.badges,
      amount: amount ?? null,
      currency: currency ?? null,
      originalTimestamp: parseTimestamp(raw.timestampText),
      rawPayload: {
        adapter: this.name,
        ...raw
      }
    };
  }
}

async function openChatPage(page: Page, url: string) {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
  } catch (error) {
    const reachedChatPage = page.url().includes('/live_chat');
    if (!reachedChatPage) throw error;
  }

  await page.waitForTimeout(2000);
}

async function reloadChatPage(page: Page) {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (error) {
    const reachedChatPage = page.url().includes('/live_chat');
    if (!reachedChatPage) throw error;
  }

  await page.waitForTimeout(2000);
}

async function prepareChatForCapture(page: Page, onLog: CaptureHandlers['onLog']) {
  await dismissConsentIfVisible(page);

  const initialState = await inspectChatPage(page);
  let liveChatFilterConfirmed = false;
  if (!initialState.ended && !initialState.unavailable) {
    liveChatFilterConfirmed = await ensureLiveChatFilter(page, onLog);
  }

  await keepChatAtLiveEdge(page);
  return liveChatFilterConfirmed;
}

async function keepChatAtLiveEdge(page: Page) {
  await page
    .evaluate(`
      (() => {
        const candidates = [
          document.querySelector('#item-scroller'),
          document.querySelector('#items'),
          document.scrollingElement
        ].filter(Boolean);

        for (const element of candidates) {
          element.scrollTop = element.scrollHeight;
        }
      })()
    `)
    .catch(() => undefined);
}

async function dismissConsentIfVisible(page: Page) {
  const buttons = page.locator('button');
  const count = await buttons.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 12); index += 1) {
    const button = buttons.nth(index);
    const text = (await button.textContent().catch(() => ''))?.toLowerCase() ?? '';
    if (text.includes('accept') || text.includes('agree')) {
      await button.click({ timeout: 1000 }).catch(() => undefined);
      return;
    }
  }
}

async function ensureLiveChatFilter(page: Page, onLog: CaptureHandlers['onLog']): Promise<boolean> {
  let lastState: ChatFilterState = {
    selectedMode: null,
    selectedLabel: null,
    hasSelector: false,
    labels: []
  };
  let attemptedSwitch = false;

  for (let attempt = 1; attempt <= LIVE_CHAT_FILTER_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await page.waitForTimeout(LIVE_CHAT_FILTER_RETRY_MS);
    }

    lastState = await inspectChatFilter(page);

    if (lastState.selectedMode === 'live') {
      await onLog('info', 'Confirmed YouTube chat filter is Live chat.', {
        selectedLabel: lastState.selectedLabel,
        changed: attemptedSwitch
      });
      return true;
    }

    if (lastState.selectedMode === 'top' || lastState.hasSelector) {
      attemptedSwitch = true;
      await onLog('info', 'Switching YouTube chat filter from Top chat to Live chat.', {
        selectedMode: lastState.selectedMode,
        selectedLabel: lastState.selectedLabel,
        labels: lastState.labels
      });

      const switched = await selectLiveChatFilter(page);
      if (!switched) {
        await onLog('warn', 'Could not click YouTube Live chat filter option; retrying.', {
          selectedLabel: lastState.selectedLabel,
          labels: lastState.labels
        });
      }
    }
  }

  const detectedTopChat =
    lastState.selectedMode === 'top' ||
    lastState.labels.some((label) => classifyKnownChatFilterLabel(label) === 'top');
  if (detectedTopChat) {
    throw new Error(
      `Could not switch YouTube chat filter from Top chat to Live chat before capture. Detected labels: ${
        lastState.labels.length > 0 ? lastState.labels.join(', ') : 'none'
      }`,
    );
  }

  await onLog('warn', 'Could not confirm YouTube Live chat filter because the filter selector is not exposed yet.', {
    labels: lastState.labels
  });
  return false;
}

function classifyKnownChatFilterLabel(value: string): 'top' | 'live' | null {
  const meaningful = value.replace(/\s+/g, ' ').trim().split(':').pop()?.trim() ?? '';
  const lower = meaningful.toLowerCase();
  const hasEnglishTop = lower.includes('top chat');
  const hasEnglishLive = lower.includes('live chat');
  const hasUrduTop =
    meaningful.includes('\u0679\u0627\u067e') && meaningful.includes('\u0686\u06cc\u0679');
  const hasUrduLive =
    meaningful.includes('\u0644\u0627\u0626\u06cc\u0648') &&
    meaningful.includes('\u0686\u06cc\u0679');
  const hasTop = hasEnglishTop || hasUrduTop;
  const hasLive = hasEnglishLive || hasUrduLive;
  if (hasTop && !hasLive) return 'top';
  if (hasLive && !hasTop) return 'live';
  return null;
}

async function inspectChatFilter(page: Page): Promise<ChatFilterState> {
  return page.evaluate<ChatFilterState>(`
    (() => {
      const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
      const classifyChatFilterLabel = (value) => {
        const normalized = normalize(value);
        if (!normalized) return null;
        const meaningful = normalize(normalized.split(':').pop());
        const lower = meaningful.toLowerCase();
        const hasEnglishTop = lower.includes('top chat');
        const hasEnglishLive = lower.includes('live chat');
        const hasUrduTop = meaningful.includes('\\u0679\\u0627\\u067e') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasUrduLive = meaningful.includes('\\u0644\\u0627\\u0626\\u06cc\\u0648') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasTop = hasEnglishTop || hasUrduTop;
        const hasLive = hasEnglishLive || hasUrduLive;
        if (hasTop && !hasLive) return 'top';
        if (hasLive && !hasTop) return 'live';
        return null;
      };
      const modeFromSelectedIndex = (value) => {
        if (value === '0') return 'top';
        if (value === '1') return 'live';
        return null;
      };
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const root = document.querySelector('yt-live-chat-renderer') ?? document.body;
      const labels = new Set();
      let selectedMode = null;
      let selectedLabel = null;
      let hasSelector = false;

      const dropdowns = Array.from(root.querySelectorAll('yt-dropdown-menu'));
      for (const dropdown of dropdowns) {
        const labelElement = dropdown.querySelector('#label-text') ?? dropdown.querySelector('#label');
        const label = normalize(labelElement?.textContent);
        const listbox = dropdown.querySelector('tp-yt-paper-listbox');
        const indexedMode = modeFromSelectedIndex(listbox?.getAttribute('selected'));
        const textMode = classifyChatFilterLabel(label);
        const mode = indexedMode ?? textMode;
        const optionLabels = Array.from(dropdown.querySelectorAll('tp-yt-paper-item[role="option"], tp-yt-paper-item'))
          .map((item) => normalize(item.textContent))
          .filter(Boolean);
        for (const optionLabel of optionLabels) {
          if (classifyChatFilterLabel(optionLabel)) labels.add(optionLabel);
        }
        if (mode) {
          labels.add(label);
          selectedMode = mode;
          selectedLabel = label;
          hasSelector = true;
          break;
        }
      }

      if (!selectedLabel) {
        const selectedElements = Array.from(
        root.querySelectorAll('[aria-selected="true"], [selected], tp-yt-paper-item.iron-selected'),
      );
      for (const element of selectedElements) {
        const label = normalize(element.textContent);
        const mode = classifyChatFilterLabel(label);
        if (mode) {
          labels.add(label);
          selectedMode = mode;
          selectedLabel = label;
          hasSelector = true;
          break;
          }
        }
      }

      const candidates = Array.from(
        root.querySelectorAll(
          'yt-dropdown-menu, tp-yt-paper-menu-button, tp-yt-paper-button, button, [role="button"], [role="option"], tp-yt-paper-item, #label',
        ),
    );
    for (const element of candidates) {
      const label = normalize(element.textContent);
      const ariaLabel = normalize(element.getAttribute('aria-label'));
      const labelMode = classifyChatFilterLabel(label);
      const ariaMode = classifyChatFilterLabel(ariaLabel);
      if (labelMode) labels.add(label);
      if (ariaMode) labels.add(ariaLabel);
      if (labelMode || ariaMode) {
        hasSelector = true;
      }
    }

      if (!selectedLabel) {
        for (const element of candidates) {
        if (!visible(element)) continue;
        const label = normalize(element.textContent);
        const ariaLabel = normalize(element.getAttribute('aria-label'));
        const labelMode = classifyChatFilterLabel(label);
        const ariaMode = classifyChatFilterLabel(ariaLabel);
        const match = labelMode ? { label, mode: labelMode } : ariaMode ? { label: ariaLabel, mode: ariaMode } : null;
        if (match) {
          selectedMode = match.mode;
          selectedLabel = match.label;
          hasSelector = true;
          break;
        }
        }
      }

      return {
        selectedMode,
        selectedLabel,
        hasSelector,
        labels: Array.from(labels)
      };
    })()
  `);
}

async function selectLiveChatFilter(page: Page): Promise<boolean> {
  const opened = await page.evaluate<boolean>(`
    (() => {
      const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
      const classifyChatFilterLabel = (value) => {
        const normalized = normalize(value);
        if (!normalized) return null;
        const meaningful = normalize(normalized.split(':').pop());
        const lower = meaningful.toLowerCase();
        const hasEnglishTop = lower.includes('top chat');
        const hasEnglishLive = lower.includes('live chat');
        const hasUrduTop = meaningful.includes('\\u0679\\u0627\\u067e') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasUrduLive = meaningful.includes('\\u0644\\u0627\\u0626\\u06cc\\u0648') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasTop = hasEnglishTop || hasUrduTop;
        const hasLive = hasEnglishLive || hasUrduLive;
        if (hasTop && !hasLive) return 'top';
        if (hasLive && !hasTop) return 'live';
        return null;
      };
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const root = document.querySelector('yt-live-chat-renderer') ?? document.body;
      const dropdowns = Array.from(root.querySelectorAll('yt-dropdown-menu'));
      const dropdown =
        dropdowns.find((candidate) =>
          classifyChatFilterLabel(normalize(candidate.querySelector('#label-text')?.textContent ?? candidate.querySelector('#label')?.textContent)),
        ) ?? null;
      const trigger =
        dropdown?.querySelector(
          '#trigger, tp-yt-paper-button, button, [role="button"]',
        ) ?? null;

      if (trigger && visible(trigger)) {
        trigger.click();
        return true;
      }

      const fallback = Array.from(
        root.querySelectorAll('button, [role="button"], tp-yt-paper-button'),
      ).find((candidate) => visible(candidate) && classifyChatFilterLabel(normalize(candidate.textContent)));
      if (fallback) {
        fallback.click();
        return true;
      }

      return false;
    })()
  `);

  if (!opened) return false;
  await page.waitForTimeout(400);

  const clicked = await page.evaluate<boolean>(`
    (() => {
      const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
      const classifyChatFilterLabel = (value) => {
        const normalized = normalize(value);
        if (!normalized) return null;
        const meaningful = normalize(normalized.split(':').pop());
        const lower = meaningful.toLowerCase();
        const hasEnglishTop = lower.includes('top chat');
        const hasEnglishLive = lower.includes('live chat');
        const hasUrduTop = meaningful.includes('\\u0679\\u0627\\u067e') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasUrduLive = meaningful.includes('\\u0644\\u0627\\u0626\\u06cc\\u0648') && meaningful.includes('\\u0686\\u06cc\\u0679');
        const hasTop = hasEnglishTop || hasUrduTop;
        const hasLive = hasEnglishLive || hasUrduLive;
        if (hasTop && !hasLive) return 'top';
        if (hasLive && !hasTop) return 'live';
        return null;
      };
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const options = Array.from(
        document.querySelectorAll(
          '[role="option"], tp-yt-paper-item, ytd-menu-service-item-renderer, yt-formatted-string',
        ),
      );
      const liveChatOption = options.find(
        (candidate) => visible(candidate) && classifyChatFilterLabel(candidate.textContent) === 'live',
      ) ?? options.filter((candidate) => candidate.matches?.('tp-yt-paper-item, [role="option"]'))[1] ?? null;

      if (!liveChatOption) return false;
      liveChatOption.click();
      return true;
    })()
  `);

  if (clicked) return true;

  await page.keyboard.press('ArrowDown').catch(() => undefined);
  await page.keyboard.press('Enter').catch(() => undefined);
  return true;
}

async function inspectChatPage(page: Page): Promise<{
  unavailable: boolean;
  ended: boolean;
  reason?: string;
}> {
  const state = await page.evaluate<{
    unavailable: boolean;
    ended: boolean;
    reason?: string;
  }>(`
    (() => {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    const unavailable =
      text.includes('chat is disabled') ||
      text.includes('live chat replay is not available') ||
      text.includes('this live chat is unavailable') ||
      text.includes('unable to connect to chat');
    const ended =
      text.includes('live stream offline') ||
      text.includes('this live stream has ended') ||
      text.includes('chat disconnected');

    return {
      unavailable,
      ended,
      reason: unavailable || ended ? document.body?.innerText?.slice(0, 500) : undefined
    };
    })()
  `);
  const result: { unavailable: boolean; ended: boolean; reason?: string } = {
    unavailable: state.unavailable,
    ended: state.ended
  };
  if (state.reason) result.reason = state.reason;
  return result;
}

async function readVisibleMessages(page: Page): Promise<RawDomMessage[]> {
  return page.evaluate<RawDomMessage[]>(`
    (() => {
    const selectors = [
      'yt-live-chat-text-message-renderer',
      'yt-live-chat-paid-message-renderer',
      'yt-live-chat-paid-sticker-renderer',
      'yt-live-chat-membership-item-renderer',
      'yt-live-chat-viewer-engagement-message-renderer',
      'yt-live-chat-banner-renderer'
    ].join(',');

    return Array.from(document.querySelectorAll(selectors)).map((element) => {
      const el = element;
      const text = (selector) =>
        (el.querySelector(selector)?.textContent ?? '').replace(/\\s+/g, ' ').trim();
      const attr = (selector, name) =>
        el.querySelector(selector)?.getAttribute(name) ?? null;
      const readRichText = (...selectors) => {
        const root = selectors.map((selector) => el.querySelector(selector)).find(Boolean);
        if (!root) return { text: '', parts: [] };

        const parts = [];
        const appendText = (value) => {
          if (!value) return;
          parts.push({ type: 'text', text: value.replace(/\\u00a0/g, ' ') });
        };
        const appendEmoji = (node) => {
          const image = node.tagName?.toLowerCase() === 'img' ? node : node.querySelector?.('img');
          const firstValue = (...values) =>
            values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? null;
          const styleUrl = (value) => value?.match(/url\\(["']?([^"')]+)["']?\\)/)?.[1] ?? null;
          const srcsetUrl = (value) => value?.split(',')?.[0]?.trim()?.split(/\\s+/)?.[0] ?? null;
          const alt =
            image?.getAttribute('alt') ??
            node.getAttribute?.('aria-label') ??
            node.getAttribute?.('title') ??
            image?.getAttribute('aria-label') ??
            image?.getAttribute('title') ??
            '';
          const src = firstValue(
            image?.currentSrc,
            image?.src,
            image?.getAttribute('src'),
            image?.getAttribute('data-thumb'),
            image?.getAttribute('data-src'),
            image?.getAttribute('data-emoji-url'),
            node.getAttribute?.('data-emoji-url'),
            srcsetUrl(image?.getAttribute('srcset')),
            styleUrl(image?.getAttribute('style')),
            styleUrl(node.getAttribute?.('style')),
          );
          const emojiId =
            node.getAttribute?.('data-emoji-id') ??
            image?.getAttribute('data-emoji-id') ??
            image?.getAttribute('id') ??
            null;
          const textValue = alt || '[emoji]';
          parts.push({ type: 'emoji', text: textValue, alt: alt || null, src, emojiId });
        };
        const visit = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            appendText(node.nodeValue ?? '');
            return;
          }

          if (node.nodeType !== Node.ELEMENT_NODE) return;

          const elementNode = node;
          const tagName = elementNode.tagName.toLowerCase();
          const isEmoji =
            tagName === 'img' ||
            tagName === 'yt-emoji' ||
            elementNode.classList.contains('emoji') ||
            elementNode.hasAttribute('data-emoji-id');
          if (isEmoji) {
            appendEmoji(elementNode);
            return;
          }

          for (const child of Array.from(elementNode.childNodes)) {
            visit(child);
          }
        };

        visit(root);
        const richText = parts.map((part) => part.text).join('').trim();
        return { text: richText, parts };
      };
      const badges = Array.from(el.querySelectorAll('yt-live-chat-author-badge-renderer')).map(
        (badge) => {
          const badgeEl = badge;
          const label =
            badgeEl.getAttribute('aria-label') ??
            badgeEl.getAttribute('shared-tooltip-text') ??
            badgeEl.title ??
            badgeEl.textContent?.trim() ??
            '';
          const lowered = label.toLowerCase();
          const type = lowered.includes('moderator')
            ? 'moderator'
            : lowered.includes('member')
              ? 'member'
              : lowered.includes('owner')
                ? 'owner'
                : 'badge';
          return { type, label, text: badgeEl.textContent?.trim() ?? '' };
        },
      );
      const richMessage = readRichText(
        '#message',
        '#event-text',
        '#header-subtext',
        '#sticker',
        '#purchase-amount',
      );

      return {
        domId: el.id || el.getAttribute('data-id'),
        tagName: el.tagName.toLowerCase(),
        authorName: text('#author-name') || text('#author-name span'),
        authorAvatarUrl: attr('#author-photo img', 'src') ?? attr('img', 'src'),
        rawAuthorUrl: attr('#author-name', 'href') ?? attr('a', 'href'),
        messageText:
          richMessage.text ||
          text('#content') ||
          text('#header-subtext') ||
          text('#purchase-amount') ||
          text('#event-text'),
        messageParts: richMessage.parts,
        timestampText: text('#timestamp') || null,
        badges,
        amountText: text('#purchase-amount') || null
      };
    });
    })()
  `);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
