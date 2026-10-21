import { describe, expect, it } from 'vitest';
import { extractManyYouTubeVideoIds, extractYouTubeVideoId } from '../video';

describe('YouTube video id parsing', () => {
  it('accepts a raw 11-character video id', () => {
    expect(extractYouTubeVideoId('abcDEF_123-')).toBe('abcDEF_123-');
  });

  it('extracts ids from common public YouTube URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=abcDEF_123-&t=12')).toBe(
      'abcDEF_123-',
    );
    expect(extractYouTubeVideoId('https://youtu.be/abcDEF_123-')).toBe('abcDEF_123-');
    expect(extractYouTubeVideoId('https://www.youtube.com/live/abcDEF_123-')).toBe(
      'abcDEF_123-',
    );
  });

  it('deduplicates multiple inputs', () => {
    expect(extractManyYouTubeVideoIds('abcDEF_123-\nhttps://youtu.be/abcDEF_123-')).toEqual([
      'abcDEF_123-',
    ]);
  });
});
