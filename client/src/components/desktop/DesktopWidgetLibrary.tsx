// client/src/components/desktop/DesktopWidgetLibrary.tsx
import React, { useEffect, useRef } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { ALL_WIDGET_IDS } from '../../utils/normalizeDesktopWidgets';
import type { DesktopWidgetState } from '../../utils/normalizeDesktopWidgets';

interface WidgetDisplayInfo {
  name: string;
  description: string;
}

export const WIDGET_DISPLAY_INFO: Record<string, WidgetDisplayInfo> = {
  'clock':             { name: 'Clock',                    description: 'Digital clock with date display' },
  'ops-summary':       { name: 'Live Ops Summary',         description: 'Active calls, unit count, and shift snapshot' },
  'notifications':     { name: 'Notifications',            description: 'Recent system alerts and messages' },
  'quick-access':      { name: 'Quick Access',             description: 'Pinned shortcuts and frequently used modules' },
  'shift-timer':       { name: 'Shift Timer',              description: 'Elapsed time since shift start' },
  'pinned-call-ticker':{ name: 'Pinned Call Ticker',       description: 'Scrolling list of pinned active calls' },
  'mini-map':          { name: 'Mini Map',                 description: 'Live patrol unit positions on a compact map' },
  'weather':           { name: 'Weather / Conditions',     description: 'Current weather and visibility conditions' },
  'radio-channel':     { name: 'Radio Channel',            description: 'Active radio channel and talkgroup status' },
  'roll-call':         { name: 'Roll Call',                description: 'Officer sign-in and unit status board' },
  'incident-timer':    { name: 'Incident Timer',           description: 'Elapsed time for the active incident' },
  'gps-trail':         { name: 'GPS Trail',                description: 'Recent GPS track for your assigned unit' },
  'shift-handoff':     { name: 'Shift Handoff Checklist',  description: 'End-of-shift task checklist for outgoing officer' },
  'panic':             { name: 'Panic / Duress',           description: 'One-tap panic and silent duress alert button' },
  'warrant-count':     { name: 'Warrant Count',            description: 'Open warrant count for the current jurisdiction' },
  'body-cam':          { name: 'Body Camera',              description: 'Live body camera status and quick controls' },
  'message-count':     { name: 'Message Count',            description: 'Unread message count with quick-open link' },
};

export interface DesktopWidgetLibraryProps {
  widgets: DesktopWidgetState[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export default function DesktopWidgetLibrary({ widgets, onAdd, onRemove, onClose }: DesktopWidgetLibraryProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const activeIds = new Set(widgets.filter(w => w.on).map(w => w.id));

  // Dismiss on click-outside
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  // Dismiss on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: 80,
        right: 24,
        width: 340,
        maxHeight: 'calc(100vh - 120px)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px rgba(0 0 0 / 0.45)',
        zIndex: 2100,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px', background: 'var(--surface-overlay)',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
          Widget Library
        </span>
        <button type="button" onClick={onClose} aria-label="Close widget library"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-secondary)', lineHeight: 1 }}>
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* List */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {ALL_WIDGET_IDS.map(id => {
          const info = WIDGET_DISPLAY_INFO[id] ?? { name: id, description: '' };
          const isActive = activeIds.has(id);
          return (
            <div
              key={id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                background: isActive ? 'rgba(var(--rmpg-500-rgb),0.08)' : 'transparent',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {info.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {info.description}
                </div>
              </div>
              <button
                type="button"
                aria-label={isActive ? `Remove ${info.name} widget` : `Add ${info.name} widget`}
                onClick={() => isActive ? onRemove(id) : onAdd(id)}
                style={{
                  flexShrink: 0,
                  width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? 'rgba(var(--rmpg-500-rgb),0.2)' : 'var(--surface-sunken)',
                  border: `1px solid ${isActive ? 'var(--accent-silver-500)' : 'var(--border-default)'}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent-silver-400)' : 'var(--text-secondary)',
                }}
              >
                {isActive
                  ? <Check style={{ width: 12, height: 12 }} />
                  : <Plus style={{ width: 12, height: 12 }} />
                }
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
