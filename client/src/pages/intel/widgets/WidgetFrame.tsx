import type { ReactNode } from 'react';

export default function WidgetFrame({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="border border-border-default bg-surface-overlay rounded-[2px]">
      <div className="flex items-center gap-[7px] px-[10px] py-[8px] border-b border-border-default">
        <span className="font-mono text-[9px] tracking-wide text-rmpg-200 uppercase font-bold">{title}</span>
        {note && <span className="ml-auto font-mono text-[9px] text-[#d4a017]">{note}</span>}
      </div>
      <div className="px-[10px] py-[8px]">{children}</div>
    </div>
  );
}
