import React, { useState } from 'react';

interface Props {
  onNew?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onFind?: () => void;
}

interface MenuItem { label: string; onClick?: () => void; }

export default function SpillmanMenuBar({ onNew, onPrint, onExport, onFind }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New', onClick: onNew },
      { label: 'Print', onClick: onPrint },
      { label: 'Export', onClick: onExport },
    ],
    Edit: [{ label: 'Find', onClick: onFind }],
    View: [],
    Record: [],
    Tools: [],
    Window: [],
    Help: [],
  };

  return (
    <div className="spm-menubar" role="menubar" onMouseLeave={() => setOpen(null)}>
      {Object.keys(menus).map((name) => (
        <div key={name} className="spm-menu">
          <button
            type="button"
            className="spm-menu-label"
            aria-haspopup="true"
            aria-expanded={open === name}
            onClick={() => setOpen(open === name ? null : name)}
          >
            {name}
          </button>
          {open === name && menus[name].length > 0 && (
            <div className="spm-menu-dropdown" role="menu">
              {menus[name].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className="spm-menu-item"
                  onClick={() => { item.onClick?.(); setOpen(null); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
