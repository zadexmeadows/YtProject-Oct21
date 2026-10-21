# Recovery and Security Guide

This guide is for a single-admin deployment. The goal is simple: you should be able to recover the project even if you lose access to Codex, your local machine, or the Oracle VPS.

## What must be backed up

Keep these in places you control, outside Codex:

- GitHub repository: source code and documentation.
- SSH private key for the Oracle server.
- Oracle account login and recovery method.
- Application admin login.
- Oracle VPS `.env` file.
- PostgreSQL backup dumps.
- Export files if generated PDF/CSV/Excel reports matter.

Do not commit `.env`, private SSH keys, database dumps, or export archives to Git.

## Recommended storage

Use at least two locations:

- Password manager: Oracle login, app admin login, SSH private key note, `.env` secrets.
- Cloud drive or external drive: PostgreSQL dumps and export archives.

For important backups, keep one copy that is not only on the Oracle VPS. A backup stored only on the VPS does not protect you if the VPS is deleted.

## Create a PostgreSQL backup

From Windows PowerShell:

```powershell
.\scripts\backup-oracle-postgres.ps1 `
  -HostName "40.233.89.225" `
  -User "opc" `
  -KeyPath "C:\Users\Laptop Home\Documents\sshkey\ssh-key-2026-06-28 (6).key"
```

This creates a timestamped `.dump` file in `backups/`.

Move that file to a safe off-machine location.

## Back up Oracle config and exports

Config without secrets:

```powershell
.\scripts\backup-oracle-config.ps1 `
  -HostName "40.233.89.225" `
  -User "opc" `
  -KeyPath "C:\Users\Laptop Home\Documents\sshkey\ssh-key-2026-06-28 (6).key"
```

Full recovery config, including `.env` secrets:

```powershell
.\scripts\backup-oracle-config.ps1 `
  -HostName "40.233.89.225" `
  -User "opc" `
  -KeyPath "C:\Users\Laptop Home\Documents\sshkey\ssh-key-2026-06-28 (6).key" `
  -IncludeSecrets
```

Include completed export files:

```powershell
.\scripts\backup-oracle-config.ps1 `
  -HostName "40.233.89.225" `
  -User "opc" `
  -KeyPath "C:\Users\Laptop Home\Documents\sshkey\ssh-key-2026-06-28 (6).key" `
  -IncludeSecrets `
  -IncludeExports
```

The `-IncludeSecrets` output contains the server `.env`. Store it in a password manager or encrypted drive.

## Restore PostgreSQL on a replacement VPS

After deploying the app on a new server and starting Docker Compose:

```powershell
.\scripts\restore-oracle-postgres.ps1 `
  -HostName "NEW_SERVER_IP" `
  -User "opc" `
  -KeyPath "C:\path\to\ssh-key.key" `
  -BackupFile "C:\path\to\ytbot-postgres-YYYYMMDD-HHMMSS.dump" `
  -ConfirmRestore
```

Restore is destructive. It replaces current database contents with the backup.

## If Codex account access is lost

You should still be able to work normally if these are available:

1. GitHub repository access.
2. Local clone or new clone from GitHub.
3. Oracle SSH key.
4. Oracle account credentials.
5. Recent database/config backups.

Recovery steps:

```bash
git clone https://github.com/zadexmeadows/ytmonitorbot.git
cd ytmonitorbot
npm install
```

Then use the scripts in this guide to connect to Oracle, back up, or restore.

## If Oracle VPS access is lost

1. Create a new VPS.
2. Install Docker and Docker Compose.
3. Clone the GitHub repository.
4. Restore `.env` from your secure backup or recreate it.
5. Start the stack.
6. Restore PostgreSQL from the latest `.dump`.
7. Point your domain or browser to the new IP.

## If the SSH key is lost

If you still have Oracle Console access:

1. Add a new public SSH key to the instance if the console allows it.
2. If not, attach the boot volume to a rescue instance and add the new key to `~opc/.ssh/authorized_keys`.
3. If recovery is too slow, create a fresh VPS and restore from backups.

Keep a copy of the private SSH key in a password manager or encrypted external drive.

## Simple backup schedule

For one-admin personal use:

- Daily: PostgreSQL dump.
- Weekly: config backup with `.env`.
- Weekly or monthly: export file archive, if reports matter.
- Monthly: test a restore on a fresh local or temporary server.

## Security baseline

- Keep Oracle and GitHub accounts protected with strong passwords and 2FA.
- Keep only ports `80` and `443` public for the app.
- Do not expose PostgreSQL or Redis to the internet.
- Store `.env` outside Git.
- Rotate secrets if a backup, SSH key, or token is exposed.
- Keep at least one fresh backup outside the VPS.
- Keep the GitHub repo updated after important changes.
