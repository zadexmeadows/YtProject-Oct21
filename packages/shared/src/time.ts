export const PAKISTAN_TIME_ZONE = 'Asia/Karachi';
export const PAKISTAN_UTC_OFFSET = '+05:00';

const PAKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;

export function formatPakistanIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + PAKISTAN_OFFSET_MS).toISOString().replace('Z', PAKISTAN_UTC_OFFSET);
}
