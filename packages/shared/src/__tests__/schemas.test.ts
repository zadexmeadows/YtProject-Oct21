import { describe, expect, it } from 'vitest';
import {
  exportCreateSchema,
  exportDeleteSchema,
  loginSchema,
  profileUpdateSchema,
  settingsUpdateSchema,
  userUpdateCreateSchema
} from '../schemas';

describe('authentication schemas', () => {
  it('normalizes login email addresses', () => {
    const result = loginSchema.parse({
      email: '  ADMIN@Example.COM ',
      password: 'StrongPassword123!'
    });

    expect(result.email).toBe('admin@example.com');
  });

  it('normalizes profile email addresses', () => {
    const result = profileUpdateSchema.parse({
      email: '  New.Address@Example.COM ',
      currentPassword: 'StrongPassword123!'
    });

    expect(result.email).toBe('new.address@example.com');
  });

  it('rejects invalid profile email addresses', () => {
    expect(() => profileUpdateSchema.parse({ email: 'not-an-email' })).toThrow();
  });

  it('accepts a valid author for the users update watchlist', () => {
    const result = userUpdateCreateSchema.parse({
      authorId: '8d4f6710-2e1f-4f0d-b79e-07fc925485c6'
    });

    expect(result.authorId).toBe('8d4f6710-2e1f-4f0d-b79e-07fc925485c6');
  });

  it('rejects an invalid watchlist author id', () => {
    expect(() => userUpdateCreateSchema.parse({ authorId: 'not-a-uuid' })).toThrow();
  });
});

describe('export schemas', () => {
  it('accepts multiple users with a primary session timeline', () => {
    const result = exportCreateSchema.parse({
      format: 'PDF',
      type: 'USER_CHAT',
      filters: {
        authorIds: [
          '8d4f6710-2e1f-4f0d-b79e-07fc925485c6',
          '6e3b625f-0cd7-4d87-896f-7f1ea5a35358'
        ],
        timelineAuthorId: '8d4f6710-2e1f-4f0d-b79e-07fc925485c6'
      }
    });

    expect(result.filters.authorIds).toHaveLength(2);
    expect(result.filters.timelineAuthorId).toBe('8d4f6710-2e1f-4f0d-b79e-07fc925485c6');
  });

  it('accepts bulk deletion of export jobs', () => {
    const result = exportDeleteSchema.parse({
      ids: [
        '8d4f6710-2e1f-4f0d-b79e-07fc925485c6',
        '6e3b625f-0cd7-4d87-896f-7f1ea5a35358'
      ]
    });

    expect(result.ids).toHaveLength(2);
  });

  it('does not accept PDF branding changes', () => {
    const result = settingsUpdateSchema.parse({
      retentionDays: 365,
      pdfBrandName: 'Custom',
      pdfBrandAccent: '#ff0000'
    });

    expect(result).toEqual({ retentionDays: 365 });
  });
});
