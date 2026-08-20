import React, { useState } from 'react';

export default function CalculatorPage() {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [fresh, setFresh] = useState(true);

  function input(v: string) {
    if (fresh) { setDisplay(v); setFresh(false); }
    else setDisplay(d => d === '0' ? v : d + v);
  }
  function decimal() {
    if (fresh) { setDisplay('0.'); setFresh(false); return; }
    if (!display.includes('.')) setDisplay(d => d + '.');
  }
  function setOperator(o: string) { setPrev(display); setOp(o); setFresh(true); }
  function calculate() {
    if (!prev || !op) return;
    const a = parseFloat(prev), b = parseFloat(display);
    let result: number;
    if (op === '+') result = a + b;
    else if (op === '-') result = a - b;
    else if (op === '×') result = a * b;
    else if (op === '÷') {
      if (b === 0) { setDisplay('Error'); setFresh(true); setPrev(null); setOp(null); return; }
      result = a / b;
    } else return;
    const entry = `${prev} ${op} ${display} = ${result}`;
    setHistory(h => [entry, ...h].slice(0, 6));
    setDisplay(String(parseFloat(result.toFixed(10))));
    setPrev(null); setOp(null); setFresh(true);
  }
  function clear() { setDisplay('0'); setPrev(null); setOp(null); setFresh(true); }
  function negate() { setDisplay(d => d.startsWith('-') ? d.slice(1) : '-' + d); }
  function percent() { setDisplay(d => String(parseFloat(d) / 100)); }
  function backspace() { setDisplay(d => d.length > 1 ? d.slice(0, -1) : '0'); }

  function btn(label: string, onClick: () => void, highlight = false) {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        style={{ fontSize: 13, fontWeight: 600, padding: '10px 0', background: highlight ? 'var(--brand-400)' : 'var(--surface-raised)', color: highlight ? '#fff' : 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 12 }}>
      {history.length > 0 && (
        <div style={{ marginBottom: 8, padding: 6, background: 'var(--surface-raised)', borderRadius: 2 }}>
          {history.map((h, i) => <div key={i} style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{h}</div>)}
        </div>
      )}
      <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--text-primary)', textAlign: 'right', padding: '8px 4px', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
        {display}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {btn('AC', clear)} {btn('+/-', negate)} {btn('%', percent)} {btn('÷', () => setOperator('÷'), true)}
        {btn('7', () => input('7'))} {btn('8', () => input('8'))} {btn('9', () => input('9'))} {btn('×', () => setOperator('×'), true)}
        {btn('4', () => input('4'))} {btn('5', () => input('5'))} {btn('6', () => input('6'))} {btn('-', () => setOperator('-'), true)}
        {btn('1', () => input('1'))} {btn('2', () => input('2'))} {btn('3', () => input('3'))} {btn('+', () => setOperator('+'), true)}
        {btn('⌫', backspace)} {btn('0', () => input('0'))} {btn('.', decimal)} {btn('=', calculate, true)}
      </div>
    </div>
  );
}
