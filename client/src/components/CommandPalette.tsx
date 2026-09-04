// ============================================================
// RMPG Flex — Command Palette (Cmd/Ctrl+K)
// System-wide launcher. Three live sections, one keyboard-driven list:
//   ACTIONS    — run an NCIC cross-reference / search all records on the
//                current query text
//   NAVIGATION — jump to any (role-filtered) page or module
//   RECORDS    — live person/vehicle lookups against the records API
// Arrow keys move the single highlighted row across all sections; Enter
// activates it; Esc closes. Toggle wiring (Cmd+K) lives in Layout.
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Terminal, Database, User, Car, CornerDownLeft } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface PaletteNavTarget {
  path: string;
  label: string;
  icon: React.ElementType;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Flattened, already role-filtered navigation targets (pages + children). */
  navTargets: PaletteNavTarget[];
}

type RecordHit = {
  kind: 'person' | 'vehicle';
  id: number | string;
  primary: string;
  secondary: string;
  nav: string;
};

type PaletteItem = {
  id: string;
  section: 'ACTIONS' | 'NAVIGATION' | 'RECORDS';
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  badge?: string;
  run: () => void;
};

const SECTION_ORDER: PaletteItem['section'][] = ['ACTIONS', 'NAVIGATION', 'RECORDS'];

export default function CommandPalette({ open, onClose, navTargets }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<RecordHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setRecords([]);
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const go = (path: string) => { onClose(); navigate(path); };

  // ── Live record search (debounced, both queries fail soft to []) ──
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) { setRecords([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const [persons, vehicles] = await Promise.all([
        apiFetch<any[]>(`/records/persons/search?q=${encodeURIComponent(q)}`).catch(() => [] as any[]),
        apiFetch<any[]>(`/records/vehicles/search?q=${encodeURIComponent(q)}`).catch(() => [] as any[]),
      ]);
      if (cancelled) return;
      const hits: RecordHit[] = [
        ...(persons || []).slice(0, 5).map((p) => {
          const name = [p.last_name, p.first_name].filter(Boolean).join(', ') || '(unnamed)';
          return {
            kind: 'person' as const,
            id: p.id,
            primary: name,
            secondary: [p.dob || p.date_of_birth, p.phone].filter(Boolean).join(' · '),
            nav: `/records?tab=persons&q=${encodeURIComponent(name)}`,
          };
        }),
        ...(vehicles || []).slice(0, 5).map((v) => {
          const plate = v.plate_number || v.license_plate || '(no plate)';
          return {
            kind: 'vehicle' as const,
            id: v.id,
            primary: `${plate} ${v.state || v.plate_state || ''}`.trim(),
            secondary: [v.year, v.make, v.model].filter(Boolean).join(' '),
            nav: `/records?tab=vehicles&q=${encodeURIComponent(plate)}`,
          };
        }),
      ];
      setRecords(hits);
      setSearching(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  // ── Flatten all sections into one keyboard-navigable list ──
  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    const out: PaletteItem[] = [];

    if (q.length >= 2) {
      out.push({
        id: 'act-ncic', section: 'ACTIONS', icon: Terminal,
        label: 'Run NCIC cross-reference', sublabel: q.toUpperCase(), badge: 'QX',
        run: () => go(`/ncic?type=xref&q=${encodeURIComponent(q)}`),
      });
      out.push({
        id: 'act-records', section: 'ACTIONS', icon: Search,
        label: 'Search all records', sublabel: q, badge: 'RECORDS',
        run: () => go(`/records?tab=persons&q=${encodeURIComponent(q)}`),
      });
    }

    const navMatches = q
      ? navTargets.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))
      : navTargets;
    navMatches.slice(0, q ? 6 : navTargets.length).forEach((n) =>
      out.push({
        id: `nav-${n.path}-${n.label}`, section: 'NAVIGATION', icon: n.icon,
        label: n.label, badge: n.path, run: () => go(n.path),
      })
    );

    records.forEach((r) =>
      out.push({
        id: `rec-${r.kind}-${r.id}`, section: 'RECORDS',
        icon: r.kind === 'person' ? User : Car,
        label: r.primary, sublabel: r.secondary, badge: r.kind.toUpperCase(),
        run: () => go(r.nav),
      })
    );

    return out;
  }, [query, navTargets, records]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted index in range as the list changes.
  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, items.length - 1))); }, [items.length]);

  // Scroll the active row into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (items.length ? (i + 1) % items.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  // Render order with section headers inserted when the section changes.
  let lastSection: PaletteItem['section'] | null = null;
  const platformMeta = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? 'Cmd+K' : 'Ctrl+K';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] bg-black/60 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="bg-surface-base border border-rmpg-700 rounded-sm w-full max-w-xl mx-4 animate-dropdown-appear overflow-hidden"
        style={{ borderTop: '2px solid var(--field-label-color)', boxShadow: '0 16px 48px rgba(0 0 0 / 0.6), 0 4px 16px rgba(0 0 0 / 0.4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-rmpg-700">
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--field-label-color)' }} />
          <input id="ff-commandpalette-0"
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search records, run NCIC, jump to a page…"
            className="flex-1 bg-transparent text-sm text-rmpg-100 placeholder-fg-muted focus:outline-none"
            aria-label="Command palette query"
            autoComplete="off" spellCheck={false}
          />
          {searching && <span className="text-[9px] font-mono text-fg-muted animate-pulse">SEARCHING…</span>}
          <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-surface-sunken border border-border-default text-fg-muted rounded-sm">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto scrollbar-dark">
          {items.length === 0 ? (
            <div className="p-6 text-center text-fg-muted text-xs">
              {query.trim().length === 0
                ? <>Type to search records, run an NCIC check, or jump to a module<div className="text-fg-muted mt-1">{platformMeta} toggles this palette</div></>
                : searching ? 'Searching…' : 'No matches'}
            </div>
          ) : (
            SECTION_ORDER.flatMap((section) => {
              const sectionItems = items
                .map((it, idx) => ({ it, idx }))
                .filter(({ it }) => it.section === section);
              if (sectionItems.length === 0) return [];
              const rows: React.ReactNode[] = [];
              if (lastSection !== section) {
                rows.push(
                  <div key={`hdr-${section}`} className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-secondary)', letterSpacing: '0.12em' }}>
                    {section}
                  </div>
                );
                lastSection = section;
              }
              sectionItems.forEach(({ it, idx }) => {
                const Icon = it.icon;
                const isActive = idx === active;
                rows.push(
                  <button
                    type="button"
                    key={it.id}
                    data-idx={idx}
                    onMouseMove={() => setActive(idx)}
                    onClick={it.run}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left border-l-2 transition-colors duration-100"
                    style={{
                      background: isActive ? 'rgba(212,160,23,0.12)' : 'transparent',
                      borderLeftColor: isActive ? 'var(--field-label-color)' : 'transparent',
                    }}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? 'var(--field-label-color)' : 'var(--text-secondary)' }} />
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="min-w-0 text-sm truncate" style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{it.label}</span>
                      {it.sublabel && <span className="min-w-0 text-[10px] text-fg-muted truncate">{it.sublabel}</span>}
                    </span>
                    {it.badge && (
                      <span className="text-[9px] font-mono text-fg-muted ml-auto flex-shrink-0">{it.badge}</span>
                    )}
                    {isActive && <CornerDownLeft className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--field-label-color)' }} aria-hidden="true" />}
                  </button>
                );
              });
              return rows;
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-1.5 border-t border-rmpg-700 text-[9px] text-fg-muted font-mono">
          <span><kbd className="text-rmpg-400">↑↓</kbd> navigate</span>
          <span><kbd className="text-rmpg-400">↵</kbd> open</span>
          <span><kbd className="text-rmpg-400">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
