import type { UserRole } from '@ytbot/db';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    csrfToken?: string;
  }
}
