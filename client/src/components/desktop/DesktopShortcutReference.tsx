// ============================================================
// RMPG Flex — Desktop Shortcut Reference
// Floating panel listing all FlexOS keyboard shortcuts
// ============================================================

import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import { ALWAYS_ON_TOP_ZINDEX_OFFSET } from './FloatingWindow';

interface Shortcut {
  keys: string;
  description: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  // Window Management
  { keys: 'Win+Left', description: 'Snap window to left half', category: 'Window Management' },
  { keys: 'Win+Right', description: 'Snap window to right half', category: 'Window Management' },
  { keys: 'Win+Up', description: 'Maximize focused window', category: 'Window Management' },
  { keys: 'Win+Down', description: 'Restore / minimize focused window', category: 'Window Management' },
  { keys: 'Win+Z', description: 'Open Snap Layouts overlay', category: 'Window Management' },
  { keys: 'F11', description: 'Toggle full-screen mode', category: 'Window Management' },
  { keys: 'Ctrl+W', description: 'Close focused window', category: 'Window Management' },
  { keys: 'Alt+F4', description: 'Close focused window', category: 'Window Management' },
  { keys: 'Ctrl+Alt+C', description: 'Cascade all windows', category: 'Window Management' },
  { keys: 'Ctrl+Alt+H', description: 'Tile windows horizontally', category: 'Window Management' },
  { keys: 'Ctrl+Alt+V', description: 'Tile windows vertically', category: 'Window Management' },
  // Desktop
  { keys: 'Win+D', description: 'Show / hide desktop', category: 'Desktop' },
  { keys: 'Win+L', description: 'Lock screen', category: 'Desktop' },
  { keys: 'Win+S', description: 'Open launcher / search', category: 'Desktop' },
  { keys: 'Ctrl+L', description: 'Lock screen', category: 'Desktop' },
  { keys: 'Ctrl+,', description: 'Open Desktop Settings', category: 'Desktop' },
  { keys: 'Ctrl+Alt+Delete', description: 'Open Power Menu', category: 'Desktop' },
  { keys: 'Ctrl+I', description: 'Open System Dashboard', category: 'Desktop' },
  { keys: 'Win+/', description: 'Open Keyboard Shortcut Reference', category: 'Desktop' },
  // Navigation
  { keys: 'Alt+Tab', description: 'Switch between windows', category: 'Navigation' },
  { keys: 'Ctrl+`', description: 'Cycle through windows', category: 'Navigation' },
  { keys: 'Win+Ctrl+Left', description: 'Previous virtual desktop', category: 'Navigation' },
  { keys: 'Win+Ctrl+Right', description: 'Next virtual desktop', category: 'Navigation' },
];

const CATEGORIES = [...new Set(SHORTCUTS.map(s => s.category))];

interface Props {
  onClose: () => void;
}

export default function DesktopShortcutReference({ onClose }: Props) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? SHORTCUTS.filter(
        s =>
          s.keys.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      )
    : null;

  return (
    <div
      data-testid="shortcut-reference"
      style={{
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 520,
        maxHeight: 560,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 32px rgba(0 0 0 / 0.6)',
        zIndex: ALWAYS_ON_TOP_ZINDEX_OFFSET + 2500,
        borderRadius: 2,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-header-color)' }}>
          Keyboard Shortcuts
        </span>
        <button
          type="button"
          aria-label="Close shortcut reference"
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
        >
          <X className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Search */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Search className="w-3 h-3" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search shortcuts…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontSize: 10,
            color: 'var(--text-primary)',
          }}
        />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {filtered
          ? filtered.map(s => <ShortcutRow key={s.keys} shortcut={s} showCategory />)
          : CATEGORIES.map(cat => (
              <div key={cat}>
                <div
                  style={{
                    padding: '6px 14px 2px',
                    fontSize: 9,
                    fontWeight: 600,
                    color: 'var(--field-label-color)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {cat}
                </div>
                {SHORTCUTS.filter(s => s.category === cat).map(s => (
                  <ShortcutRow key={s.keys} shortcut={s} />
                ))}
              </div>
            ))}
      </div>
    </div>
  );
}

function ShortcutRow({ shortcut, showCategory }: { shortcut: Shortcut; showCategory?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 14px',
        borderBottom: '1px solid rgba(195,204,214,0.04)',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
        {showCategory && (
          <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>{shortcut.category} —</span>
        )}
        {shortcut.description}
      </span>
      <kbd
        style={{
          fontSize: 9,
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text-primary)',
          background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.6)',
          border: '1px solid var(--border-subtle)',
          padding: '1px 5px',
          flexShrink: 0,
          borderRadius: 2,
        }}
      >
        {shortcut.keys}
      </kbd>
    </div>
  );
}
