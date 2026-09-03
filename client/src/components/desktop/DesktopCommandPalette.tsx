import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Monitor, Users, FileText, AlertTriangle, Car } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { NavFunction } from '../../data/navCatalog';

interface PaletteResult {
  type: 'module' | 'call' | 'person' | 'unit' | 'warrant';
  id: string | number;
  primary: string;
  secondary?: string;
  path?: string;
}

interface DesktopCommandPaletteProps {
  allFunctions: NavFunction[];
  onNavigate: (path: string) => void;
  onClose: () => void;
}

const TYPE_ICONS: Record<PaletteResult['type'], React.ReactNode> = {
  module: <Monitor style={{ width: 11, height: 11 }} />,
  call: <AlertTriangle style={{ width: 11, height: 11 }} />,
  person: <Users style={{ width: 11, height: 11 }} />,
  unit: <Car style={{ width: 11, height: 11 }} />,
  warrant: <FileText style={{ width: 11, height: 11 }} />,
};

const TYPE_LABELS: Record<PaletteResult['type'], string> = {
  module: 'Modules',
  call: 'Active Calls',
  person: 'Persons',
  unit: 'Units',
  warrant: 'Warrants',
};

const TYPE_ORDER: PaletteResult['type'][] = ['module', 'call', 'person', 'unit', 'warrant'];

function groupResults(results: PaletteResult[]) {
  const groups = new Map<PaletteResult['type'], PaletteResult[]>();
  for (const r of results) {
    if (!groups.has(r.type)) groups.set(r.type, []);
    groups.get(r.type)!.push(r);
  }
  return TYPE_ORDER.filter(t => groups.has(t)).map(t => ({ type: t, items: groups.get(t)! }));
}

export default function DesktopCommandPalette({ allFunctions, onNavigate, onClose }: DesktopCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const moduleResults = useMemo((): PaletteResult[] => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const items: PaletteResult[] = [];
    if ('500+ features system control hud'.includes(q) || 'hud'.includes(q) || 'kiosk'.includes(q) || 'hardware'.includes(q) || '500'.includes(q) || 'radar'.includes(q)) {
      items.push({
        type: 'module' as const,
        id: 'kiosk-hud',
        primary: '500+ Features System Control HUD',
        secondary: 'FZ-55 Telemetry · Kiosk Shell · Radar360 · CAD Suite',
        path: '__kiosk_hud__'
      });
    }
    const matched = allFunctions
      .filter(fn => fn.label.toLowerCase().includes(q) || fn.path.toLowerCase().includes(q))
      .slice(0, 5)
      .map(fn => ({ type: 'module' as const, id: fn.path, primary: fn.label, secondary: fn.path, path: fn.path }));
    return [...items, ...matched];
  }, [query, allFunctions]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setSelectedIdx(0); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const q = encodeURIComponent(query);
        const [calls, persons, units, warrants] = await Promise.allSettled([
          apiFetch<{ id: number; incident_type: string; location_address: string }[]>(`/dispatch/calls?status=active&q=${q}`),
          apiFetch<{ id: number; full_name: string; date_of_birth?: string }[]>(`/records/persons?q=${q}`),
          apiFetch<{ id: number; unit_id: string; full_name?: string; status: string }[]>(`/dispatch/units?q=${q}`),
          apiFetch<{ id: number; defendant_name: string; charge_description?: string }[]>(`/warrants?q=${q}`),
        ]);

        const apiResults: PaletteResult[] = [];

        if (calls.status === 'fulfilled' && Array.isArray(calls.value)) {
          for (const c of calls.value.slice(0, 5)) {
            apiResults.push({ type: 'call', id: c.id, primary: c.incident_type?.replace(/_/g, ' ') ?? 'Call', secondary: c.location_address, path: `/dispatch?call=${c.id}` });
          }
        }
        if (persons.status === 'fulfilled' && Array.isArray(persons.value)) {
          for (const p of persons.value.slice(0, 5)) {
            apiResults.push({ type: 'person', id: p.id, primary: p.full_name, secondary: p.date_of_birth, path: `/records/persons/${p.id}` });
          }
        }
        if (units.status === 'fulfilled' && Array.isArray(units.value)) {
          for (const u of units.value.slice(0, 5)) {
            apiResults.push({ type: 'unit', id: u.id, primary: u.unit_id, secondary: u.full_name ?? u.status, path: `/dispatch?unit=${u.id}` });
          }
        }
        if (warrants.status === 'fulfilled' && Array.isArray(warrants.value)) {
          for (const w of warrants.value.slice(0, 5)) {
            apiResults.push({ type: 'warrant', id: w.id, primary: w.defendant_name, secondary: w.charge_description, path: `/warrants/${w.id}` });
          }
        }

        setResults(apiResults);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    }, 200);
  }, [query]);

  const allResults = useMemo(() => [...moduleResults, ...results].slice(0, 20), [moduleResults, results]);

  useEffect(() => { setSelectedIdx(0); }, [allResults.length]);

  const handleSelect = useCallback((result: PaletteResult) => {
    if (result.path === '__kiosk_hud__') {
      window.dispatchEvent(new CustomEvent('flexos:open-kiosk-hud'));
    } else if (result.path) {
      onNavigate(result.path);
    }
    onClose();
  }, [onNavigate, onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, allResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' && allResults[selectedIdx]) { e.preventDefault(); handleSelect(allResults[selectedIdx]); }
    };
    window.addEventListener('keydown', h, { capture: true });
    return () => window.removeEventListener('keydown', h, { capture: true });
  }, [allResults, selectedIdx, handleSelect, onClose]);

  const groups = groupResults(allResults);
  let flatIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0 0 0 / 0.55)', zIndex: 19999 }}
      />
      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: '15%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-default, rgba(195,204,214,0.15))',
          boxShadow: '0 24px 60px rgba(0 0 0 / 0.7)',
          zIndex: 20000,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-subtle, rgba(195,204,214,0.08))' }}>
          <Search style={{ width: 14, height: 14, color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search modules, calls, persons, units, warrants…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: 'var(--text-primary)' }}
          />
          {loading && (
            <div style={{ width: 12, height: 12, border: '2px solid var(--border-subtle)', borderTopColor: 'var(--brand-400)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
          )}
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }} aria-label="Close command palette">
            <X style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query && allResults.length === 0 && !loading && (
            <div style={{ padding: '20px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {!query && (
            <div style={{ padding: '20px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Start typing to search modules, calls, persons, units, or warrants
            </div>
          )}
          {groups.map(group => (
            <div key={group.type}>
              <div style={{ padding: '6px 14px 2px', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--field-label-color)', textTransform: 'uppercase' }}>
                {TYPE_LABELS[group.type]}
              </div>
              {group.items.map(item => {
                const idx = flatIndex++;
                const isSelected = idx === selectedIdx;
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 14px',
                      background: isSelected ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.18)' : 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                      {TYPE_ICONS[item.type]}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-primary)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.primary}
                      </span>
                      {item.secondary && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.secondary}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>↵</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border-subtle, rgba(195,204,214,0.08))', display: 'flex', gap: 14, fontSize: 9, color: 'var(--text-muted)' }}>
          <span><kbd style={{ fontFamily: 'Arial, sans-serif' }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ fontFamily: 'Arial, sans-serif' }}>↵</kbd> open</span>
          <span><kbd style={{ fontFamily: 'Arial, sans-serif' }}>Esc</kbd> dismiss</span>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
