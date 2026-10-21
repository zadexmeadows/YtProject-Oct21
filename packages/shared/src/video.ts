export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const VIDEO_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?[^#]*v=)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i
];

export function extractYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) {
    return value;
  }

  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = value.match(pattern);
    if (match?.[1] && YOUTUBE_VIDEO_ID_PATTERN.test(match[1])) {
      return match[1];
    }
  }

  try {
    const url = new URL(value);
    const id = url.searchParams.get('v');
    if (id && YOUTUBE_VIDEO_ID_PATTERN.test(id)) {
      return id;
    }
  } catch {
    return null;
  }

  return null;
}

export function extractManyYouTubeVideoIds(input: string): string[] {
  const parts = input
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(parts.map(extractYouTubeVideoId).filter((id): id is string => Boolean(id))));
}
