import { type Request, Router } from 'express';
import { Prisma, prisma } from '@ytbot/db';
import { excludedUserInputSchema, settingsCleanupSchema, settingsUpdateSchema } from '@ytbot/shared';
import { auditLog } from '../lib/audit';
import { ApiError, asyncHandler, validateBody } from '../lib/http';
import { requireRole } from '../middleware/auth';

export const settingsRouter = Router();
const EXCLUDED_USERS_SETTING_KEY = 'excludedUserNames';
interface ExcludedChatUser {
  authorId: string | null;
  authorChannelId: string | null;
  displayName: string;
}

async function readExcludedUsers(): Promise<ExcludedChatUser[]> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: EXCLUDED_USERS_SETTING_KEY },
    select: { value: true }
  });
  if (!Array.isArray(setting?.value)) return [];
  return setting.value.flatMap((value): ExcludedChatUser[] => {
    if (typeof value === 'string') return [{ authorId: null, authorChannelId: null, displayName: value }];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.displayName !== 'string') return [];
    return [{
      authorId: typeof item.authorId === 'string' ? item.authorId : null,
      authorChannelId: typeof item.authorChannelId === 'string' ? item.authorChannelId : null,
      displayName: item.displayName
    }];
  });
}

async function writeExcludedUsers(users: ExcludedChatUser[], updatedBy: string | null) {
  const value = users as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({
    where: { key: EXCLUDED_USERS_SETTING_KEY },
    update: { value, updatedBy },
    create: { key: EXCLUDED_USERS_SETTING_KEY, value, updatedBy }
  });
}

async function parseExcludedUser(req: Request) {
  const { authorId } = validateBody(excludedUserInputSchema, req.body);
  const author = await prisma.chatAuthor.findUnique({
    where: { id: authorId },
    select: { id: true, authorChannelId: true, displayName: true }
  });
  if (!author) throw new ApiError(404, 'Stored chat user not found', 'NOT_FOUND');
  return author;
}

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.systemSetting.findMany();
    res.json({
      settings: Object.fromEntries(rows.map((row) => [row.key, row.value]))
    });
  }),
);

settingsRouter.get(
  '/excluded-users',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json({ excludedUsers: await readExcludedUsers() });
  }),
);

settingsRouter.post(
  '/excluded-users',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const author = await parseExcludedUser(req);
    const users = await readExcludedUsers();
    if (!users.some((existing) => existing.authorId === author.id)) {
      users.push({ authorId: author.id, authorChannelId: author.authorChannelId, displayName: author.displayName });
      await writeExcludedUsers(users, req.session.user?.id ?? null);
    }

    await auditLog(req, 'settings.user_excluded', {
      entityType: 'system_settings',
      entityId: author.id,
      metadata: { displayName: author.displayName, authorChannelId: author.authorChannelId }
    });
    res.json({ excludedUsers: users });
  }),
);

settingsRouter.delete(
  '/excluded-users',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const author = await parseExcludedUser(req);
    const current = await readExcludedUsers();
    const excludedUsers = current.filter((existing) => existing.authorId
      ? existing.authorId !== author.id
      : existing.displayName.toLowerCase() !== author.displayName.toLowerCase());
    await writeExcludedUsers(excludedUsers, req.session.user?.id ?? null);
    await auditLog(req, 'settings.user_unexcluded', {
      entityType: 'system_settings',
      entityId: author.id,
      metadata: { displayName: author.displayName }
    });
    res.json({ excludedUsers });
  }),
);

settingsRouter.post(
  '/excluded-users/messages/preview',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const author = await parseExcludedUser(req);
    const where = author.authorChannelId
      ? { OR: [{ authorId: author.id }, { authorChannelId: author.authorChannelId }] }
      : { authorId: author.id };
    const matchingMessages = await prisma.chatMessage.count({ where });
    res.json({ authorId: author.id, displayName: author.displayName, matchingMessages });
  }),
);

settingsRouter.post(
  '/excluded-users/messages/delete',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const author = await parseExcludedUser(req);
    const where = author.authorChannelId
      ? { OR: [{ authorId: author.id }, { authorChannelId: author.authorChannelId }] }
      : { authorId: author.id };
    const { count: deletedMessages } = await prisma.chatMessage.deleteMany({ where });
    await auditLog(req, 'storage.user_messages_deleted', {
      entityType: 'chat_messages',
      entityId: author.id,
      metadata: { displayName: author.displayName, deletedMessages }
    });
    res.json({ authorId: author.id, displayName: author.displayName, deletedMessages });
  }),
);

settingsRouter.patch(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const input = validateBody(settingsUpdateSchema, req.body);

    for (const [key, value] of Object.entries(input)) {
      const update: Prisma.SystemSettingUncheckedUpdateInput = {
        value: value as any,
        updatedBy: req.session.user?.id ?? null
      };
      const create: Prisma.SystemSettingUncheckedCreateInput = {
        key,
        value: value as any,
        updatedBy: req.session.user?.id ?? null
      };
      await prisma.systemSetting.upsert({
        where: { key },
        update,
        create
      });
    }

    await auditLog(req, 'settings.changed', {
      entityType: 'system_settings',
      metadata: input
    });

    const rows = await prisma.systemSetting.findMany();
    res.json({ settings: Object.fromEntries(rows.map((row) => [row.key, row.value])) });
  }),
);

settingsRouter.post(
  '/cleanup/preview',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { retentionDays, cutoff } = await resolveCleanupRetention(req);
    const matchingMessages = await prisma.chatMessage.count({
      where: { capturedAt: { lt: cutoff } }
    });

    res.json({
      matchingMessages,
      cutoff,
      retentionDays
    });
  }),
);

settingsRouter.post(
  '/cleanup',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { retentionDays, cutoff, shouldPersistRetention } = await resolveCleanupRetention(req);

    if (shouldPersistRetention) {
      await prisma.systemSetting.upsert({
        where: { key: 'retentionDays' },
        update: {
          value: retentionDays,
          updatedBy: req.session.user?.id ?? null
        },
        create: {
          key: 'retentionDays',
          value: retentionDays,
          updatedBy: req.session.user?.id ?? null
        }
      });
    }

    const result = await prisma.chatMessage.deleteMany({
      where: { capturedAt: { lt: cutoff } }
    });

    await auditLog(req, 'storage.cleanup', {
      entityType: 'chat_messages',
      metadata: { deletedMessages: result.count, cutoff: cutoff.toISOString(), retentionDays }
    });

    res.json({ deletedMessages: result.count, cutoff, retentionDays });
  }),
);

async function resolveCleanupRetention(req: Request) {
  const input = validateBody(settingsCleanupSchema, req.body ?? {});
  let retentionDays = input.retentionDays;

  if (retentionDays === undefined) {
    const retention = await prisma.systemSetting.findUnique({
      where: { key: 'retentionDays' }
    });
    retentionDays = Number(retention?.value ?? 365);
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
  return {
    cutoff,
    retentionDays,
    shouldPersistRetention: input.retentionDays !== undefined
  };
}
