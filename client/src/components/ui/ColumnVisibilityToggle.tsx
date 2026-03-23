// ═══════════════════════════════════════════════════════════════
// Feature 27: Column Visibility Toggle
// Let users show/hide table columns
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef, useEffect } from 'react';
import { Columns, Eye, EyeOff } from 'lucide-react';

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
  locked?: boolean; // Cannot be hidden
}

interface ColumnVisibilityToggleProps {
  columns: ColumnDef[];
  onChange: (columns: ColumnDef[]) => void;
  className?: string;
}

export default function ColumnVisibilityToggle({ columns, onChange, className = '' }: ColumnVisibilityToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggleColumn = (key: string) => {
    onChange(columns.map(col =>
      col.key === key && !col.locked ? { ...col, visible: !col.visible } : col
    ));
  };

  const showAll = () => onChange(columns.map(col => ({ ...col, visible: true })));

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button"
        onClick={() => setOpen(!open)}
        className="toolbar-btn text-[10px] flex items-center gap-1"
        title="Toggle columns"
      >
        <Columns className="w-3 h-3" />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface-base border border-[#2a3e58] shadow-xl py-1">
          <div className="px-3 py-1.5 border-b border-[#1e3048] flex items-center justify-between">
            <span className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Columns</span>
            <button type="button" onClick={showAll} className="text-[9px] text-brand-400 hover:text-brand-300">Show All</button>
          </div>
          {columns.map(col => (
            <button type="button"
              key={col.key}
              onClick={() => toggleColumn(col.key)}
              disabled={col.locked}
              className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                col.locked ? 'text-rmpg-500 cursor-not-allowed' : 'text-rmpg-200 hover:bg-surface-raised'
              }`}
            >
              {col.visible
                ? <Eye className="w-3 h-3 text-green-400" />
                : <EyeOff className="w-3 h-3 text-rmpg-600" />
              }
              <span className={col.visible ? '' : 'line-through text-rmpg-600'}>{col.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
