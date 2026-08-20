import React from "react";
// ============================================================
// RMPG Flex — Disposition Prompt
// Compact inline panel that requires a disposition code before
// a call can be cleared. Matches Spillman Flex behavior where
// dispatchers must select a disposition on every call clear.
// ============================================================

import { useMemo, useState } from 'react';
import { AlertTriangle, X, Check, FileText, Search } from 'lucide-react';
import { DISPOSITION_GROUPS, type DispositionGroup } from '../constants/dispositionCodes';

interface DispositionCode {
  code: string;
  description: string;
  color?: string;
}

interface DispositionPromptProps {
  callNumber: string;
  /** Grouped codes (preferred — renders as <optgroup> sections, e.g. the
   *  10-category PS/## library on process-service calls, or the general
   *  code groups on everything else). A flat DispositionCode[] is also
   *  accepted for back-compat and renders as a single ungrouped section. */
  dispositionCodes: DispositionCode[] | DispositionGroup[];
  onConfirm: (disposition: string, createIncident?: boolean) => void;
  onCancel: () => void;
}

// Built-in fallback when the admin-configured codes haven't loaded (or the
// prop is empty). Uses the single short-coded source of truth so the Clear-call
// dropdown matches the inline edit dropdown exactly (same codes + descriptions).
const FALLBACK_GROUPS: DispositionGroup[] = DISPOSITION_GROUPS;

interface Group {
  label: string;
  codes: DispositionCode[];
}

function isGrouped(codes: DispositionCode[] | DispositionGroup[]): codes is DispositionGroup[] {
  return codes.length > 0 && Array.isArray((codes[0] as DispositionGroup).codes);
}

function DispositionPrompt({
  callNumber,
  dispositionCodes,
  onConfirm,
  onCancel,
}: DispositionPromptProps) {
  const [selected, setSelected] = useState('');
  const [createIncident, setCreateIncident] = useState(false);
  const [filter, setFilter] = useState('');

  const groups: Group[] = useMemo(() => {
    if (dispositionCodes.length === 0) return FALLBACK_GROUPS;
    if (isGrouped(dispositionCodes)) return dispositionCodes;
    // Flat array (legacy caller) — render as one ungrouped section.
    return [{ label: 'Dispositions', codes: dispositionCodes as DispositionCode[] }];
  }, [dispositionCodes]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        codes: g.codes.filter(
          (c) => c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.codes.length > 0);
  }, [groups, filter]);

  const totalCodes = groups.reduce((n, g) => n + g.codes.length, 0);

  // 39: role="alert" for screen reader announcement; 40: aria-live polite
  return (
    <div
      className="animate-fade-in"
      role="alert"
      aria-live="polite"
      style={{
        background: 'rgba(180, 130, 0, 0.12)',
        border: '1px solid var(--sev-warn)',
        padding: '8px 10px',
        marginTop: 6,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle style={{ width: 12, height: 12, color: 'var(--sev-warn)' }} />
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
            Clear {callNumber} — Select Disposition
          </span>
        </div>
        {/* 41: Close button with hover background and transition */}
        <button type="button"
          onClick={onCancel}
          className="text-fg-muted hover:text-rmpg-100 hover:bg-rmpg-700/50 p-0.5 transition-colors rounded-sm"
          title="Cancel clear"
          aria-label="Cancel disposition"
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      {/* Filter box — only worth showing once the list is long enough that
          scanning it unaided is a chore (e.g. the 51-code PS/## library). */}
      {totalCodes > 12 && (
        <div className="relative mb-1.5">
          <Search style={{ width: 10, height: 10 }} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input id="ff-dispositionprompt-filter"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter codes…"
            className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-[10px] pl-5 pr-2 py-1 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 focus:outline-none transition-colors"
            aria-label="Filter disposition codes"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* 44: Focus ring on select input matching design system */}
        <select id="ff-dispositionprompt-0"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 bg-surface-base border border-rmpg-600 text-rmpg-100 text-[10px] px-2 py-1 font-mono focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 focus:outline-none transition-colors"
          aria-label="Disposition code"
          autoFocus
        >
          <option value="">— Select Disposition Code —</option>
          {filteredGroups.map((g) =>
            g.codes.length > 0 ? (
              <optgroup key={g.label} label={g.label}>
                {g.codes.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.description}
                  </option>
                ))}
              </optgroup>
            ) : null
          )}
          {filteredGroups.length === 0 && (
            <option value="" disabled>No codes match "{filter}"</option>
          )}
        </select>

        {/* 42: Hover/active states on confirm button; 43: Transition on background color */}
        <button type="button"
          onClick={() => selected && onConfirm(selected, createIncident)}
          disabled={!selected}
          className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all duration-150"
          style={{
            background: selected ? 'var(--sev-ok)' : 'var(--border-subtle)',
            color: selected ? '#fff' : 'var(--text-muted)',
            border: `1px solid ${selected ? 'var(--sev-ok)' : 'var(--border-default)'}`,
            cursor: selected ? 'pointer' : 'not-allowed',
            opacity: selected ? 1 : 0.6,
          }}
        >
          <Check style={{ width: 10, height: 10 }} />
          Confirm Clear
        </button>
      </div>

      {/* Create Incident Report checkbox — Spillman Flex call promotion */}
      <label className="flex items-center gap-1.5 mt-2 cursor-pointer group">
        <input id="ff-dispositionprompt-1"
          type="checkbox"
          checked={createIncident}
          onChange={(e) => setCreateIncident(e.target.checked)}
          className="w-3 h-3 accent-brand-500"
        />
        <FileText style={{ width: 10, height: 10, color: createIncident ? 'var(--text-secondary)' : 'var(--text-muted)' }} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${createIncident ? 'text-brand-400' : 'text-fg-muted group-hover:text-rmpg-300'}`}>
          Create Incident Report from this call
        </span>
      </label>
    </div>
  );
}

export default React.memo(DispositionPrompt);
