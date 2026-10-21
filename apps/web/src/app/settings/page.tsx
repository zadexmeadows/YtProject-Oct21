'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Save, Search, Trash2, UserRoundX, X } from 'lucide-react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch, setCsrfToken } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/components/Toast';

interface SettingsShape {
  captureSpeedMs: number;
  maxConcurrentStreams: number;
  retentionDays: number;
}

interface ChatUser {
  id: string;
  displayName: string;
  authorChannelId: string | null;
  avatarUrl: string | null;
  _count: { messages: number };
}

interface ExcludedChatUser {
  authorId: string | null;
  authorChannelId: string | null;
  displayName: string;
}

export default function SettingsPage() {
  return (
    <DashboardShell>
      <SettingsContent />
    </DashboardShell>
  );
}

function SettingsContent() {
  const { pushToast } = useToast();
  const [settings, setSettings] = useState<SettingsShape>({
    captureSpeedMs: 1500,
    maxConcurrentStreams: 8,
    retentionDays: 365
  });
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    savedEmail: '',
    currentPassword: '',
    newPassword: ''
  });
  const [excludedUsers, setExcludedUsers] = useState<ExcludedChatUser[]>([]);
  const [excludedUserQuery, setExcludedUserQuery] = useState('');
  const [matchingUsers, setMatchingUsers] = useState<ChatUser[]>([]);
  const [searchingExcludedUsers, setSearchingExcludedUsers] = useState(false);
  const [busyExcludedUser, setBusyExcludedUser] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ settings: Partial<SettingsShape> }>('/settings').then((data) =>
      setSettings((current) => ({
        captureSpeedMs: Number(data.settings.captureSpeedMs ?? current.captureSpeedMs),
        maxConcurrentStreams: Number(data.settings.maxConcurrentStreams ?? current.maxConcurrentStreams),
        retentionDays: Number(data.settings.retentionDays ?? current.retentionDays)
      })),
    );
    void apiFetch<{ user: { name: string; email: string } }>('/auth/me').then((data) =>
      setProfile((current) => ({
        ...current,
        name: data.user.name,
        email: data.user.email,
        savedEmail: data.user.email
      })),
    );
    void apiFetch<{ excludedUsers: ExcludedChatUser[] }>('/settings/excluded-users')
      .then((data) => setExcludedUsers(data.excludedUsers))
      .catch((error) => pushToast(error instanceof Error ? error.message : 'Could not load excluded users', 'error'));
  }, [pushToast]);

  useEffect(() => {
    const query = excludedUserQuery.trim();
    if (!query) {
      setMatchingUsers([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      setSearchingExcludedUsers(true);
      void apiFetch<{ users: ChatUser[] }>(`/users/search?q=${encodeURIComponent(query)}`)
        .then((data) => {
          if (!active) return;
          const excludedIds = new Set(excludedUsers.map((user) => user.authorId).filter(Boolean));
          setMatchingUsers(data.users.filter((user) => !excludedIds.has(user.id)));
        })
        .catch(() => {
          if (active) setMatchingUsers([]);
        })
        .finally(() => {
          if (active) setSearchingExcludedUsers(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [excludedUserQuery, excludedUsers]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await apiFetch('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    });
    pushToast('Settings saved', 'success');
  }

  async function cleanup() {
    const retentionDays = normalizeRetentionDays(settings.retentionDays);
    const preview = await apiFetch<{ matchingMessages: number; cutoff: string; retentionDays: number }>(
      '/settings/cleanup/preview',
      {
        method: 'POST',
        body: JSON.stringify({ retentionDays })
      },
    );

    if (preview.matchingMessages === 0) {
      setSettings((current) => ({ ...current, retentionDays }));
      pushToast(`No messages older than ${preview.retentionDays} days`, 'success');
      return;
    }

    const confirmed = window.confirm(
      `Cleanup will delete ${preview.matchingMessages.toLocaleString()} messages captured before ${formatCleanupCutoff(
        preview.cutoff,
      )}.\n\nRetention: ${preview.retentionDays} day${preview.retentionDays === 1 ? '' : 's'}.\n\nClick OK to delete them now. This cannot be undone.`,
    );
    if (!confirmed) return;

    setSettings((current) => ({ ...current, retentionDays }));
    const result = await apiFetch<{ deletedMessages: number; retentionDays: number }>('/settings/cleanup', {
      method: 'POST',
      body: JSON.stringify({ retentionDays })
    });
    pushToast(`Deleted ${result.deletedMessages} messages older than ${result.retentionDays} days`, 'success');
  }

  async function addExcludedUser(user: ChatUser) {
    try {
      const result = await apiFetch<{ excludedUsers: ExcludedChatUser[] }>('/settings/excluded-users', {
        method: 'POST',
        body: JSON.stringify({ authorId: user.id })
      });
      setExcludedUsers(result.excludedUsers);
      setExcludedUserQuery('');
      setMatchingUsers([]);
      pushToast(`${user.displayName} will be excluded from future captures`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not exclude this user', 'error');
    }
  }

  async function removeExcludedUser(user: ExcludedChatUser) {
    if (!user.authorId) return;
    setBusyExcludedUser(user.authorId);
    try {
      const result = await apiFetch<{ excludedUsers: ExcludedChatUser[] }>('/settings/excluded-users', {
        method: 'DELETE',
        body: JSON.stringify({ authorId: user.authorId })
      });
      setExcludedUsers(result.excludedUsers);
      pushToast(`${user.displayName} can be captured again`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not remove this exclusion', 'error');
    } finally {
      setBusyExcludedUser(null);
    }
  }

  async function deleteExcludedUserMessages(user: ExcludedChatUser) {
    if (!user.authorId) return;
    setBusyExcludedUser(user.authorId);
    try {
      const preview = await apiFetch<{ matchingMessages: number }>('/settings/excluded-users/messages/preview', {
        method: 'POST',
        body: JSON.stringify({ authorId: user.authorId })
      });
      if (preview.matchingMessages === 0) {
        pushToast(`No saved messages found for ${user.displayName}`, 'success');
        return;
      }

      const confirmed = window.confirm(
        `Delete all ${preview.matchingMessages.toLocaleString()} saved messages from ${user.displayName}? This cannot be undone. The user will remain excluded from future captures.`,
      );
      if (!confirmed) return;

      const result = await apiFetch<{ deletedMessages: number }>('/settings/excluded-users/messages/delete', {
        method: 'POST',
        body: JSON.stringify({ authorId: user.authorId })
      });
      pushToast(`Deleted ${result.deletedMessages.toLocaleString()} messages from ${user.displayName}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not delete this user’s messages', 'error');
    } finally {
      setBusyExcludedUser(null);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await apiFetch<{
        user: { name: string; email: string };
        csrfToken: string;
      }>('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: profile.name,
          email: profile.email,
          currentPassword: profile.currentPassword || undefined,
          newPassword: profile.newPassword || undefined
        })
      });
      setCsrfToken(response.csrfToken);
      setProfile((current) => ({
        ...current,
        name: response.user.name,
        email: response.user.email,
        savedEmail: response.user.email,
        currentPassword: '',
        newPassword: ''
      }));
      pushToast('Profile saved', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save profile', 'error');
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Capture" />
          <form className="grid gap-4 p-4" onSubmit={saveSettings}>
            <Field label="Capture interval">
              <input
                type="number"
                min={500}
                max={15000}
                value={settings.captureSpeedMs}
                onChange={(event) => setSettings((current) => ({ ...current, captureSpeedMs: Number(event.target.value) }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </Field>
            <Field label="Max concurrent streams">
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxConcurrentStreams}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, maxConcurrentStreams: Number(event.target.value) }))
                }
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </Field>
            <Field label="Retention days">
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retentionDays}
                onChange={(event) => setSettings((current) => ({ ...current, retentionDays: Number(event.target.value) }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">
                <Save size={15} />
                Save
              </Button>
              <Button type="button" variant="danger" onClick={cleanup}>
                <Trash2 size={15} />
                Cleanup
              </Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="Admin Profile" />
          <form className="grid gap-4 p-4" onSubmit={saveProfile}>
            <Field label="Name">
              <input
                value={profile.name}
                onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </Field>
            <Field label="Login email">
              <input
                type="email"
                autoComplete="email"
                value={profile.email}
                onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                required
              />
            </Field>
            <Field label="Current password">
              <input
                type="password"
                autoComplete="current-password"
                value={profile.currentPassword}
                onChange={(event) => setProfile((current) => ({ ...current, currentPassword: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                required={profile.email.trim().toLowerCase() !== profile.savedEmail.toLowerCase() || Boolean(profile.newPassword)}
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                autoComplete="new-password"
                value={profile.newPassword}
                onChange={(event) => setProfile((current) => ({ ...current, newPassword: event.target.value }))}
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </Field>
            <Button type="submit">
              <Save size={15} />
              Save
            </Button>
          </form>
        </Panel>

        <div className="xl:col-span-2">
          <Panel>
            <PanelHeader title="Excluded chat users" />
            <div className="grid gap-4 p-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Search stored chat users and click the exact account to exclude it from future captures. This uses the stored
                account identity, so accounts with the same display name remain distinct. Existing messages stay until you delete them.
              </p>

              <div className="relative">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                  <input
                    value={excludedUserQuery}
                    onChange={(event) => setExcludedUserQuery(event.target.value)}
                    placeholder="Search stored chat users by name or channel ID"
                    aria-label="Search stored chat users to exclude"
                    aria-autocomplete="list"
                    aria-expanded={matchingUsers.length > 0}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                {excludedUserQuery.trim() ? (
                  <div className="mt-2 overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
                    {matchingUsers.length > 0 ? (
                      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                        {matchingUsers.map((user) => (
                          <li key={user.id}>
                            <button
                              type="button"
                              onClick={() => void addExcludedUser(user)}
                              className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900"
                            >
                              {user.avatarUrl ? (
                                <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                              ) : (
                                <span className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                                <span className="block truncate text-xs text-slate-500">
                                  {user.authorChannelId || 'No channel ID'} · {user._count.messages.toLocaleString()} messages
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-300">
                                <Plus size={14} /> Exclude
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : searchingExcludedUsers ? (
                      <p className="px-3 py-3 text-sm text-slate-500">Searching stored users…</p>
                    ) : (
                      <p className="px-3 py-3 text-sm text-slate-500">No matching stored users found.</p>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
                  <UserRoundX size={17} className="text-cyan-500" />
                  <span className="font-medium">Excluded users</span>
                </div>
                {excludedUsers.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-slate-500">No additional users excluded.</p>
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {excludedUsers.map((user) => (
                      <li key={user.authorId ?? user.displayName} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <span className="block break-words font-medium">{user.displayName}</span>
                          {user.authorChannelId ? <span className="block truncate text-xs text-slate-500">{user.authorChannelId}</span> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="danger"
                            disabled={!user.authorId || busyExcludedUser === user.authorId}
                            onClick={() => void deleteExcludedUserMessages(user)}
                          >
                            <Trash2 size={14} />
                            Delete saved messages
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={!user.authorId || busyExcludedUser === user.authorId}
                            onClick={() => void removeExcludedUser(user)}
                            aria-label={`Allow ${user.displayName} to be captured again`}
                          >
                            <X size={14} />
                            Allow again
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function normalizeRetentionDays(value: number) {
  if (!Number.isFinite(value)) return 365;
  return Math.min(3650, Math.max(1, Math.trunc(value)));
}

function formatCleanupCutoff(value: string) {
  return formatDate(value);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
