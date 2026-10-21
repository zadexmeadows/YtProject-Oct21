import { logger } from './logger';

export async function fetchPublicVideoTitle(videoId: string): Promise<string | null> {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; YTLiveChatIntelligence/1.0; +https://localhost)'
      }
    });

    if (!response.ok) {
      logger.warn({ videoId, status: response.status }, 'Could not fetch public YouTube metadata');
      return null;
    }

    const html = await response.text();
    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1];
    const title = ogTitle ?? html.match(/<title>([^<]+)<\/title>/i)?.[1];
    return title ? decodeHtml(title.replace(/\s+-\s+YouTube$/i, '').trim()) : null;
  } catch (error) {
    logger.warn({ err: error, videoId }, 'Public metadata fetch failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
