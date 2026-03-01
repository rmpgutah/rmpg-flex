// ============================================================
// RMPG Flex — Disposition Prompt
// Compact inline panel that requires a disposition code before
// a call can be cleared. Matches Spillman Flex behavior where
// dispatchers must select a disposition on every call clear.
// ============================================================

import React, { useState } from 'react';
import { AlertTriangle, X, Check, FileText } from 'lucide-react';

interface DispositionCode {
  code: string;
  description: string;
  color?: string;
}

interface DispositionPromptProps {
  callNumber: string;
  dispositionCodes: DispositionCode[];
  onConfirm: (disposition: string, createIncident?: boolean) => void;
  onCancel: () => void;
}

export default function DispositionPrompt({
  callNumber,
  dispositionCodes,
  onConfirm,
  onCancel,
}: DispositionPromptProps) {
  const [selected, setSelected] = useState('');
  const [createIncident, setCreateIncident] = useState(false);

  return (
    <div
      className="animate-fade-in"
      style={{
        background: 'rgba(180, 130, 0, 0.12)',
        border: '1px solid #b48200',
        padding: '8px 10px',
        marginTop: 6,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle style={{ width: 12, height: 12, color: '#f59e0b' }} />
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
            Clear {callNumber} — Select Disposition
          </span>
        </div>
        <button
          onClick={onCancel}
          className="text-rmpg-500 hover:text-white"
          title="Cancel clear"
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 bg-surface-base border border-rmpg-600 text-white text-[10px] px-2 py-1 font-mono focus:border-amber-500 focus:outline-none"
          autoFocus
        >
          <option value="">— Select Disposition Code —</option>
          {dispositionCodes.map((d) => (
            <option key={d.code} value={d.code}>
              {d.code} — {d.description}
            </option>
          ))}
        </select>

        <button
          onClick={() => selected && onConfirm(selected, createIncident)}
          disabled={!selected}
          className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{
            background: selected ? '#16a34a' : '#333',
            color: selected ? '#fff' : '#666',
            border: `1px solid ${selected ? '#16a34a' : '#444'}`,
            cursor: selected ? 'pointer' : 'not-allowed',
          }}
        >
          <Check style={{ width: 10, height: 10 }} />
          Confirm Clear
        </button>
      </div>

      {/* Create Incident Report checkbox — Spillman Flex call promotion */}
      <label className="flex items-center gap-1.5 mt-2 cursor-pointer group">
        <input
          type="checkbox"
          checked={createIncident}
          onChange={(e) => setCreateIncident(e.target.checked)}
          className="w-3 h-3 accent-brand-500"
        />
        <FileText style={{ width: 10, height: 10, color: createIncident ? '#60a5fa' : '#6b7280' }} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${createIncident ? 'text-brand-400' : 'text-rmpg-500 group-hover:text-rmpg-300'}`}>
          Create Incident Report from this call
        </span>
      </label>
    </div>
  );
}
