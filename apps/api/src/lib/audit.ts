import type { Request } from 'express';
import { Prisma, prisma } from '@ytbot/db';

export async function auditLog(
  req: Request,
  action: string,
  options: {
    entityType?: string;
    entityId?: string;
    metadata?: unknown;
  } = {},
) {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    userId: req.session.user?.id ?? null,
    action,
    entityType: options.entityType ?? null,
    entityId: options.entityId ?? null,
    metadata: options.metadata as any,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null
  };

  await prisma.auditLog.create({
    data
  });
}
