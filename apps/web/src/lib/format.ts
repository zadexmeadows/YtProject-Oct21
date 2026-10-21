import { PAKISTAN_TIME_ZONE } from '@ytbot/shared';

export function formatNumber(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PAKISTAN_TIME_ZONE
  }).format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  }).format(new Date(value));
}

export function formatCalendarDate(value: string | Date | null | undefined) {
  if (!value) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: PAKISTAN_TIME_ZONE
  }).format(new Date(value));
}

export function pakistanDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: PAKISTAN_TIME_ZONE
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function parsePakistanDateTimeInput(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    return new Date(Number.NaN);
  }
  return new Date(`${normalized}${normalized.length === 16 ? ':00' : ''}+05:00`);
}

export function statusTone(status: string) {
  switch (status) {
    case 'CAPTURING':
    case 'COMPLETED':
    case 'RUNNING':
      return 'green';
    case 'PENDING':
    case 'PROCESSING':
    case 'RETRYING':
      return 'amber';
    case 'PAUSED':
    case 'STOPPED':
      return 'slate';
    case 'FAILED':
      return 'red';
    case 'ENDED':
      return 'blue';
    default:
      return 'slate';
  }
}
