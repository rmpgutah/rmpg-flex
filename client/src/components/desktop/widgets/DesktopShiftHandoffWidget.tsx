import React, { useState, useEffect } from 'react';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';

interface Item { id: string; label: string; done: boolean; }

const DEFAULT_ITEMS: Item[] = [
  { id: 'vehicle',   label: 'Vehicle inspected & fueled',   done: false },
  { id: 'equipment', label: 'Equipment accounted for',       done: false },
  { id: 'reports',   label: 'All reports completed',         done: false },
  { id: 'evidence',  label: 'Evidence properly tagged',      done: false },
  { id: 'calls',     label: 'Open calls handed off',         done: false },
  { id: 'mdt',       label: 'MDT status updated',            done: false },
  { id: 'notes',     label: 'Shift notes written',           done: false },
  { id: 'bodycam',   label: 'Body cam docked & charging',    done: false },
];

function todayMT(): string {
  // Always use Mountain Time so the key is consistent across machines in different timezones
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function todayKey(): string {
  return `rmpg_handoff_${todayMT()}`;
}

function shiftDateLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function loadItems(): Item[] {
  try {
    const raw = sessionStorage.getItem(todayKey());
    if (!raw) return DEFAULT_ITEMS.map(i => ({ ...i }));
    const parsed: Item[] = JSON.parse(raw);
    // merge to ensure any new ids from DEFAULT_ITEMS are present
    const map = new Map(parsed.map(i => [i.id, i]));
    return DEFAULT_ITEMS.map(def => map.get(def.id) ?? { ...def });
  } catch {
    return DEFAULT_ITEMS.map(i => ({ ...i }));
  }
}

function saveItems(items: Item[]): void {
  try { sessionStorage.setItem(todayKey(), JSON.stringify(items)); } catch { /* quota */ }
}

export default function DesktopShiftHandoffWidget() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>(loadItems);

  // reload if date changes mid-session
  useEffect(() => {
    const id = setInterval(() => {
      setItems(prev => {
        const fresh = loadItems();
        // only reset if key changed (new day) — compare stored key via a side-channel flag
        const stored = sessionStorage.getItem(todayKey());
        if (!stored) return fresh; // new day, start fresh
        return prev;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const doneCount = items.filter(i => i.done).length;
  const total = items.length;
  const allDone = doneCount === total;
  const pct = Math.round((doneCount / total) * 100);

  const officerName: string = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Officer'
    : 'Officer';

  function toggle(id: string) {
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, done: !i.done } : i);
      saveItems(next);
      return next;
    });
  }

  function reset() {
    const fresh = DEFAULT_ITEMS.map(i => ({ ...i }));
    saveItems(fresh);
    setItems(fresh);
  }

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <ClipboardCheck
          style={{ width: 11, height: 11, color: allDone ? 'var(--sev-ok)' : 'var(--field-label-color)', flexShrink: 0 }}
        />
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
          Handoff
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: allDone ? 'var(--sev-ok)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {doneCount}/{total}
        </span>
        <button
          onClick={reset}
          title="Reset checklist"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 4,
            color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
          }}
        >
          <RotateCcw style={{ width: 9, height: 9 }} />
        </button>
      </div>

      {/* Officer + date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 8, color: 'var(--text-secondary)', fontWeight: 500 }}>{officerName}</span>
        <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{shiftDateLabel()}</span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3, borderRadius: 2, background: 'var(--surface-sunken)',
        marginBottom: 6, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: allDone ? 'var(--sev-ok)' : 'var(--brand-400)',
          transition: 'width 0.25s ease, background 0.25s ease',
        }} />
      </div>

      {/* Checklist — max 4 visible, scroll for rest */}
      <div style={{ maxHeight: 72, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => toggle(item.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none', padding: '1px 0' }}
          >
            {/* Checkbox */}
            <span style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              border: `1px solid ${item.done ? 'var(--sev-ok)' : 'var(--border-subtle)'}`,
              background: item.done ? 'var(--sev-ok)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}>
              {item.done && <span style={{ color: '#fff', fontSize: 7, lineHeight: 1, fontWeight: 700 }}>✓</span>}
            </span>
            {/* Label */}
            <span style={{
              fontSize: 9,
              color: item.done ? 'var(--text-secondary)' : 'var(--text-primary)',
              textDecoration: item.done ? 'line-through' : 'none',
              transition: 'color 0.15s ease',
            }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Completion banner */}
      {allDone && (
        <div style={{
          marginTop: 7, borderRadius: 2, padding: '4px 6px', textAlign: 'center',
          background: 'rgba(34,197,94,0.15)', border: '1px solid var(--sev-ok)',
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--sev-ok)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Shift Handoff Complete
          </span>
        </div>
      )}
    </div>
  );
}
