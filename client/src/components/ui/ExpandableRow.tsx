// ═══════════════════════════════════════════════════════════════
// Feature 26: Expandable Row Details
// Click table row to expand inline detail panel
// ═══════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ExpandableRowProps {
  cells: React.ReactNode[];
  detail: React.ReactNode;
  className?: string;
  onToggle?: (expanded: boolean) => void;
}

export function ExpandableRow({ cells, detail, className = '', onToggle }: ExpandableRowProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    setExpanded(prev => {
      const next = !prev;
      onToggle?.(next);
      return next;
    });
  };

  return (
    <>
      <tr
        onClick={toggle}
        className={`cursor-pointer hover:bg-surface-raised transition-colors ${expanded ? 'bg-surface-raised' : ''} ${className}`}
      >
        <td className="px-2 py-2 w-6">
          {expanded
            ? <ChevronDown className="w-3 h-3 text-brand-400" />
            : <ChevronRight className="w-3 h-3 text-rmpg-500" />
          }
        </td>
        {cells.map((cell, i) => (
          <td key={i} className="px-3 py-2 text-xs text-rmpg-200">
            {cell}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={cells.length + 1} className="p-0">
            <div className="bg-surface-sunken border-t border-b border-[#2b2b2b] px-6 py-3 animate-fade-in">
              {detail}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
