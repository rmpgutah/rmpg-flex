// ============================================================
// RMPG Flex — Record Field
// Polished label/value row for record detail panels. Replaces the
// ad-hoc `<div><span>Label:</span> <span>value</span></div>` pattern
// with consistent hierarchy, empty-state handling, hover highlight,
// and optional click-to-copy (handy for DL#, phone, NCIC#, etc.).
// ============================================================

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface RecordFieldProps {
  label: string;
  value?: string | number | null;
  icon?: React.ElementType;
  /** Render value in monospace (IDs, numbers, plates). */
  mono?: boolean;
  /** Tint the value (e.g. '#e8b820' for aliases). Defaults to primary text. */
  valueColor?: string;
  /** Click value to copy to clipboard. */
  copyable?: boolean;
  /** Show the row even when empty, rendering a muted em-dash. */
  showEmpty?: boolean;
  className?: string;
}

export default function RecordField({
  label,
  value,
  icon: Icon,
  mono = false,
  valueColor,
  copyable = false,
  showEmpty = false,
  className = '',
}: RecordFieldProps) {
  const [copied, setCopied] = useState(false);

  const isEmpty = value == null || value === '';
  if (isEmpty && !showEmpty) return null;

  const display = isEmpty ? '—' : String(value);

  const handleCopy = () => {
    if (isEmpty || !copyable) return;
    try {
      void navigator.clipboard?.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    } catch {
      /* clipboard unavailable (insecure context) — silently no-op */
    }
  };

  return (
    <div
      className={`flex items-start gap-2 text-xs group/field px-1 -mx-1 py-[1px] rounded-[2px] hover:bg-white/[0.03] transition-colors ${className}`}
    >
      {Icon && <Icon className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted, #8a8a8a)' }} aria-hidden="true" />}
      <span
        className="min-w-[78px] shrink-0 select-none uppercase tracking-wide text-[9px] font-semibold mt-[1px]"
        style={{ color: 'var(--text-muted, #8a8a8a)', letterSpacing: '0.04em' }}
      >
        {label}
      </span>
      <span
        onClick={handleCopy}
        className={`
          flex items-center gap-1 leading-snug
          ${isEmpty ? 'text-rmpg-600' : 'text-rmpg-200 group-hover/field:text-white'}
          ${mono ? 'font-mono tabular-nums tracking-tight' : ''}
          ${copyable && !isEmpty ? 'cursor-pointer' : ''}
          transition-colors
        `}
        style={!isEmpty && valueColor ? { color: valueColor } : undefined}
        title={copyable && !isEmpty ? 'Click to copy' : undefined}
      >
        {display}
        {copyable && !isEmpty && (
          copied
            ? <Check className="w-3 h-3 text-green-400 flex-shrink-0" aria-label="Copied" />
            : <Copy className="w-3 h-3 opacity-0 group-hover/field:opacity-60 flex-shrink-0 transition-opacity" aria-hidden="true" />
        )}
      </span>
    </div>
  );
}
