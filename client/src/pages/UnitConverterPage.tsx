import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Copy } from 'lucide-react';
import {
  CAD_PRESETS, CATEGORIES, UNITS, convertAll, convertValue, formatConverted,
  type UnitCategory,
} from '../utils/cadUnitConvert';

export default function UnitConverterPage() {
  const [cat, setCat] = useState<UnitCategory>('distance');
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [value, setValue] = useState('1');
  const [precision, setPrecision] = useState(4);
  const [log, setLog] = useState<string[]>([]);

  const units = UNITS[cat];
  const numVal = parseFloat(value);
  const result = formatConverted(convertValue(cat, fromIdx, toIdx, numVal), precision);
  const table = useMemo(() => convertAll(cat, fromIdx, numVal), [cat, fromIdx, numVal]);

  function swap() {
    setFromIdx(toIdx);
    setToIdx(fromIdx);
    setValue(result || '0');
  }

  function copyResult() {
    navigator.clipboard.writeText(`${value} ${units[fromIdx].label} = ${result} ${units[toIdx].label}`).catch(() => undefined);
    setLog((l) => [`${value} ${units[fromIdx].label} → ${result} ${units[toIdx].label}`, ...l].slice(0, 8));
  }

  function applyPreset(id: string) {
    const p = CAD_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setCat(p.cat);
    setFromIdx(p.fromIdx);
    setToIdx(p.toIdx);
    setValue(p.value);
  }

  return (
    <div className="min-h-full bg-surface-base p-3 space-y-3">
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setCat(c); setFromIdx(0); setToIdx(1); setValue('1'); }}
            className="text-[9px] px-2 py-1 capitalize rounded-[2px] border border-border-subtle"
            style={{
              background: c === cat ? 'var(--brand-400)' : 'var(--surface-raised)',
              color: c === cat ? 'var(--surface-base)' : 'var(--text-primary)',
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex gap-1 flex-wrap">
        {CAD_PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => applyPreset(p.id)} className="text-[8px] px-2 py-0.5 border border-border-subtle rounded-[2px] text-fg-muted">
            {p.label}
          </button>
        ))}
        <label className="ml-auto text-[8px] text-fg-muted flex items-center gap-1">
          Precision
          <select value={precision} onChange={(e) => setPrecision(Number(e.target.value))} className="bg-surface-sunken border border-border-subtle rounded-[2px] text-[10px] text-rmpg-100">
            {[2, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="bg-surface-raised border border-border-subtle rounded-[2px] p-2.5">
        <div className="flex items-center gap-2 mb-2">
          <select value={fromIdx} onChange={(e) => setFromIdx(Number(e.target.value))} className="flex-1 text-[10px] px-1.5 py-1 bg-surface-base border border-border-subtle rounded-[2px] text-rmpg-100">
            {units.map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
          </select>
          <input type="number" value={value} onChange={(e) => setValue(e.target.value)} aria-label="From value" className="flex-1 text-[12px] px-1.5 py-1 bg-surface-base border border-border-subtle rounded-[2px] text-rmpg-100" />
        </div>
        <div className="flex justify-center mb-2">
          <button type="button" onClick={swap} title="Swap" className="p-1">
            <ArrowLeftRight className="w-4 h-4 text-brand-400" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select value={toIdx} onChange={(e) => setToIdx(Number(e.target.value))} className="flex-1 text-[10px] px-1.5 py-1 bg-surface-base border border-border-subtle rounded-[2px] text-rmpg-100">
            {units.map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}
          </select>
          <div className="flex-1 text-[12px] px-1.5 py-1 bg-surface-base border border-border-subtle rounded-[2px] text-rmpg-100 tabular-nums">{result}</div>
          <button type="button" onClick={copyResult} title="Copy conversion">
            <Copy className="w-3.5 h-3.5 text-brand-400" />
          </button>
        </div>
      </div>

      <div className="bg-surface-raised border border-border-subtle rounded-[2px] overflow-hidden">
        <div className="text-[9px] font-semibold tracking-wide text-[color:var(--panel-header-color)] px-2 py-1 border-b border-border-subtle">ALL UNITS</div>
        {table.map((row) => (
          <button
            key={row.label}
            type="button"
            className="w-full flex justify-between px-2 py-1 text-[11px] text-rmpg-100 border-b border-border-subtle last:border-0 hover:bg-surface-sunken"
            onClick={() => { setToIdx(units.findIndex((u) => u.label === row.label)); }}
          >
            <span className="text-fg-muted">{row.label}</span>
            <span className="font-mono">{row.value}</span>
          </button>
        ))}
      </div>

      {log.length > 0 && (
        <div className="text-[8px] text-fg-muted font-mono space-y-0.5">
          {log.map((l, i) => <div key={`${l}-${i}`}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
