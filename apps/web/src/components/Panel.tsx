import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      {...props}
      className={clsx(
        'app-panel rounded-lg border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    />
  );
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'app-panel-header flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800',
        className,
      )}
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {action}
    </div>
  );
}
