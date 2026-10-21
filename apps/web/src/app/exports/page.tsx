'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Download, FileDown, RefreshCw, Trash2 } from 'lucide-react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { apiFetch } from '@/lib/api';
import { formatDate, parsePakistanDateTimeInput } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useRealtime } from '@/components/RealtimeProvider';

interface ExportJob {
  id: string;
  status: string;
  format: string;
  type: string;
  filters: unknown;
  fileName: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: { name: string; email: string } | null;
}

interface StreamRow {
  id: string;
  videoId: string;
  title: string | null;
}

interface ExportContent {
  fileName: string;
  mimeType: string;
  base64: string;
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

interface AndroidDownloadsBridge {
  saveBase64File(base64: string, mimeType: string, fileName: string): boolean;
}

export default function ExportsPage() {
  return (
    <DashboardShell>
      <ExportsContent />
    </DashboardShell>
  );
}

function ExportsContent() {
  const { pushToast } = useToast();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    format: 'PDF',
    type: 'FULL_STREAM',
    streamId: '',
    authorName: '',
    q: '',
    from: '',
    to: ''
  });

  const load = useCallback(async () => {
    const data = await apiFetch<{ jobs: ExportJob[] }>('/exports');
    setJobs(data.jobs);
    setSelectedJobIds((current) => {
      const availableIds = new Set(data.jobs.filter(isDeletableJob).map((job) => job.id));
      return current.filter((id) => availableIds.has(id));
    });
  }, []);

  useEffect(() => {
    void load();
    void apiFetch<{ streams: StreamRow[] }>('/streams').then((data) => setStreams(data.streams));
  }, [load]);

  useRealtime(
    useCallback(
      (event) => {
        if (event.type === 'export.status') {
          void load();
        }
      },
      [load],
    ),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const filters: Record<string, string> = {};
    if (form.streamId) filters.streamId = form.streamId;
    if (form.authorName) filters.authorName = form.authorName;
    if (form.q) filters.q = form.q;
    if (form.from) filters.from = parsePakistanDateTimeInput(form.from).toISOString();
    if (form.to) filters.to = parsePakistanDateTimeInput(form.to).toISOString();

    await apiFetch('/exports', {
      method: 'POST',
      body: JSON.stringify({ format: form.format, type: form.type, filters })
    });
    pushToast('Export queued', 'success');
    await load();
  }

  async function downloadExport(job: ExportJob) {
    setDownloadingJobId(job.id);
    try {
      const fileName = job.fileName ?? fallbackFileName(job);
      const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
      const fileHandle = picker
        ? await picker({
            suggestedName: fileName,
            types: [
              {
                description: `${job.format} export`,
                accept: {
                  [mimeTypeForFormat(job.format)]: [extensionForFormat(job.format)]
                }
              }
            ]
          })
        : null;

      const payload = await apiFetch<ExportContent>(`/exports/${job.id}/content`);
      const androidDownloads = (window as Window & { AndroidDownloads?: AndroidDownloadsBridge }).AndroidDownloads;
      if (androidDownloads?.saveBase64File(payload.base64, payload.mimeType, payload.fileName)) {
        pushToast('Choose where to save the export', 'success');
        return;
      }

      const blob = base64ToBlob(payload.base64, payload.mimeType);

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        saveWithTemporaryLink(blob, payload.fileName);
      }

      pushToast('Export saved', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      pushToast(error instanceof Error ? error.message : 'Export download failed', 'error');
    } finally {
      setDownloadingJobId(null);
    }
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId],
    );
  }

  function toggleAllJobs() {
    const deletableIds = jobs.filter(isDeletableJob).map((job) => job.id);
    const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selectedJobIds.includes(id));
    setSelectedJobIds(allSelected ? [] : deletableIds);
  }

  async function deleteSelectedJobs() {
    if (selectedJobIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedJobIds.length} selected export${selectedJobIds.length === 1 ? '' : 's'} and their generated files? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const result = await apiFetch<{ deletedCount: number }>('/exports', {
        method: 'DELETE',
        body: JSON.stringify({ ids: selectedJobIds })
      });
      setSelectedJobIds([]);
      pushToast(`Deleted ${result.deletedCount} export${result.deletedCount === 1 ? '' : 's'}`, 'success');
      await load();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not delete selected exports', 'error');
    } finally {
      setDeleting(false);
    }
  }

  const deletableJobs = jobs.filter(isDeletableJob);
  const allDeletableSelected =
    deletableJobs.length > 0 && deletableJobs.every((job) => selectedJobIds.includes(job.id));

  return (
    <>
      <PageHeader title="Exports" />
      <Panel className="mb-4">
        <PanelHeader title="New Export" />
        <form className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-7" onSubmit={submit}>
          <select
            value={form.format}
            onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {['PDF', 'CSV', 'EXCEL', 'JSON'].map((format) => (
              <option key={format} value={format}>
                {format}
              </option>
            ))}
          </select>
          <select
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {['FULL_STREAM', 'FILTERED_CHAT', 'USER_CHAT', 'DATE_RANGE'].map((type) => (
              <option key={type} value={type}>
                {type.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={form.streamId}
            onChange={(event) => setForm((current) => ({ ...current, streamId: event.target.value }))}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">All streams</option>
            {streams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.title ?? stream.videoId}
              </option>
            ))}
          </select>
          <input
            value={form.authorName}
            onChange={(event) => setForm((current) => ({ ...current, authorName: event.target.value }))}
            placeholder="Author"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            value={form.q}
            onChange={(event) => setForm((current) => ({ ...current, q: event.target.value }))}
            placeholder="Keyword"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <input
            type="datetime-local"
            value={form.from}
            aria-label="Start time (Pakistan Standard Time)"
            onChange={(event) => setForm((current) => ({ ...current, from: event.target.value }))}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={form.to}
              aria-label="End time (Pakistan Standard Time)"
              onChange={(event) => setForm((current) => ({ ...current, to: event.target.value }))}
              className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <Button type="submit" className="h-10 w-10 p-0" aria-label="Create export">
              <FileDown size={16} />
            </Button>
          </div>
        </form>
      </Panel>

      <Panel>
        <PanelHeader
          title="Jobs"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={() => void deleteSelectedJobs()}
                disabled={selectedJobIds.length === 0 || deleting}
              >
                <Trash2 size={15} />
                {deleting ? 'Deleting' : `Delete selected${selectedJobIds.length ? ` (${selectedJobIds.length})` : ''}`}
              </Button>
              <Button type="button" variant="secondary" onClick={() => void load()}>
                <RefreshCw size={15} />
                Refresh
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allDeletableSelected}
                    onChange={toggleAllJobs}
                    disabled={deletableJobs.length === 0}
                    aria-label="Select all finished exports"
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">File</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedJobIds.includes(job.id)}
                      onChange={() => toggleJob(job.id)}
                      disabled={!isDeletableJob(job)}
                      aria-label={`Select ${job.fileName ?? `${job.format} export`}`}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                  </td>
                  <td className="px-4 py-3">{job.format}</td>
                  <td className="px-4 py-3">{job.type.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3">
                    <Badge value={job.status} />
                    {job.errorMessage ? <div className="mt-1 text-xs text-red-600">{job.errorMessage}</div> : null}
                  </td>
                  <td className="px-4 py-3">{formatDate(job.createdAt)}</td>
                  <td className="px-4 py-3">
                    {job.status === 'COMPLETED' ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-3 text-xs"
                        disabled={downloadingJobId === job.id}
                        onClick={() => void downloadExport(job)}
                      >
                        <Download size={14} />
                        {downloadingJobId === job.id ? 'Downloading' : 'Download'}
                      </Button>
                    ) : (
                      <span className="text-slate-500">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function isDeletableJob(job: ExportJob) {
  return job.status !== 'PENDING' && job.status !== 'PROCESSING';
}

function fallbackFileName(job: ExportJob) {
  return `yt-chat-${job.id}${extensionForFormat(job.format)}`;
}

function extensionForFormat(format: string) {
  return (
    {
      CSV: '.csv',
      EXCEL: '.xlsx',
      JSON: '.json',
      PDF: '.pdf'
    }[format] ?? '.dat'
  );
}

function mimeTypeForFormat(format: string) {
  return (
    {
      CSV: 'text/csv',
      EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      JSON: 'application/json',
      PDF: 'application/pdf'
    }[format] ?? 'application/octet-stream'
  );
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function saveWithTemporaryLink(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
