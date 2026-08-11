import React, { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

interface Item { id: string; label: string; done: boolean; }

const DEFAULT_ITEMS: Item[] = [
  { id: '1', label: 'Complete incident reports', done: false },
  { id: '2', label: 'Upload body-cam footage', done: false },
  { id: '3', label: 'Clear all active calls', done: false },
  { id: '4', label: 'Fuel check', done: false },
  { id: '5', label: 'Submit DAR', done: false },
];

function loadItems(): Item[] {
  try {
    const raw = sessionStorage.getItem('rmpg_shift_handoff');
    return raw ? JSON.parse(raw) : DEFAULT_ITEMS;
  } catch { return DEFAULT_ITEMS; }
}

export default function DesktopShiftHandoffWidget() {
  const [items, setItems] = useState<Item[]>(loadItems);
  const done = items.filter(i => i.done).length;
  const allDone = done === items.length;

  function toggle(id: string) {
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, done: !i.done } : i);
      try { sessionStorage.setItem('rmpg_shift_handoff', JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <ClipboardCheck className="w-3 h-3" style={{ color: allDone ? 'var(--sev-ok, #22c55e)' : 'var(--brand-400)' }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>SHIFT HANDOFF</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: allDone ? 'var(--sev-ok, #22c55e)' : 'var(--text-secondary)' }}>{done}/{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => toggle(item.id)}>
            <span style={{ width: 10, height: 10, borderRadius: 2, border: `1px solid ${item.done ? 'var(--sev-ok, #22c55e)' : 'var(--border-subtle)'}`, background: item.done ? 'var(--sev-ok, #22c55e)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {item.done && <span style={{ color: '#fff', fontSize: 7, lineHeight: 1 }}>✓</span>}
            </span>
            <span style={{ fontSize: 9, color: item.done ? 'var(--text-secondary)' : 'var(--text-primary)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
