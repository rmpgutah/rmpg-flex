import React, { useState } from 'react';
import { Minimize2, Maximize2, X } from 'lucide-react';

export type SpmTone = 'steel' | 'red' | 'gold' | 'amber' | 'blue' | 'green';

interface SpmGroupProps {
  title: string;
  tone?: SpmTone;
  className?: string;
  children: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  onClose?: () => void;
}

const TONE_COLORS: Record<string, string> = {
  steel: 'rgba(13,23,34,0.9)', red: 'rgba(80,20,20,0.9)', gold: 'rgba(60,40,5,0.9)',
  amber: 'rgba(60,40,5,0.9)', blue: 'rgba(10,30,50,0.9)', green: 'rgba(10,40,20,0.9)',
};

export default function SpmGroup({ title, tone = 'steel', className = '', children, onContextMenu, collapsible, defaultCollapsed, onCollapse, onClose }: SpmGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  };

  const borderColor = TONE_COLORS[tone] || TONE_COLORS.steel;

  return (
    <section className={`spm-group ${className}`.trim()} onContextMenu={onContextMenu}>
      <div className={`spm-group-head tone-${tone}`} style={{ borderBottomColor: borderColor }}>
        <span className="select-none whitespace-nowrap shrink-0">{title}</span>
        {(collapsible || onClose) && (
          <div className="ml-auto flex items-center gap-0.5">
            {collapsible && (
              <button type="button" onClick={toggle} className="text-rmpg-400 hover:text-rmpg-100 p-0.5" title={collapsed ? 'Expand' : 'Collapse'}>
                {collapsed ? <Maximize2 size={10} /> : <Minimize2 size={10} />}
              </button>
            )}
            {onClose && (
              <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-red-400 p-0.5" title="Close">
                <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>
      {!collapsed && <div className="spm-group-body">{children}</div>}
    </section>
  );
}
