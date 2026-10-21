import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { countMessages } from '../messageQueries';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';

describe.skipIf(!databaseUrl)('message query integration', () => {
  it('counts messages with an empty filter set', async () => {
    const db = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });

    const count = await countMessages(db, {});
    expect(Number.isInteger(count)).toBe(true);
    await db.$disconnect();
  });
});
