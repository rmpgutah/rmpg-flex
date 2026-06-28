import React, { useState, useEffect } from 'react';

export interface MenuItem { label: string; onClick?: () => void; }
export interface MenuSpec { name: string; items: MenuItem[]; }

/** Config-driven Spillman menu bar. Menus with no actionable item still show
 *  a (disabled-feeling) label but never open an empty dropdown. */
export default function SpillmanMenuBar({ menus }: { menus: MenuSpec[] }) {
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div
      className="spm-menubar"
      role="menubar"
      onMouseLeave={() => setOpen(null)}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(null); }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menus.map(({ name, items }) => {
        const live = items.filter((i) => typeof i.onClick === 'function');
        const has = live.length > 0;
        return (
          <div key={name} className="spm-menu">
            <button
              type="button"
              className="spm-menu-label"
              aria-haspopup={has ? 'true' : undefined}
              aria-expanded={has ? open === name : undefined}
              onClick={() => { if (has) setOpen(open === name ? null : name); }}
            >
              {name}
            </button>
            {open === name && has && (
              <div className="spm-menu-dropdown" role="menu">
                {live.map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    role="menuitem"
                    className="spm-menu-item"
                    onClick={() => { i.onClick?.(); setOpen(null); }}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
