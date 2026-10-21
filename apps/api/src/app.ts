import './types';
import compression from 'compression';
import { RedisStore } from 'connect-redis';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './lib/env';
import { csrfProtection } from './lib/csrf';
import { errorHandler } from './lib/http';
import { logger } from './lib/logger';
import { redis } from './lib/redis';
import { requireAuth } from './middleware/auth';
import { auditRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { dashboardRouter } from './routes/dashboard';
import { exportsRouter } from './routes/exports';
import { healthRouter } from './routes/health';
import { messagesRouter } from './routes/messages';
import { notificationsRouter } from './routes/notifications';
import { realtimeRouter } from './routes/realtime';
import { settingsRouter } from './routes/settings';
import { streamsRouter } from './routes/streams';
import { usersRouter } from './routes/users';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    }),
  );
  app.use(compression());
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(
    pinoHttp({
      logger
    }),
  );

  app.use(
    session({
      name: 'ytbot.sid',
      store: new RedisStore({ client: redis }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: env.NODE_ENV === 'production',
        domain: env.COOKIE_DOMAIN,
        maxAge: 1000 * 60 * 60 * 8
      }
    }),
  );
  app.use(csrfProtection);

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/realtime', requireAuth, realtimeRouter);
  app.use('/dashboard', requireAuth, dashboardRouter);
  app.use('/streams', requireAuth, streamsRouter);
  app.use('/messages', requireAuth, messagesRouter);
  app.use('/notifications', requireAuth, notificationsRouter);
  app.use('/users', requireAuth, usersRouter);
  app.use('/exports', requireAuth, exportsRouter);
  app.use('/settings', requireAuth, settingsRouter);
  app.use('/audit', requireAuth, auditRouter);

  app.use(errorHandler);
  return app;
}
