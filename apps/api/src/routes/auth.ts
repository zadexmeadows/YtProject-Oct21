import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma, prisma } from '@ytbot/db';
import { loginSchema, profileUpdateSchema } from '@ytbot/shared';
import { auditLog } from '../lib/audit';
import { ensureCsrfToken } from '../lib/csrf';
import { ApiError, asyncHandler, validateBody } from '../lib/http';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again later.',
    code: 'RATE_LIMITED'
  }
});

authRouter.get('/csrf', (req, res) => {
  res.json({ csrfToken: ensureCsrfToken(req) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
});

authRouter.get('/session', requireAuth, (_req, res) => {
  res.status(204).end();
});

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = validateBody(loginSchema, req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email }
    });

    if (!user || !user.isActive) {
      throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };
      ensureCsrfToken(req);

      req.session.save((saveError) => {
        if (saveError) reject(saveError);
        else resolve();
      });
    });

    await auditLog(req, 'user.login', {
      entityType: 'user',
      entityId: user.id
    });
    res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await auditLog(req, 'user.logout', {
      entityType: 'user',
      ...(req.session.user?.id ? { entityId: req.session.user.id } : {})
    });

    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.clearCookie('ytbot.sid');
    res.json({ ok: true });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = validateBody(profileUpdateSchema, req.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.session.user!.id }
    });

    const emailChanged = input.email !== undefined && input.email !== user.email.toLowerCase();
    const passwordChanged = input.newPassword !== undefined;
    const nameChanged = input.name !== undefined && input.name !== user.name;
    const sensitiveChange = emailChanged || passwordChanged;

    if (sensitiveChange) {
      if (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
        throw new ApiError(403, 'Current password is incorrect', 'CURRENT_PASSWORD_INVALID');
      }
    }

    if (emailChanged) {
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email! },
        select: { id: true }
      });
      if (existingUser && existingUser.id !== user.id) {
        throw new ApiError(409, 'Email address is already in use', 'EMAIL_IN_USE');
      }
    }

    const data: { name?: string; email?: string; passwordHash?: string } = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (emailChanged) {
      data.email = input.email!;
    }
    if (passwordChanged) {
      data.passwordHash = await bcrypt.hash(input.newPassword!, 12);
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id: user.id },
        data
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Email address is already in use', 'EMAIL_IN_USE');
      }
      throw error;
    }

    const sessionUser = {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role
    };

    if (sensitiveChange) {
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      req.session.user = sessionUser;
      ensureCsrfToken(req);
    } else {
      req.session.user = sessionUser;
    }

    await auditLog(req, 'user.profile_changed', {
      entityType: 'user',
      entityId: updated.id,
      metadata: {
        nameChanged,
        emailChanged,
        passwordChanged
      }
    });

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
  }),
);
