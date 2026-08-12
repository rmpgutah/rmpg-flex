import React, { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

type Category = 'distance' | 'speed' | 'weight' | 'temperature';

const UNITS: Record<Category, { label: string; toBase: (v: number) => number; fromBase: (v: number) => number }[]> = {
  distance: [
    { label: 'Miles', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
    { label: 'Kilometers', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { label: 'Feet', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
    { label: 'Meters', toBase: v => v, fromBase: v => v },
  ],
  speed: [
    { label: 'MPH', toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
    { label: 'km/h', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
    { label: 'm/s', toBase: v => v, fromBase: v => v },
    { label: 'Knots', toBase: v => v * 0.514444, fromBase: v => v / 0.514444 },
  ],
  weight: [
    { label: 'Pounds', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
    { label: 'Kilograms', toBase: v => v, fromBase: v => v },
    { label: 'Ounces', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
    { label: 'Grams', toBase: v => v / 1000, fromBase: v => v * 1000 },
  ],
  temperature: [
    { label: '°F', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
    { label: '°C', toBase: v => v, fromBase: v => v },
    { label: 'K', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
  ],
};

const CATEGORIES: Category[] = ['distance', 'speed', 'weight', 'temperature'];

export default function UnitConverterPage() {
  const [cat, setCat] = useState<Category>('distance');
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [value, setValue] = useState('1');

  const units = UNITS[cat];
  const numVal = parseFloat(value);
  const result = isNaN(numVal) ? '' : String(parseFloat(units[toIdx].fromBase(units[fromIdx].toBase(numVal)).toFixed(8)));

  function swap() { setFromIdx(toIdx); setToIdx(fromIdx); setValue(result || '0'); }

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 12 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => { setCat(c); setFromIdx(0); setToIdx(1); setValue('1'); }}
            style={{ fontSize: 9, padding: '3px 8px', background: c === cat ? 'var(--brand-400)' : 'var(--surface-raised)', color: c === cat ? '#fff' : 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', textTransform: 'capitalize' }}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={{ flex: 1, fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}>
            {units.map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
          </select>
          <input type="number" value={value} onChange={e => setValue(e.target.value)} style={{ flex: 1, fontSize: 12, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <button type="button" onClick={swap} title="Swap" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <ArrowLeftRight className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={{ flex: 1, fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}>
            {units.map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
          </select>
          <div style={{ flex: 1, fontSize: 12, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{result}</div>
        </div>
      </div>
    </div>
  );
}
