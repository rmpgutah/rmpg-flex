import React, { useState, useEffect, useRef } from 'react';
import { getDeletedIcons, emptyRecycleBin, restoreDeletedIcon, type DeletedIcon } from '../../utils/recycleBinPreferences';

interface DesktopRecycleBinProps {
  /** Called when an icon is restored from the bin so DesktopPage can re-pin it. */
  onRestore: (path: string, label: string) => void;
}

function TrashIcon({ full }: { full: boolean }) {
  return (
    <svg viewBox="0 0 32 32" width={36} height={36} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Lid */}
      <rect x={6} y={4} width={20} height={3} rx={1} fill="var(--accent-silver-400)" />
      {/* Handle */}
      <rect x={13} y={2} width={6} height={3} rx={1} fill="var(--accent-silver-400)" />
      {/* Body */}
      <rect x={8} y={8} width={16} height={20} rx={2} fill="var(--surface-raised)" stroke="var(--accent-silver-400)" strokeWidth={1.5} />
      {/* Lines indicating trash content */}
      {full && (
        <>
          <line x1={13} y1={12} x2={13} y2={24} stroke="var(--text-muted)" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={16} y1={11} x2={16} y2={25} stroke="var(--text-muted)" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={19} y1={12} x2={19} y2={24} stroke="var(--text-muted)" strokeWidth={1.5} strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export default function DesktopRecycleBin({ onRestore }: DesktopRecycleBinProps) {
  const [items, setItems] = useState<DeletedIcon[]>(() => getDeletedIcons());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, forceRerender] = useState(0);

  // Refresh the item list whenever the component re-renders due to icon deletion externally.
  useEffect(() => {
    setItems(getDeletedIcons());
  });

  // Close context menu / popover on outside click.
  useEffect(() => {
    if (!contextMenu && !popoverOpen) return;
    function dismiss(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [contextMenu, popoverOpen]);

  const full = items.length > 0;

  function handleRestoreAll() {
    const current = getDeletedIcons();
    current.forEach(i => {
      restoreDeletedIcon(i.path);
      onRestore(i.path, i.label);
    });
    setItems([]);
    setContextMenu(null);
    setPopoverOpen(false);
    forceRerender(n => n + 1);
  }

  function handleEmpty() {
    emptyRecycleBin();
    setItems([]);
    setContextMenu(null);
    setPopoverOpen(false);
    forceRerender(n => n + 1);
  }

  function handleRestoreOne(path: string, label: string) {
    restoreDeletedIcon(path);
    setItems(getDeletedIcons());
    onRestore(path, label);
    forceRerender(n => n + 1);
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none', cursor: 'default', width: 72 }}
    >
      {/* Recycle Bin icon — double-click opens popover, right-click opens context menu */}
      <div
        onDoubleClick={() => { setContextMenu(null); setPopoverOpen(v => !v); }}
        onContextMenu={e => { e.preventDefault(); setPopoverOpen(false); setContextMenu({ x: e.clientX, y: e.clientY }); }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 6px', borderRadius: 2 }}
        title={full ? `Recycle Bin (${items.length} item${items.length !== 1 ? 's' : ''})` : 'Recycle Bin (empty)'}
        role="button"
        tabIndex={0}
        aria-label={full ? `Recycle Bin, ${items.length} items` : 'Recycle Bin, empty'}
        onKeyDown={e => { if (e.key === 'Enter') setPopoverOpen(v => !v); }}
      >
        <TrashIcon full={full} />
        <span style={{ fontSize: 10, color: 'var(--text-primary)', marginTop: 4, textAlign: 'center' }}>Recycle Bin</span>
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
            boxShadow: '0 8px 24px rgba(0 0 0 / 0.5)', zIndex: 20000, minWidth: 160, padding: '4px 0',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={!full}
            onClick={handleRestoreAll}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 16px', fontSize: 11, background: 'none', border: 'none', cursor: full ? 'pointer' : 'default', color: full ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            Restore All
          </button>
          <button
            type="button"
            disabled={!full}
            onClick={handleEmpty}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 16px', fontSize: 11, background: 'none', border: 'none', cursor: full ? 'pointer' : 'default', color: full ? 'var(--sev-critical)' : 'var(--text-muted)' }}
          >
            Empty Recycle Bin
          </button>
        </div>
      )}

      {/* Double-click popover — list of deleted icons */}
      {popoverOpen && (
        <div
          style={{
            position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--surface-raised)', border: '1px solid var(--border-strong)',
            boxShadow: '0 8px 24px rgba(0 0 0 / 0.5)', zIndex: 20000, minWidth: 220, padding: '8px 0',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div style={{ padding: '4px 12px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border-subtle)' }}>
            Recycle Bin
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)' }}>No deleted icons</div>
          ) : (
            <>
              {items.map(icon => (
                <div
                  key={icon.path}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', gap: 8 }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {icon.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRestoreOne(icon.path, icon.label)}
                    style={{ fontSize: 10, color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 6px', flexShrink: 0 }}
                  >
                    Restore
                  </button>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
              <button
                type="button"
                onClick={handleEmpty}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sev-critical)' }}
              >
                Empty Recycle Bin
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
