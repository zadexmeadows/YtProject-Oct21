import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' &&
          'bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500',
        variant === 'secondary' &&
          'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
        variant === 'danger' &&
          'bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500',
        variant === 'ghost' &&
          'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
        className,
      )}
    />
  );
}
