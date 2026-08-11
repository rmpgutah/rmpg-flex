import React, { useState } from 'react';
import { Radio } from 'lucide-react';
import { useDesktopSystem } from '../../../context/DesktopSystemContext';

const CHANNELS = ['CH 1', 'CH 2', 'CH 3', 'CH 4', 'TAC 1', 'TAC 2', 'CMD', 'DISPATCH'];

export default function DesktopRadioChannelWidget() {
  const { radioChannel, setRadioChannel } = useDesktopSystem();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Radio className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>RADIO</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {radioChannel}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {CHANNELS.map(ch => (
            <button
              key={ch}
              type="button"
              onClick={() => { setRadioChannel(ch); setOpen(false); }}
              style={{ fontSize: 9, padding: '3px 6px', background: ch === radioChannel ? 'var(--brand-400)' : 'var(--surface-base)', color: ch === radioChannel ? '#fff' : 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}
            >
              {ch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
