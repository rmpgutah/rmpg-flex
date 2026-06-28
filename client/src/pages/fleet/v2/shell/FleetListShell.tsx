import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { SectionHeader } from './SectionHeader';

export interface FleetListShellProps {
  title: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}

/** Stub for PR 7'a — title + search + actions slot + children area.
 *  PR 7'b adds: filter chips, sort dropdown, server-side pagination, CSV export. */
export function FleetListShell({ title, searchPlaceholder, onSearchChange, actions, children }: FleetListShellProps) {
  return (
    <div className="flex flex-col h-full">
      <SectionHeader title={title} actions={actions} />
      <div className="px-4 py-2 border-b border-rmpg-700 bg-surface-base flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-rmpg-400" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 bg-transparent text-[11px] text-rmpg-100 placeholder:text-rmpg-500 outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
