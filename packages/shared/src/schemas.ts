import { z } from 'zod';
import { YOUTUBE_VIDEO_ID_PATTERN } from './video';

export const roleSchema = z.enum(['SUPER_ADMIN', 'ADMIN', 'VIEWER']);

export const loginSchema = z.object({
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(200)
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()).optional(),
  currentPassword: z.string().min(8).max(200).optional(),
  newPassword: z.string().min(8).max(200).optional()
});

export const userUpdateCreateSchema = z.object({
  authorId: z.string().uuid()
});

export const createStreamsSchema = z.object({
  inputs: z
    .array(z.string().min(1).max(500))
    .min(1)
    .max(20)
});

export const updateStreamSchema = z.object({
  title: z.string().trim().min(1).max(300)
});

export const streamIdParamSchema = z.object({
  id: z.string().uuid()
});

export const messageFilterSchema = z.object({
  streamId: z.string().uuid().optional(),
  videoId: z.string().regex(YOUTUBE_VIDEO_ID_PATTERN).optional(),
  authorIds: z.array(z.string().uuid()).min(1).max(10).optional(),
  timelineAuthorId: z.string().uuid().optional(),
  authorName: z.string().min(1).max(200).optional(),
  authorChannelId: z.string().min(1).max(200).optional(),
  q: z.string().min(1).max(300).optional(),
  messageType: z
    .enum(['NORMAL', 'SUPERCHAT', 'MEMBERSHIP', 'PINNED', 'MODERATOR', 'OWNER', 'SYSTEM'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  hasModeratorBadge: z.coerce.boolean().optional(),
  hasMemberBadge: z.coerce.boolean().optional(),
  hasOwnerBadge: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50)
});

export const exportCreateSchema = z.object({
  format: z.enum(['PDF', 'CSV', 'EXCEL', 'JSON']),
  type: z.enum(['FULL_STREAM', 'FILTERED_CHAT', 'USER_CHAT', 'DATE_RANGE']),
  filters: messageFilterSchema.omit({ page: true, pageSize: true }).partial().default({})
});

export const exportDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

export const notificationEventCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  authorIds: z.array(z.string().uuid()).min(1).max(100),
  isEnabled: z.boolean().default(true)
});

export const notificationEventUpdateSchema = notificationEventCreateSchema.partial().extend({
  authorIds: z.array(z.string().uuid()).min(1).max(100).optional()
});

export const pushDeviceCreateSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  name: z.string().trim().min(1).max(120),
  userAgent: z.string().trim().max(1000).optional()
});

export const settingsUpdateSchema = z.object({
  captureSpeedMs: z.number().int().min(500).max(15000).optional(),
  maxConcurrentStreams: z.number().int().min(1).max(50).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional()
});

export const settingsCleanupSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional()
});

export const excludedUserInputSchema = z.object({
  authorId: z.string().uuid()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type UserUpdateCreateInput = z.infer<typeof userUpdateCreateSchema>;
export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;
export type MessageFilters = z.infer<typeof messageFilterSchema>;
export type ExportCreateInput = z.infer<typeof exportCreateSchema>;
export type NotificationEventCreateInput = z.infer<typeof notificationEventCreateSchema>;
export type NotificationEventUpdateInput = z.infer<typeof notificationEventUpdateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
