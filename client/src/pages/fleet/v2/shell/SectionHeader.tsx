import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  actions?: ReactNode;
}

export function SectionHeader({ title, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline justify-between px-4 py-3 border-b border-rmpg-700">
      <h1 className="text-lg font-semibold text-rmpg-100">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
