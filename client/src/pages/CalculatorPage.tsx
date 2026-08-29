import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  applyMemory, applyOp, applyUnary, backspaceDisplay, formatCalc, pursuitMiles,
  type CalcOp, type MemoryOp,
} from '../utils/cadCalculator';

export default function CalculatorPage() {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<CalcOp | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [fresh, setFresh] = useState(true);
  const [mem, setMem] = useState(0);
  const [mph, setMph] = useState('60');
  const [minutes, setMinutes] = useState('15');

  function input(v: string) {
    if (display === 'Error' || fresh) { setDisplay(v); setFresh(false); }
    else setDisplay((d) => (d === '0' ? v : d + v));
  }
  function decimal() {
    if (fresh || display === 'Error') { setDisplay('0.'); setFresh(false); return; }
    if (!display.includes('.')) setDisplay((d) => d + '.');
  }
  function setOperator(o: CalcOp) { setPrev(display); setOp(o); setFresh(true); }
  function calculate() {
    if (!prev || !op) return;
    const result = applyOp(parseFloat(prev), parseFloat(display), op);
    if (result === 'Error') {
      setDisplay('Error'); setFresh(true); setPrev(null); setOp(null); return;
    }
    const formatted = formatCalc(result);
    setHistory((h) => [`${prev} ${op} ${display} = ${formatted}`, ...h].slice(0, 12));
    setDisplay(formatted);
    setPrev(null); setOp(null); setFresh(true);
  }
  function clear() { setDisplay('0'); setPrev(null); setOp(null); setFresh(true); }
  function unary(kind: 'negate' | 'percent' | 'sqrt' | 'square' | 'reciprocal') {
    setDisplay(applyUnary(display, kind));
    setFresh(true);
  }
  function memory(kind: MemoryOp) {
    if (kind === 'MR') { setDisplay(formatCalc(mem) === 'Error' ? '0' : formatCalc(mem)); setFresh(true); return; }
    setMem(applyMemory(mem, display, kind));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') { input(e.key); return; }
      if (e.key === '.') { decimal(); return; }
      if (e.key === '+') { setOperator('+'); return; }
      if (e.key === '-') { setOperator('-'); return; }
      if (e.key === '*') { setOperator('×'); return; }
      if (e.key === '/') { e.preventDefault(); setOperator('÷'); return; }
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); calculate(); return; }
      if (e.key === 'Backspace') { setDisplay((d) => backspaceDisplay(d)); return; }
      if (e.key === 'Escape') { clear(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        navigator.clipboard.writeText(display).catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, prev, op, fresh, mem]);

  function btn(label: string, onClick: () => void, highlight = false) {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className="text-[13px] font-semibold py-2.5 border border-border-subtle rounded-[2px]"
        style={{
          background: highlight ? 'var(--brand-400)' : 'var(--surface-raised)',
          color: highlight ? 'var(--surface-base)' : 'var(--text-primary)',
        }}
      >
        {label}
      </button>
    );
  }

  const miles = pursuitMiles(parseFloat(mph), parseFloat(minutes));

  return (
    <div className="min-h-full bg-surface-base p-3 space-y-3">
      {history.length > 0 && (
        <div className="p-1.5 bg-surface-raised rounded-[2px] space-y-0.5">
          {history.map((h, i) => (
            <button
              key={`${h}-${i}`}
              type="button"
              className="block w-full text-left text-[8px] text-fg-muted font-mono hover:text-rmpg-100"
              onClick={() => { const rhs = h.split('=').pop()?.trim(); if (rhs) { setDisplay(rhs); setFresh(true); } }}
            >
              {h}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 text-[28px] font-light text-rmpg-100 text-right tabular-nums">{display}</div>
        <button type="button" title="Copy result" onClick={() => navigator.clipboard.writeText(display).catch(() => undefined)}>
          <Copy className="w-3.5 h-3.5 text-brand-400" />
        </button>
      </div>
      {mem !== 0 && <div className="text-[8px] text-[color:var(--panel-header-color)]">M {formatCalc(mem)}</div>}
      <div className="grid grid-cols-4 gap-1">
        {btn('MC', () => memory('MC'))} {btn('MR', () => memory('MR'))} {btn('M+', () => memory('M+'))} {btn('M-', () => memory('M-'))}
        {btn('√', () => unary('sqrt'))} {btn('x²', () => unary('square'))} {btn('1/x', () => unary('reciprocal'))} {btn('÷', () => setOperator('÷'), true)}
        {btn('AC', clear)} {btn('+/-', () => unary('negate'))} {btn('%', () => unary('percent'))} {btn('×', () => setOperator('×'), true)}
        {btn('7', () => input('7'))} {btn('8', () => input('8'))} {btn('9', () => input('9'))} {btn('-', () => setOperator('-'), true)}
        {btn('4', () => input('4'))} {btn('5', () => input('5'))} {btn('6', () => input('6'))} {btn('+', () => setOperator('+'), true)}
        {btn('⌫', () => setDisplay((d) => backspaceDisplay(d)))} {btn('0', () => input('0'))} {btn('.', decimal)} {btn('=', calculate, true)}
      </div>
      <div className="bg-surface-raised border border-border-subtle rounded-[2px] p-2 space-y-1">
        <div className="text-[9px] font-semibold tracking-wide text-[color:var(--field-label-color)]">PURSUIT DISTANCE</div>
        <div className="flex gap-2 items-center text-[11px]">
          <input type="number" value={mph} onChange={(e) => setMph(e.target.value)} aria-label="Speed MPH" className="w-16 bg-surface-sunken border border-border-subtle rounded-[2px] px-1 py-0.5 text-rmpg-100" />
          <span className="text-fg-muted">mph ×</span>
          <input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" className="w-16 bg-surface-sunken border border-border-subtle rounded-[2px] px-1 py-0.5 text-rmpg-100" />
          <span className="text-fg-muted">min =</span>
          <span className="font-mono text-rmpg-100">{Number.isFinite(miles) ? `${miles} mi` : '—'}</span>
          <button type="button" className="text-[9px] text-brand-400" onClick={() => { if (Number.isFinite(miles)) { setDisplay(String(miles)); setFresh(true); } }}>Use</button>
        </div>
      </div>
    </div>
  );
}
