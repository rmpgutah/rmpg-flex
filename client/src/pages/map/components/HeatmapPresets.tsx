// ============================================================
// RMPG Flex — Heatmap Presets
// Save/load named filter combos (days + mode + type) so
// dispatchers can flip between recurring views like
// "Friday nights 30d" or "Domestic 7d" with one click.
// Storage is localStorage under rmpg_heatmap_presets — no
// server sync yet; presets are per-device.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';

export interface HeatmapPresetValue {
  days: number;
  mode: 'all' | 'risk' | 'type';
  typeFilter: string;
}

export interface HeatmapPreset extends HeatmapPresetValue {
  id: string;
  name: string;
}

interface Props {
  /** Currently-active filter state; used as the save-template. */
  current: HeatmapPresetValue;
  /** Called when user picks a preset — parent applies to state. */
  onApply: (preset: HeatmapPresetValue) => void;
}

const STORAGE_KEY = 'rmpg_heatmap_presets';

function loadPresets(): HeatmapPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Light validation — discard malformed entries rather than crash.
    return parsed.filter(
      (p) =>
        p && typeof p.id === 'string' && typeof p.name === 'string' &&
        typeof p.days === 'number' && typeof p.mode === 'string',
    );
  } catch {
    return [];
  }
}

function savePresets(presets: HeatmapPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Quota exceeded — silent; ephemeral in-memory state still works.
  }
}

export default function HeatmapPresets({ current, onApply }: Props) {
  const [presets, setPresets] = useState<HeatmapPreset[]>([]);
  const [isNaming, setIsNaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const persist = useCallback((next: HeatmapPreset[]) => {
    setPresets(next);
    savePresets(next);
  }, []);

  const saveCurrent = useCallback(() => {
    const name = draftName.trim();
    if (!name) return;
    const preset: HeatmapPreset = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      ...current,
    };
    persist([...presets, preset]);
    setDraftName('');
    setIsNaming(false);
  }, [draftName, current, presets, persist]);

  const remove = useCallback(
    (id: string) => {
      persist(presets.filter((p) => p.id !== id));
    },
    [presets, persist],
  );

  return (
    <div
      className="flex flex-col gap-1"
      style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}
    >
      <div className="flex items-center gap-1 flex-wrap">
        {presets.length === 0 && !isNaming && (
          <span style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>
            No saved presets
          </span>
        )}
        {presets.map((p) => (
          <div
            key={p.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: '#88888815',
              border: '1px solid #88888840',
              borderRadius: 2,
              padding: '1px 4px',
            }}
          >
            <button
              type="button"
              onClick={() => onApply(p)}
              style={{
                background: 'none',
                border: 'none',
                color: '#d1d5db',
                fontSize: 9,
                fontWeight: 900,
                cursor: 'pointer',
                padding: 0,
                letterSpacing: '0.05em',
              }}
              title={`${p.days}d · ${p.mode}${p.typeFilter ? ' · ' + p.typeFilter : ''}`}
            >
              {p.name.toUpperCase()}
            </button>
            <button
              type="button"
              onClick={() => remove(p.id)}
              aria-label={`Delete preset ${p.name}`}
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: 9,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              <X className="w-2.5 h-2.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        {!isNaming && (
          <button
            type="button"
            onClick={() => setIsNaming(true)}
            aria-label="Save current filters as preset"
            style={{
              background: '#d4a01720',
              border: '1px solid #d4a01760',
              color: '#d4a017',
              borderRadius: 2,
              padding: '1px 5px',
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 900,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
            title="Save current filters as a preset"
          >
            <Plus className="w-2.5 h-2.5" aria-hidden="true" />
            SAVE
          </button>
        )}
        {isNaming && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Bookmark className="w-3 h-3 text-[#d4a017]" aria-hidden="true" />
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrent();
                if (e.key === 'Escape') { setIsNaming(false); setDraftName(''); }
              }}
              placeholder="preset name"
              autoFocus
              style={{
                background: '#141414',
                border: '1px solid #d4a01760',
                color: '#e5e7eb',
                borderRadius: 2,
                padding: '1px 5px',
                fontSize: 9,
                fontFamily: 'inherit',
                width: 90,
              }}
            />
            <button
              type="button"
              onClick={saveCurrent}
              disabled={!draftName.trim()}
              style={{
                background: '#d4a01720',
                border: '1px solid #d4a01760',
                color: '#d4a017',
                borderRadius: 2,
                padding: '1px 5px',
                cursor: draftName.trim() ? 'pointer' : 'not-allowed',
                fontSize: 9,
                fontWeight: 900,
                opacity: draftName.trim() ? 1 : 0.5,
              }}
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => { setIsNaming(false); setDraftName(''); }}
              aria-label="Cancel preset save"
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
