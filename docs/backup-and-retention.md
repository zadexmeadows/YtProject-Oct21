# Backup and Retention

## PostgreSQL backups

Use `pg_dump` for logical backups and keep the output outside the application server.

For the Oracle VPS deployment, use the included Windows helper:

```powershell
.\scripts\backup-oracle-postgres.ps1 `
  -HostName "40.233.89.225" `
  -User "opc" `
  -KeyPath "C:\Users\Laptop Home\Documents\sshkey\ssh-key-2026-06-28 (6).key"
```

Restore with:

```powershell
.\scripts\restore-oracle-postgres.ps1 `
  -HostName "NEW_SERVER_IP" `
  -User "opc" `
  -KeyPath "C:\path\to\ssh-key.key" `
  -BackupFile "C:\path\to\ytbot-postgres-YYYYMMDD-HHMMSS.dump" `
  -ConfirmRestore
```

Generic PostgreSQL command:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=ytbot-$(date +%Y%m%d-%H%M%S).dump
```

Generic restore command:

```bash
pg_restore --clean --if-exists --dbname "$DATABASE_URL" ytbot-YYYYMMDD-HHMMSS.dump
```

For 24/7 deployments, prefer managed PostgreSQL point-in-time recovery or volume snapshots in addition to logical dumps.

## Export file backups

Export files are written to `EXPORT_DIR` and mounted by Docker Compose at `./storage/exports`.
Back up that folder alongside the database if completed reports must be retained.

## Retention cleanup

`retentionDays` is stored in `system_settings`. The worker runs hourly cleanup for chat messages older than this value. Admins can also run cleanup from the Settings page.

## Redis persistence

Redis is used for queues, deduplication caches, sessions, and worker coordination. Docker Compose enables append-only persistence. PostgreSQL remains the source of truth for captured messages and completed export job records.
