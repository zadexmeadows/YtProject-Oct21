import { clsx } from 'clsx';
import { statusTone } from '@/lib/format';

export function Badge({ value }: { value: string }) {
  const tone = statusTone(value);
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-2 py-1 text-xs font-medium',
        tone === 'green' && 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
        tone === 'amber' && 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        tone === 'red' && 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
        tone === 'blue' && 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
        tone === 'slate' && 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
