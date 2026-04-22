// ============================================================
// RMPG Flex — Collapsible Section
// Expand/collapse wrapper for detail panel sections
// ============================================================

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ElementType;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export default function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
  actions,
  className = '',
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border border-[#2b2b2b] ${className}`} style={{ background: '#050505' }}>
      <button type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`${title} section${count !== undefined ? ` (${count})` : ''}`}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:brightness-110 transition-all"
        style={{ background: 'linear-gradient(180deg, #2b2b2b 0%, #262626 100%)', borderBottom: isOpen ? '1px solid #0c0c0c' : 'none' }}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
            style={{ color: '#d4a017' }}
          />
          {Icon && <Icon className="w-3.5 h-3.5" style={{ color: '#d4a017', filter: 'drop-shadow(0 0 3px rgba(212,160,23,0.3))' }} />}
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#d4a017', letterSpacing: '0.1em' }}>{title}</span>
          {count !== undefined && (
            <span className="text-[9px] font-mono tabular-nums" style={{ color: count > 0 ? '#86efac' : '#555555' }}>({count})</span>
          )}
        </div>
        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            {actions}
          </div>
        )}
      </button>
      {isOpen && (
        <div className="pb-3 px-2.5 pt-2 animate-fade-in" style={{ background: '#050505' }}>
          {children}
        </div>
      )}
    </div>
  );
}
