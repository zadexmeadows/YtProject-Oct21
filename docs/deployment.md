# Production Deployment

This project is deployed as:

- Vercel frontend: `https://ytbot-lilac.vercel.app`
- Render API/worker target URL: `https://ytbot-api-worker.onrender.com`

The frontend is configured with:

```text
NEXT_PUBLIC_API_URL=https://ytbot-api-worker.onrender.com
```

## Render Backend

Use the root `render.yaml` Blueprint. It creates:

- one Docker web service named `ytbot-api-worker`
- one PostgreSQL database named `ytbot-postgres`
- one Render Key Value instance named `ytbot-redis`
- one persistent disk mounted at `/app/storage`

The API and worker intentionally run in the same Render service for this first deployment. Export files are written by the worker and downloaded by the API, so they need a shared persistent disk. Splitting API and worker into separate Render services requires moving exports to S3/R2 or another shared object store.

Required manual Blueprint values:

```text
SEED_ADMIN_EMAIL=<your admin email>
SEED_ADMIN_PASSWORD=<strong temporary password>
```

The Blueprint already sets:

```text
WEB_ORIGIN=https://ytbot-lilac.vercel.app
NODE_ENV=production
EXPORT_DIR=/app/storage/exports
HEADLESS_BROWSER=true
```

After the Render service is live, open:

```text
https://ytbot-api-worker.onrender.com/health
```

Expected response:

```json
{
  "ok": true,
  "service": "api",
  "database": "ok",
  "redis": "ok"
}
```

Then log in at:

```text
https://ytbot-lilac.vercel.app/login
```

Immediately change the seeded admin password from Settings.

## If Render Changes The URL

If Render creates a different backend URL, update `NEXT_PUBLIC_API_URL` in `vercel.json`, redeploy Vercel, and update `WEB_ORIGIN` in Render if the frontend URL also changes.
