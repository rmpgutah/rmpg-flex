import React, { useState, useEffect, useCallback } from 'react';
import { Delete } from 'lucide-react';

type UnitCategory = 'speed' | 'distance' | 'weight' | 'temp';

const UNIT_CONVERSIONS: Record<UnitCategory, { label: string; pairs: { from: string; to: string; convert: (n: number) => number }[] }> = {
  speed: {
    label: 'Speed',
    pairs: [
      { from: 'mph', to: 'kph', convert: n => n * 1.60934 },
      { from: 'kph', to: 'mph', convert: n => n / 1.60934 },
    ],
  },
  distance: {
    label: 'Distance',
    pairs: [
      { from: 'mi', to: 'km', convert: n => n * 1.60934 },
      { from: 'km', to: 'mi', convert: n => n / 1.60934 },
      { from: 'ft', to: 'm', convert: n => n * 0.3048 },
      { from: 'm', to: 'ft', convert: n => n / 0.3048 },
    ],
  },
  weight: {
    label: 'Weight',
    pairs: [
      { from: 'lbs', to: 'kg', convert: n => n * 0.453592 },
      { from: 'kg', to: 'lbs', convert: n => n / 0.453592 },
    ],
  },
  temp: {
    label: 'Temperature',
    pairs: [
      { from: '°F', to: '°C', convert: n => (n - 32) * 5 / 9 },
      { from: '°C', to: '°F', convert: n => n * 9 / 5 + 32 },
    ],
  },
};

const SESSION_KEY = 'rmpg_calc_expr';

// Recursive-descent parser for basic arithmetic — no eval / new Function().
// Grammar: expr = term (('+' | '-') term)*
//           term = factor (('*' | '/') factor)*
//           factor = unary | number | '(' expr ')'
function safeEval(raw: string): string {
  const src = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, '');
  let pos = 0;

  function peek() { return src[pos]; }
  function consume() { return src[pos++]; }
  function skipSpaces() { while (src[pos] === ' ') pos++; }

  function parseNumber(): number {
    skipSpaces();
    let s = '';
    if (peek() === '-') s += consume();
    while (pos < src.length && (/\d/.test(peek()) || peek() === '.')) s += consume();
    const n = parseFloat(s);
    if (isNaN(n)) throw new Error('bad number');
    return n;
  }

  function parseExpr(): number {
    let left = parseTerm();
    skipSpaces();
    while (pos < src.length && (peek() === '+' || peek() === '-')) {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
      skipSpaces();
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    skipSpaces();
    while (pos < src.length && (peek() === '*' || peek() === '/')) {
      const op = consume();
      const right = parseFactor();
      if (op === '/' && right === 0) throw new Error('div/0');
      left = op === '*' ? left * right : left / right;
      skipSpaces();
    }
    return left;
  }

  function parseFactor(): number {
    skipSpaces();
    if (peek() === '(') {
      consume();
      const val = parseExpr();
      skipSpaces();
      if (peek() === ')') consume();
      return val;
    }
    return parseNumber();
  }

  try {
    const result = parseExpr();
    if (pos < src.length) throw new Error('trailing chars');
    if (!isFinite(result)) return 'Error';
    return String(parseFloat(result.toPrecision(12)));
  } catch {
    return 'Error';
  }
}

export default function DesktopCalculator() {
  const [tab, setTab] = useState<'calc' | 'convert'>('calc');
  const [display, setDisplay] = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '0');
  const [justEvaled, setJustEvaled] = useState(false);
  const [unitCat, setUnitCat] = useState<UnitCategory>('speed');
  const [unitPairIdx, setUnitPairIdx] = useState(0);
  const [unitInput, setUnitInput] = useState('');

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, display);
  }, [display]);

  const press = useCallback((val: string) => {
    setDisplay(prev => {
      if (val === 'C') { setJustEvaled(false); return '0'; }
      if (val === '⌫') { setJustEvaled(false); return prev.length > 1 ? prev.slice(0, -1) : '0'; }
      if (val === '=') {
        const result = safeEval(prev);
        setJustEvaled(true);
        return result;
      }
      if (val === '±') {
        if (prev.startsWith('-')) return prev.slice(1);
        return prev === '0' ? '0' : '-' + prev;
      }
      if (val === '%') {
        const n = parseFloat(prev);
        return isNaN(n) ? prev : String(n / 100);
      }
      if (val === '√') {
        const n = parseFloat(prev);
        return isNaN(n) || n < 0 ? 'Error' : String(Math.sqrt(n));
      }
      // Operator after eval: start fresh with the result
      const isOp = ['+', '−', '×', '÷'].includes(val);
      if (justEvaled && !isOp) { setJustEvaled(false); return val === '.' ? '0.' : val; }
      setJustEvaled(false);
      if (prev === '0' && !isOp && val !== '.') return val;
      return prev + val;
    });
  }, [justEvaled]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (tab !== 'calc') return;
      if (e.key >= '0' && e.key <= '9') { press(e.key); return; }
      if (e.key === '+') press('+');
      if (e.key === '-') press('−');
      if (e.key === '*') press('×');
      if (e.key === '/') { e.preventDefault(); press('÷'); }
      if (e.key === '.') press('.');
      if (e.key === '%') press('%');
      if (e.key === 'Enter' || e.key === '=') press('=');
      if (e.key === 'Backspace') press('⌫');
      if (e.key === 'Escape') press('C');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [press, tab]);

  const pairs = UNIT_CONVERSIONS[unitCat].pairs;
  const pair = pairs[unitPairIdx] ?? pairs[0];
  const unitResult = (() => {
    const n = parseFloat(unitInput);
    if (!unitInput || isNaN(n)) return '';
    return pair.convert(n).toPrecision(6).replace(/\.?0+$/, '');
  })();

  const BTN: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border-subtle, rgba(195,204,214,0.1))',
    borderRadius: 2,
    cursor: 'pointer',
    padding: '10px 0',
    background: 'var(--surface-base, #22405f)',
    color: 'var(--text-primary, #f0f4f9)',
    transition: 'background 100ms',
  };
  const OPBTN: React.CSSProperties = { ...BTN, background: 'var(--surface-sunken, #0f2035)', color: 'var(--brand-400, #5b8ab5)' };
  const EQBTN: React.CSSProperties = { ...BTN, background: 'var(--brand-600, #1e4d7a)', color: '#fff', fontWeight: 700 };

  const rows = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['√', '0', '.', '='],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-raised, #1a3352)' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        {(['calc', 'convert'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '6px 0', fontSize: 10, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--brand-400)' : '2px solid transparent',
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
            }}
          >
            {t === 'calc' ? 'Calculator' : 'Unit Convert'}
          </button>
        ))}
      </div>

      {tab === 'calc' ? (
        <>
          {/* Display */}
          <div style={{ padding: '12px 12px 8px', textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', minHeight: 14, wordBreak: 'break-all' }}>
              {justEvaled ? '' : display}
            </div>
            <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all', lineHeight: 1.2 }}>
              {justEvaled ? display : (display.length > 12 ? display.slice(-12) : display)}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, padding: '0 4px 8px', flex: 1 }}>
            {rows.flat().map((k, i) => {
              const isOp = ['÷', '×', '−', '+', '√', '±', '%', 'C'].includes(k);
              const isEq = k === '=';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => press(k)}
                  style={isEq ? EQBTN : isOp ? OPBTN : BTN}
                >
                  {k === '⌫' ? <Delete style={{ width: 14, height: 14, margin: '0 auto', display: 'block' }} /> : k}
                </button>
              );
            })}
            {/* Backspace occupies the last slot replacement - already included as ⌫ concept above, skip */}
          </div>
        </>
      ) : (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Category tabs */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(Object.keys(UNIT_CONVERSIONS) as UnitCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => { setUnitCat(cat); setUnitPairIdx(0); setUnitInput(''); }}
                style={{
                  fontSize: 9, fontWeight: unitCat === cat ? 700 : 400,
                  padding: '3px 8px', borderRadius: 2,
                  border: `1px solid ${unitCat === cat ? 'var(--brand-400)' : 'var(--border-subtle)'}`,
                  background: unitCat === cat ? 'var(--brand-700)' : 'var(--surface-base)',
                  color: unitCat === cat ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {UNIT_CONVERSIONS[cat].label}
              </button>
            ))}
          </div>

          {/* Pair selector */}
          <select
            value={unitPairIdx}
            onChange={e => { setUnitPairIdx(Number(e.target.value)); setUnitInput(''); }}
            style={{ fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2 }}
          >
            {pairs.map((p, i) => (
              <option key={i} value={i}>{p.from} → {p.to}</option>
            ))}
          </select>

          {/* Input */}
          <div>
            <label style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {pair.from}
            </label>
            <input
              type="number"
              value={unitInput}
              onChange={e => setUnitInput(e.target.value)}
              placeholder="0"
              style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 18, padding: '6px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none', fontVariantNumeric: 'tabular-nums' }}
            />
          </div>

          {/* Result */}
          <div>
            <label style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {pair.to}
            </label>
            <div style={{ marginTop: 4, fontSize: 24, fontWeight: 300, color: 'var(--text-primary)', padding: '6px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', minHeight: 42, fontVariantNumeric: 'tabular-nums' }}>
              {unitResult || <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>—</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
