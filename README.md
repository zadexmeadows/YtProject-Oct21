Project source snapshot from the live instance. See setup and security notes below.

# YouTube Live Chat Intelligence System

A production-oriented admin dashboard for capturing and analyzing public YouTube live chat messages without YouTube Data API keys.

## Architecture Overview

The system is a TypeScript monorepo with four main runtime layers:

- `apps/web`: Next.js admin dashboard with protected routes, dark/light mode, charts, filters, stream controls, live chat viewer, exports, settings, and audit logs.
- `apps/api`: Express API with Redis-backed sessions, CSRF protection, role checks, audit logging, stream management, filtering/search, SSE realtime events, and export job creation.
- `apps/worker`: BullMQ worker process that runs 24/7 capture jobs and export jobs. It resumes active streams after restart and publishes realtime events through Redis.
- `packages/db` and `packages/shared`: Prisma/PostgreSQL schema, database helpers, shared validation, queue contracts, and event types.

Realtime updates use Server-Sent Events. Capture and export work is coordinated with Redis/BullMQ. PostgreSQL is the durable source of truth.

## Compliance Boundary

This project does not use YouTube Data API keys. The included `PublicYouTubeLiveChatAdapter` opens YouTube's public live chat popout page in an unauthenticated browser context and reads only messages rendered in public chat.

It must not be modified to bypass login, captchas, paywalls, private videos, deleted messages, blocked content, or YouTube access controls. It is intended only for lawful monitoring of public live chats visible to ordinary public viewers. Respect reasonable request rates and YouTube's applicable terms.

## Folder Structure

```text
.
├── apps
│   ├── api                  # Express API, auth, RBAC, SSE, routes
│   ├── web                  # Next.js admin dashboard
│   └── worker               # Capture manager, YouTube adapter, export processors
├── packages
│   ├── db                   # Prisma schema, migrations, seed, query helpers
│   └── shared               # Zod schemas, queue names, realtime event types
├── docs
│   └── backup-and-retention.md
├── storage
│   └── exports              # Generated reports
├── docker-compose.yml
└── .env.example
```

## Database Schema

The PostgreSQL schema is managed by Prisma migrations in `packages/db/prisma`.

Main tables:

- `users`: admin accounts with bcrypt password hashes and roles: `SUPER_ADMIN`, `ADMIN`, `VIEWER`.
- `streams`: YouTube video IDs, public metadata, capture status, retry counts, and lifecycle timestamps.
- `chat_authors`: public author identity data when available.
- `chat_messages`: durable chat records with dedupe key, message type, author fields, timestamps, badge JSON, Super Chat amount/currency, and raw JSONB payload.
- `capture_sessions`: worker sessions and heartbeats for restart-safe capture state.
- `export_jobs`: background report generation state and file metadata.
- `audit_logs`: admin actions such as login, stream control, export generation, settings changes, and cleanup.
- `system_settings`: capture speed, concurrency, retention, PDF branding, and the fixed Pakistan Standard Time configuration.

Indexes include `stream_id`, `video_id`, `author_name`, `author_channel_id`, `captured_at`, `message_type`, and a PostgreSQL full-text GIN index on `message_text`.

## Setup Instructions

### 1. Configure environment

```bash
cp .env.example .env
```

Set a strong `SESSION_SECRET` with at least 32 random characters. Change `SEED_ADMIN_PASSWORD` before deploying anywhere shared.

### 2. Start with Docker Compose

```bash
docker compose up --build
```

The API container runs migrations and seeds the initial admin user. Open:

- Dashboard: `http://localhost:3000`
- API health: `http://localhost:4000/health`

Default seed account from `.env.example`:

- Email: `admin@example.com`
- Password: `ChangeMe123!`

### 3. Local development without Docker

Install dependencies:

```bash
npm install
```

Start PostgreSQL and Redis locally, then run:

```bash
npm run db:generate
npm run db:dev
npm run db:seed
npm run dev
```

On Windows, this repo includes a no-admin local helper for Scoop-installed PostgreSQL and Redis:

```powershell
scoop install postgresql redis
.\scripts\start-local-windows.ps1
```

Stop the local dev stack and database services with:

```powershell
.\scripts\stop-local-windows.ps1
```

### 4. Run checks

```bash
npm run typecheck
npm test
```

## Capture Adapter System

Capture is intentionally modular:

- Interface: `apps/worker/src/capture/types.ts`
- Implementation: `apps/worker/src/capture/PublicYouTubeLiveChatAdapter.ts`
- Orchestration: `apps/worker/src/capture/CaptureManager.ts`

Future adapters can implement `ChatCaptureAdapter` without changing API routes, storage, exports, or dashboard code.

## Reports

Exports run in the worker and support:

- PDF with cover page, stream/date/filter summary, statistics, table, generated timestamp, and page numbers.
- CSV for spreadsheet ingestion.
- Excel with Summary and Messages worksheets.
- JSON with summary, filters, messages, and raw payloads.

Completed files are written to `EXPORT_DIR` and exposed through authenticated API download routes.

## Recovery and Safety

For single-admin recovery planning, see:

- `docs/recovery-and-security.md`
- `docs/recovery-inventory.template.md`

The repo includes scripts for Oracle VPS PostgreSQL backups, config backups, and restore:

- `scripts/backup-oracle-postgres.ps1`
- `scripts/backup-oracle-config.ps1`
- `scripts/restore-oracle-postgres.ps1`

Keep generated backups, `.env` files, and SSH private keys outside Git.

## Reliability Notes

- BullMQ queues persist capture/export control jobs in Redis.
- Stream state is persisted in PostgreSQL.
- Worker startup resumes streams in `PENDING`, `CAPTURING`, or `RETRYING`.
- Each message has a database unique constraint on `(stream_id, message_id)`.
- Redis seen-sets reduce duplicate writes during active capture.
- Capture failures move streams to `RETRYING` with exponential backoff.
- Docker services use `restart: unless-stopped`.
- Health endpoints and worker heartbeats are visible in the dashboard.

## Security Notes

- Admin sessions are stored in Redis with HTTP-only cookies.
- Mutating API requests require CSRF tokens.
- Login is rate-limited.
- Passwords are hashed with bcrypt.
- Dashboard routes require authentication.
- Admin-only mutations require `ADMIN` or `SUPER_ADMIN`.
- React escapes message text by default; raw payloads are displayed as text in controlled admin-only views.
- Server errors are logged internally and returned to the UI as sanitized API errors.

## Backup Strategy

See `docs/backup-and-retention.md` for PostgreSQL backups, export file backups, retention cleanup, and Redis persistence notes.

