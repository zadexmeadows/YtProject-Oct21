'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, Edit2, Plus, Power, PowerOff, Search, Smartphone, Trash2, X } from 'lucide-react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { formatDate as formatPakistanDate } from '@/lib/format';
import { enableFcmPush, listenForForegroundMessages, type FirebasePushConfig } from '@/lib/fcm';

interface ChatAuthor {
  id: string;
  displayName: string;
  authorChannelId: string | null;
  avatarUrl: string | null;
  lastSeenAt: string;
  _count?: { messages: number };
}

interface NotificationEventUser {
  id: string;
  author: ChatAuthor;
}

interface NotificationEvent {
  id: string;
  name: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt: string | null;
  users: NotificationEventUser[];
  _count?: { deliveries: number };
}

interface EventFormState {
  name: string;
  isEnabled: boolean;
  authors: ChatAuthor[];
}

const emptyForm: EventFormState = {
  name: '',
  isEnabled: true,
  authors: []
};

interface PushDevice {
  id: string;
  name: string;
  userAgent: string | null;
  isEnabled: boolean;
  lastSeenAt: string;
  createdAt: string;
}

export default function NotificationsPage() {
  return (
    <DashboardShell>
      <NotificationsContent />
    </DashboardShell>
  );
}

function NotificationsContent() {
  const { pushToast } = useToast();
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<NotificationEvent | null>(null);
  const [form, setForm] = useState<EventFormState>(emptyForm);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatAuthor[]>([]);
  const [pushConfig, setPushConfig] = useState<FirebasePushConfig | null>(null);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [enablingPush, setEnablingPush] = useState(false);
  const selectedIds = useMemo(() => new Set(form.authors.map((author) => author.id)), [form.authors]);

  useEffect(() => {
    void Promise.all([loadEvents(), loadPushConfig()]);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void apiFetch<{ users: ChatAuthor[] }>(`/users/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => setResults(data.users))
        .catch(() => setResults([]));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query]);

  async function loadEvents() {
    setLoading(true);
    try {
      const data = await apiFetch<{ events: NotificationEvent[] }>('/notifications');
      setEvents(data.events);
    } finally {
      setLoading(false);
    }
  }

  async function loadPushConfig() {
    const data = await apiFetch<{
      configured: boolean;
      config: FirebasePushConfig | null;
      devices: PushDevice[];
    }>('/notifications/config');
    setPushConfigured(data.configured);
    setPushConfig(data.config);
    setDevices(data.devices);
    if (data.config) void listenForForegroundMessages(data.config);
  }

  async function enablePush() {
    if (!pushConfig) return;
    setEnablingPush(true);
    try {
      const device = await enableFcmPush(pushConfig);
      await apiFetch('/notifications/devices', {
        method: 'POST',
        body: JSON.stringify(device)
      });
      pushToast('Notifications enabled on this device', 'success');
      await loadPushConfig();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not enable notifications', 'error');
    } finally {
      setEnablingPush(false);
    }
  }

  async function removeDevice(device: PushDevice) {
    await apiFetch(`/notifications/devices/${device.id}`, { method: 'DELETE' });
    pushToast('Device removed', 'success');
    await loadPushConfig();
  }

  function openCreate() {
    setEditingEvent(null);
    setForm(emptyForm);
    setQuery('');
    setResults([]);
    setEditorOpen(true);
  }

  function openEdit(event: NotificationEvent) {
    setEditingEvent(event);
    setForm({
      name: event.name,
      isEnabled: event.isEnabled,
      authors: event.users.map((item) => item.author)
    });
    setQuery('');
    setResults([]);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingEvent(null);
    setForm(emptyForm);
    setQuery('');
    setResults([]);
  }

  function addAuthor(author: ChatAuthor) {
    if (selectedIds.has(author.id)) return;
    setForm((current) => ({ ...current, authors: [...current.authors, author] }));
  }

  function removeAuthor(authorId: string) {
    setForm((current) => ({ ...current, authors: current.authors.filter((author) => author.id !== authorId) }));
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    if (form.authors.length === 0) {
      pushToast('Select at least one tracked user', 'error');
      return;
    }

    const payload = {
      name: form.name,
      isEnabled: form.isEnabled,
      authorIds: form.authors.map((author) => author.id)
    };

    if (editingEvent) {
      await apiFetch(`/notifications/${editingEvent.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      pushToast('Notification event updated', 'success');
    } else {
      await apiFetch('/notifications', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      pushToast('Notification event created', 'success');
    }

    closeEditor();
    await loadEvents();
  }

  async function toggleEvent(event: NotificationEvent) {
    await apiFetch(`/notifications/${event.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled: !event.isEnabled })
    });
    pushToast(event.isEnabled ? 'Notification event disabled' : 'Notification event enabled', 'success');
    await loadEvents();
  }

  async function deleteEvent(event: NotificationEvent) {
    if (!window.confirm(`Delete notification event "${event.name}"?`)) return;
    await apiFetch(`/notifications/${event.id}`, { method: 'DELETE' });
    pushToast('Notification event deleted', 'success');
    await loadEvents();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        action={
          <Button type="button" onClick={openCreate}>
            <Plus size={15} />
            Add Event
          </Button>
        }
      />

      <Panel className="mb-4">
        <PanelHeader title="Push Notification Devices" />
        <div className="grid gap-4 p-4">
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BellRing size={16} className="text-blue-500" />
                Firebase Cloud Messaging
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {pushConfigured
                  ? 'Enable this browser to receive instant tracked-user alerts.'
                  : 'Firebase credentials are not configured yet. Device registration is temporarily disabled.'}
              </p>
            </div>
            <Button type="button" onClick={enablePush} disabled={!pushConfigured || enablingPush}>
              <Smartphone size={15} />
              {enablingPush ? 'Enabling...' : 'Enable on this device'}
            </Button>
          </div>
          {devices.length === 0 ? (
            <div className="text-sm text-slate-500">No devices registered.</div>
          ) : (
            <div className="grid gap-2">
              {devices.map((device) => (
                <div key={device.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium">{device.name}</div>
                    <div className="mt-1 text-xs text-slate-500">Last registered {formatDate(device.lastSeenAt)}</div>
                  </div>
                  <Button type="button" variant="danger" onClick={() => removeDevice(device)}>
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Notification Events" />
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No notification events yet.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">{event.name}</h2>
                    <StatusBadge enabled={event.isEnabled} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {event.users.slice(0, 8).map((item) => (
                      <UserChip key={item.id} author={item.author} />
                    ))}
                    {event.users.length > 8 ? (
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        +{event.users.length - 8}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-medium uppercase tracking-wide text-slate-400">Created</span>
                      <span>{formatDate(event.createdAt)}</span>
                    </div>
                    <div>
                      <span className="block font-medium uppercase tracking-wide text-slate-400">Last Triggered</span>
                      <span>{event.lastTriggeredAt ? formatDate(event.lastTriggeredAt) : 'Never'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                  <Button type="button" variant="secondary" onClick={() => toggleEvent(event)}>
                    {event.isEnabled ? <PowerOff size={14} /> : <Power size={14} />}
                    {event.isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => openEdit(event)}>
                    <Edit2 size={14} />
                    Edit
                  </Button>
                  <Button type="button" variant="danger" onClick={() => deleteEvent(event)}>
                    <Trash2 size={14} />
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>

      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <form
            onSubmit={saveEvent}
            className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Bell size={17} className="text-blue-500" />
                <h2 className="text-sm font-semibold">{editingEvent ? 'Edit Event' : 'Add Event'}</h2>
              </div>
              <Button type="button" variant="ghost" className="h-8 w-8 p-0" aria-label="Close" onClick={closeEditor}>
                <X size={16} />
              </Button>
            </div>

            <div className="grid gap-4 p-4">
              <Field label="Event Name">
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  placeholder="Main Notifications"
                />
              </Field>

              <label className="flex items-center gap-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(event) => setForm((current) => ({ ...current, isEnabled: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Enabled</span>
              </label>

              <Field label="Tracked Users">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                    placeholder="Search existing chat users"
                  />
                </div>
              </Field>

              {results.length > 0 ? (
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-800">
                  {results.map((author) => (
                    <button
                      key={author.id}
                      type="button"
                      disabled={selectedIds.has(author.id)}
                      onClick={() => addAuthor(author)}
                      className="flex items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar author={author} />
                        <span className="truncate">{author.displayName}</span>
                      </span>
                      <span className="text-xs text-slate-500">{author._count?.messages ?? 0} messages</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {form.authors.length === 0 ? (
                  <span className="text-sm text-slate-500">No users selected.</span>
                ) : (
                  form.authors.map((author) => (
                    <span
                      key={author.id}
                      className="inline-flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    >
                      <Avatar author={author} size="sm" />
                      {author.displayName}
                      <button type="button" aria-label={`Remove ${author.displayName}`} onClick={() => removeAuthor(author.id)}>
                        <X size={13} />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
              <Button type="button" variant="secondary" onClick={closeEditor}>
                Cancel
              </Button>
              <Button type="submit">{editingEvent ? 'Save Changes' : 'Create Event'}</Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={
        enabled
          ? 'rounded-md bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-950 dark:text-green-300'
          : 'rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function UserChip({ author }: { author: ChatAuthor }) {
  return (
    <span className="inline-flex max-w-[180px] items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <Avatar author={author} size="sm" />
      <span className="truncate">{author.displayName}</span>
    </span>
  );
}

function Avatar({ author, size = 'md' }: { author: ChatAuthor; size?: 'sm' | 'md' }) {
  const className = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';
  if (author.avatarUrl) {
    return <img src={author.avatarUrl} alt="" className={`${className} rounded-full object-cover`} />;
  }

  return (
    <span className={`${className} inline-flex items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white`}>
      {Array.from(author.displayName.replace(/^@/, '').trim())[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function formatDate(value: string) {
  return formatPakistanDate(value);
}
