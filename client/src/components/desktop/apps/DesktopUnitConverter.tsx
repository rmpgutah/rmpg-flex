import React, { useState, useCallback } from 'react';
import { X, Ruler, Copy, RotateCcw } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';

const W = 420;
const H = 480;

interface DesktopUnitConverterProps {
  onClose: () => void;
}

type Category = 'speed' | 'distance' | 'weight' | 'temperature';

// Each category defines a canonical base unit and conversion factors to/from it.
// All values are converted to/from the base unit when any field changes.

interface UnitDef {
  label: string;
  symbol: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const CATEGORIES: Record<Category, { label: string; units: UnitDef[] }> = {
  speed: {
    label: 'Speed',
    units: [
      { label: 'Miles per hour', symbol: 'mph', toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
      { label: 'Kilometers per hour', symbol: 'km/h', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
      { label: 'Feet per second', symbol: 'ft/s', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
    ],
  },
  distance: {
    label: 'Distance',
    units: [
      { label: 'Miles', symbol: 'mi', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
      { label: 'Kilometers', symbol: 'km', toBase: v => v * 1000, fromBase: v => v / 1000 },
      { label: 'Feet', symbol: 'ft', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
      { label: 'Meters', symbol: 'm', toBase: v => v, fromBase: v => v },
    ],
  },
  weight: {
    label: 'Weight',
    units: [
      { label: 'Pounds', symbol: 'lbs', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
      { label: 'Kilograms', symbol: 'kg', toBase: v => v, fromBase: v => v },
      { label: 'Ounces', symbol: 'oz', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
      { label: 'Grams', symbol: 'g', toBase: v => v / 1000, fromBase: v => v * 1000 },
    ],
  },
  temperature: {
    label: 'Temperature',
    units: [
      { label: 'Fahrenheit', symbol: '°F', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
      { label: 'Celsius', symbol: '°C', toBase: v => v, fromBase: v => v },
      { label: 'Kelvin', symbol: 'K', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
    ],
  },
};

function fmtNum(n: number): string {
  if (!isFinite(n)) return '';
  const s = parseFloat(n.toPrecision(10)).toString();
  return s;
}

function copyText(text: string) {
  const api = (window as unknown as Record<string, unknown>).electron as { setClipboardText?: (t: string) => void } | undefined;
  if (api?.setClipboardText) { api.setClipboardText(text); }
  else { navigator.clipboard.writeText(text).catch(() => {}); }
}

export default function DesktopUnitConverter({ onClose }: DesktopUnitConverterProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [cat, setCat] = useState<Category>('speed');
  const [values, setValues] = useState<string[]>(() => new Array(CATEGORIES.speed.units.length).fill(''));
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const switchCat = useCallback((c: Category) => {
    setCat(c);
    setValues(new Array(CATEGORIES[c].units.length).fill(''));
  }, []);

  const handleChange = useCallback((idx: number, raw: string) => {
    const units = CATEGORIES[cat].units;
    const n = parseFloat(raw);
    if (raw === '' || raw === '-' || isNaN(n)) {
      setValues(new Array(units.length).fill(''));
      return;
    }
    const base = units[idx].toBase(n);
    setValues(units.map((u, i) => i === idx ? raw : fmtNum(u.fromBase(base))));
  }, [cat]);

  const handleCopy = useCallback((idx: number) => {
    copyText(values[idx]);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1200);
  }, [values]);

  const handleClear = useCallback(() => {
    setValues(new Array(CATEGORIES[cat].units.length).fill(''));
  }, [cat]);

  const units = CATEGORIES[cat].units;
  const catKeys = Object.keys(CATEGORIES) as Category[];

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '5px 8px', fontSize: 14, background: 'var(--surface-sunken)',
    border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
    borderRadius: 2, outline: 'none', fontVariantNumeric: 'tabular-nums', fontFamily: 'Arial, sans-serif',
  };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Ruler size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Unit Converter</span>
        <button aria-label="Close Unit Converter" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {catKeys.map(k => (
          <button key={k} type="button" onClick={() => switchCat(k)} style={{
            flex: 1, padding: '6px 0', fontSize: 10, fontWeight: cat === k ? 700 : 400,
            color: cat === k ? 'var(--text-primary)' : 'var(--text-muted)',
            background: 'none', border: 'none',
            borderBottom: cat === k ? '2px solid var(--brand-400)' : '2px solid transparent',
            cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {CATEGORIES[k].label}
          </button>
        ))}
      </div>

      {/* Fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {units.map((u, i) => (
            <div key={u.symbol} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {u.label} ({u.symbol})
              </label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="number"
                  value={values[i]}
                  onChange={e => handleChange(i, e.target.value)}
                  placeholder="0"
                  style={inputStyle}
                />
                <button
                  aria-label={`Copy ${u.symbol} value`}
                  onClick={() => handleCopy(i)}
                  style={{ padding: 5, background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: copiedIdx === i ? 'var(--brand-400)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
                >
                  <Copy size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0 }}>
        <button onClick={handleClear} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <RotateCcw size={10} /> Clear
        </button>
      </div>
    </div>
  );
}
