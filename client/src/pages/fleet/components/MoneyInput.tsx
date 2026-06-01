// ═══════════════════════════════════════════════════════════════
// RMPG Flex — MoneyInput
//
// A currency text input that formats with thousands separators while
// keeping the FORM STATE as a raw numeric string (no commas), so the
// existing `parseFloat(...)` payload builders stay untouched and the
// backend contract is unchanged.
//
// Behaviour:
//   • While focused → shows the raw editable value ("12345.67") so
//     cursor/edit behaviour is natural.
//   • While blurred → shows "12,345.67" (grouped, 2 decimals).
//   • onChange sanitises to digits + a single dot, so letters and
//     stray symbols can never land in state ("inputs reject/mangle"
//     class of bug). inputMode="decimal" gives the Toughbook / mobile
//     numeric keypad.
//
// Drop-in replacement for `<input type="number">` on dollar fields:
// pass the raw string `value` and an `onChange(raw)` that stores it.
// ═══════════════════════════════════════════════════════════════

import React, { useState } from 'react';

interface Props {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
  /** Decimals to show when blurred (default 2). */
  digits?: number;
  id?: string;
  'aria-label'?: string;
}

/** Strip everything that isn't a digit or the first decimal point. */
export function sanitizeMoney(s: string): string {
  let cleaned = s.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    // Collapse any decimal points after the first.
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  return cleaned;
}

export default function MoneyInput({
  value, onChange, placeholder, className, digits = 2, id, ...rest
}: Props) {
  const [focused, setFocused] = useState(false);

  const display = focused
    ? value
    : (() => {
        if (value === '' || value == null) return '';
        const n = parseFloat(value);
        if (!isFinite(n)) return value; // never hide unparseable input
        return n.toLocaleString(undefined, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
      })();

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      placeholder={placeholder}
      aria-label={rest['aria-label']}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(sanitizeMoney(e.target.value))}
    />
  );
}
