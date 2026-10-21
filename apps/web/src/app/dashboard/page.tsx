'use client';

import { DashboardShell } from '@/components/DashboardShell';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';

export default function DashboardPage() {
  return (
    <DashboardShell>
      <PageHeader
        title="Dashboard"
        subtitle="Use the sidebar to open live chat, streams, user intelligence, and exports."
      />

      <Panel className="p-6">
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
          Live Chat Intelligence
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          Dashboard statistics are disabled to keep the server responsive. Live-chat capture and all
          user intelligence calculations continue to run normally.
        </p>
      </Panel>
    </DashboardShell>
  );
}
