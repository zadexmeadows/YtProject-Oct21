'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity } from 'lucide-react';
import { apiFetch, setCsrfToken } from '@/lib/api';
import { Button } from '@/components/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{
        user: unknown;
        csrfToken: string;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setCsrfToken(response.csrfToken);
      const requestedPath = new URLSearchParams(window.location.search).get('next');
      router.replace(isSafeInternalPath(requestedPath) ? requestedPath : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-surface-950">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-600 text-white">
            <Activity size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Live Chat Intel</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Admin sign in</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-950"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-950"
              required
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}

function isSafeInternalPath(value: string | null): value is string {
  return Boolean(value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login'));
}
