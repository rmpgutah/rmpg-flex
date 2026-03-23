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
    <div className={className}>
      <button type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`${title} section${count !== undefined ? ` (${count})` : ''}`}
        className="w-full flex items-center justify-between panel-title-bar"
      >
        <div className="flex items-center gap-1.5">
          <ChevronRight
            className={`w-3 h-3 text-rmpg-400 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
          />
          {Icon && <Icon className="w-3 h-3 title-icon" />}
          <span>{title}</span>
          {count !== undefined && (
            <span className="text-micro text-rmpg-500 font-mono">({count})</span>
          )}
        </div>
        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            {actions}
          </div>
        )}
      </button>
      {isOpen && (
        <div className="pb-3 px-2 pt-2 animate-fade-in" style={{ background: 'rgba(10, 14, 20, 0.5)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
