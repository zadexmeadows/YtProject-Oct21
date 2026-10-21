'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  FileDown,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
  Users,
  Video,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { apiFetch, setCsrfToken } from '@/lib/api';
import { Button } from './Button';
import { ToastProvider, useToast } from './Toast';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/streams', label: 'Streams', icon: Video },
  { href: '/chat', label: 'Live Chat', icon: MessageSquareText },
  { href: '/users', label: 'User Intelligence', icon: Users },
  { href: '/users-update', label: 'Users Update', icon: ListChecks },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/exports', label: 'Exports', icon: FileDown },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/audit', label: 'Audit Logs', icon: History },
];

interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  csrfToken: string;
}

export function DashboardShell({
  children,
  hideHeader = false,
  mainClassName,
}: {
  children: React.ReactNode;
  hideHeader?: boolean;
  mainClassName?: string | undefined;
}) {
  return (
    <ToastProvider>
      <ShellContent hideHeader={hideHeader} mainClassName={mainClassName}>
        {children}
      </ShellContent>
    </ToastProvider>
  );
}

function ShellContent({
  children,
  hideHeader,
  mainClassName,
}: {
  children: React.ReactNode;
  hideHeader: boolean;
  mainClassName?: string | undefined;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [streamAlertCount, setStreamAlertCount] = useState(0);

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? 'light';
    const savedCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    setTheme(saved);
    setCollapsed(savedCollapsed);
    document.documentElement.classList.toggle('dark', saved === 'dark');
  }, []);

  useEffect(() => {
    if (!me) return;
    let disposed = false;
    let requestInFlight = false;
    const loadStreamAlerts = async () => {
      if (document.hidden || requestInFlight) return;
      requestInFlight = true;
      try {
        const data = await apiFetch<{ count: number }>('/streams/recovery-alerts');
        if (!disposed) setStreamAlertCount(data.count);
      } catch {
        // Keep the last known alert count if a brief request fails.
      } finally {
        requestInFlight = false;
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) void loadStreamAlerts();
    };
    void loadStreamAlerts();
    const interval = window.setInterval(() => void loadStreamAlerts(), 5_000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [me]);

  useEffect(() => {
    apiFetch<MeResponse>('/auth/me')
      .then((data) => {
        setMe(data.user);
        setCsrfToken(data.csrfToken);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;

    const loadWorkerStatus = async () => {
      if (document.hidden || requestInFlight) return;
      requestInFlight = true;
      try {
        const data = await apiFetch<{ online: boolean }>('/dashboard/worker-status');
        if (!disposed) setWorkerOnline(data.online);
      } catch {
        if (!disposed) setWorkerOnline(false);
      } finally {
        requestInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) void loadWorkerStatus();
    };

    void loadWorkerStatus();
    const interval = window.setInterval(() => void loadWorkerStatus(), 30_000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    pushToast('Signed out', 'success');
    router.replace('/login');
  };

  return (
    <div className="app-shell min-h-screen bg-slate-50 text-slate-950 dark:bg-surface-950 dark:text-slate-100">
      {open ? (
        <button
          type="button"
          className="app-sidebar-backdrop hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        data-sidebar-open={open}
        className={clsx(
          'app-sidebar fixed inset-y-0 left-0 z-40 border-r border-slate-200 bg-white transition-[transform,width] duration-200 dark:border-slate-800 dark:bg-slate-950 lg:translate-x-0',
          collapsed ? 'w-20' : 'w-72',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={clsx(
            'flex h-16 items-center border-b border-slate-200 px-4 dark:border-slate-800',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          <button
            type="button"
            className={clsx(
              'flex items-center gap-2 font-semibold text-slate-950 dark:text-slate-100',
              collapsed && 'justify-center',
            )}
            onClick={toggleSidebar}
            title={collapsed ? 'Show menu labels' : 'Collapse menu labels'}
            aria-label={collapsed ? 'Show menu labels' : 'Collapse menu labels'}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white">
              <Activity size={17} />
            </span>
            <span className={clsx('whitespace-nowrap transition-opacity', collapsed && 'hidden')}>
              Live Chat Intel
            </span>
          </button>
          <Button
            type="button"
            variant="ghost"
            className={clsx('h-8 w-8 p-0 lg:hidden', collapsed && 'hidden')}
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                title={item.label}
                className={clsx(
                  'flex items-center rounded-md px-3 py-2 text-sm font-medium transition',
                  collapsed ? 'justify-center gap-0' : 'gap-3',
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900',
                )}
              >
                <span className="relative inline-flex shrink-0">
                  <Icon size={17} />
                  {item.href === '/streams' && streamAlertCount > 0 ? (
                    <span
                      aria-label={`${streamAlertCount} stream recovery alerts`}
                      className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-950"
                    >
                      {streamAlertCount > 9 ? '9+' : streamAlertCount}
                    </span>
                  ) : null}
                </span>
                <span className={clsx('whitespace-nowrap', collapsed && 'sr-only')}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div
        className={clsx(
          'app-shell-content transition-[padding] duration-200',
          collapsed ? 'lg:pl-20' : 'lg:pl-72',
        )}
      >
        {hideHeader ? (
          <Button
            type="button"
            variant="ghost"
            className="fixed left-3 top-3 z-50 h-9 w-9 border border-slate-200 bg-white/90 p-0 shadow-sm dark:border-slate-800 dark:bg-slate-950/90 lg:hidden"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu size={19} />
          </Button>
        ) : (
          <header className="app-header sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-9 p-0 lg:hidden"
                aria-label="Open navigation"
                onClick={() => setOpen(true)}
              >
                <Menu size={19} />
              </Button>
              <div className="hidden items-center gap-2 text-sm text-slate-600 dark:text-slate-400 sm:flex">
                <span
                  className={clsx(
                    'h-2 w-2 rounded-full',
                    workerOnline ? 'bg-green-500' : 'bg-amber-500',
                  )}
                />
                <span>{workerOnline ? 'Worker online' : 'Worker pending'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-9 p-0"
                aria-label="Toggle theme"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </Button>
              <div className="hidden text-right text-xs sm:block">
                <div className="font-medium">{me?.name ?? 'Admin'}</div>
                <div className="text-slate-500">{me?.role ?? ''}</div>
              </div>
              <Button type="button" variant="secondary" onClick={logout}>
                <LogOut size={15} />
                Logout
              </Button>
            </div>
          </header>
        )}
        <main
          className={clsx(
            'app-main mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8',
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
