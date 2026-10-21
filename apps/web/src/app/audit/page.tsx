'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel, PanelHeader } from '@/components/Panel';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AuditLog {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);

  const load = useCallback(async () => {
    const data = await apiFetch<{
      logs: AuditLog[];
      pagination: { pageCount: number };
    }>(`/audit?page=${page}&pageSize=50`);
    setLogs(data.logs);
    setPageCount(data.pagination.pageCount);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DashboardShell>
      <PageHeader title="Audit Logs" />
      <Panel>
        <PanelHeader title="Events" action={<Button variant="secondary" onClick={load}><RefreshCw size={15} />Refresh</Button>} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <td className="whitespace-nowrap px-4 py-3">{formatDate(log.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div>{log.user?.name ?? 'System'}</div>
                    <div className="text-xs text-slate-500">{log.user?.email}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{log.action}</td>
                  <td className="px-4 py-3">
                    <div>{log.entityType ?? 'n/a'}</div>
                    <div className="text-xs text-slate-500">{log.entityId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <pre className="max-w-xl overflow-auto rounded bg-slate-50 p-2 text-xs dark:bg-slate-950">
                      {JSON.stringify(log.metadata ?? {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            {page} / {pageCount}
          </span>
          <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
            Next
          </Button>
        </div>
      </Panel>
    </DashboardShell>
  );
}
