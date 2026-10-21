import { prisma } from '@ytbot/db';
import { env } from './env';

export interface WorkerSettings {
  captureSpeedMs: number;
  maxConcurrentStreams: number;
  retentionDays: number;
  pdfBrandName: string;
  pdfBrandAccent: string;
}

const EXCLUDED_USERS_SETTING_KEY = 'excludedUserNames';
const EXCLUDED_USERS_CACHE_MS = 5_000;
export interface ExcludedChatUser {
  authorId: string | null;
  authorChannelId: string | null;
  displayName: string;
}
let excludedUsersCache: { expiresAt: number; users: ExcludedChatUser[] } | null = null;

export async function getExcludedChatUsers(): Promise<ExcludedChatUser[]> {
  if (excludedUsersCache && excludedUsersCache.expiresAt > Date.now()) {
    return excludedUsersCache.users;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: EXCLUDED_USERS_SETTING_KEY },
    select: { value: true }
  });
  const users = Array.isArray(setting?.value)
    ? setting.value.flatMap((value): ExcludedChatUser[] => {
        if (typeof value === 'string') return [{ authorId: null, authorChannelId: null, displayName: value }];
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        if (typeof item.displayName !== 'string') return [];
        return [{
          authorId: typeof item.authorId === 'string' ? item.authorId : null,
          authorChannelId: typeof item.authorChannelId === 'string' ? item.authorChannelId : null,
          displayName: item.displayName
        }];
      })
    : [];
  excludedUsersCache = { users, expiresAt: Date.now() + EXCLUDED_USERS_CACHE_MS };
  return users;
}

export async function getWorkerSettings(): Promise<WorkerSettings> {
  const rows = await prisma.systemSetting.findMany();
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, any>;

  return {
    captureSpeedMs: Number(values.captureSpeedMs ?? env.DEFAULT_CAPTURE_SPEED_MS),
    maxConcurrentStreams: Number(values.maxConcurrentStreams ?? env.MAX_CONCURRENT_STREAMS),
    retentionDays: Number(values.retentionDays ?? 365),
    pdfBrandName: String(values.pdfBrandName ?? 'YouTube Live Chat Intelligence'),
    pdfBrandAccent: String(values.pdfBrandAccent ?? '#2563eb')
  };
}
