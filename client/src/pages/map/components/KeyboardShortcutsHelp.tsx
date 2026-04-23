// ============================================================
// RMPG Flex — Keyboard Shortcuts Help Overlay
// Modal popup listing the single-key overlay toggles available
// on the map. Triggered by pressing `?` (wired by the shortcuts
// hook that calls showHelp()). Dismissed by Escape, clicking
// outside, or the × button.
//
// Kept deliberately small — dispatchers don't read a manual,
// they scan the list, press the key, move on.
// ============================================================

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { MAP_SHORTCUT_BINDINGS } from '../../../hooks/useMapKeyboardShortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsHelp({ open, onClose }: Props) {
  // Escape closes, just like every modal in the app. Don't swallow keys
  // when the modal isn't showing so other shortcuts keep working.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-help-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0c0c0c',
          border: '1px solid #2b2b2b',
          borderRadius: 2,
          padding: '16px 20px',
          minWidth: 320,
          maxWidth: 420,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            borderBottom: '1px solid #2b2b2b',
            paddingBottom: 8,
          }}
        >
          <span
            id="kbd-help-title"
            style={{ fontSize: 11, color: '#d4a017', fontWeight: 900, letterSpacing: '0.15em' }}
          >
            MAP SHORTCUTS
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts help"
            style={{
              background: 'none',
              border: 'none',
              color: '#888888',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {MAP_SHORTCUT_BINDINGS.map(({ key, label }) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 11,
                color: '#d1d5db',
              }}
            >
              <kbd
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 24,
                  height: 22,
                  background: '#141414',
                  border: '1px solid #2b2b2b',
                  borderBottom: '2px solid #333',
                  borderRadius: 2,
                  fontSize: 11,
                  fontWeight: 900,
                  color: '#d4a017',
                  fontFamily: 'inherit',
                  padding: '0 6px',
                }}
              >
                {key}
              </kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, borderTop: '1px solid #2b2b2b', paddingTop: 8, fontSize: 9, color: '#6b7280' }}>
          Shortcuts are ignored when a text field is focused or a modifier key (Cmd / Ctrl / Alt) is held.
        </div>
      </div>
    </div>
  );
}
