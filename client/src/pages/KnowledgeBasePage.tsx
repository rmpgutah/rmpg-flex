// Knowledge Base — the system-wide search destination. One search box queries
// every record type at once and shows consolidated, human-readable cards keyed
// on the VISIBLE identifier (call/case/citation/warrant number, name, plate,
// badge, unit call sign, statute cite) — never the backend row id or code.
// Each result opens its section. Shares the /api/knowledge-base endpoint with
// the global Ctrl/Cmd+K search.
//
// Audit-series contract (v1078): URL deep-link (?q=&type=) so a search is
// shareable AND the active type-filter chip survives reload; per-user recent
// searches on the empty state (no leak between MDT operators); keyboard
// navigation (↑/↓/Enter) matching GlobalSearch; Esc smart-cascade (filter →
// query → blur); court-ready PDF export of the current result list; theme-
// token chrome (no more raw #d4a017/#0a0a0a literals).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Loader2, ArrowRight, BookOpen, X, User, Car, FileText, Phone,
  AlertTriangle, Shield, Building2, Users, Radio, Package, Scale, Receipt,
  Fingerprint, Printer, Clock, type LucideIcon,
} from 'lucide-react';
import { knowledgeBaseSearch, kbTypeLabel, KB_TYPE_META, type KbResult } from '../utils/knowledgeBase';
import { generateKnowledgeBaseSearchPdf } from '../utils/knowledgeBaseSearchPdf';
import { useAuth } from '../context/AuthContext';

const TYPE_ICON: Record<string, LucideIcon> = {
  call: Phone, person: User, vehicle: Car, warrant: Shield, citation: Receipt,
  incident: FileText, personnel: Users, unit: Radio, evidence: Package,
  bolo: AlertTriangle, property: Building2, arrest: Fingerprint, statute: Scale,
};
const iconFor = (t: string): LucideIcon => TYPE_ICON[t] || BookOpen;

interface RecentSearch {
  q: string;
  /** Result count last time the search ran — surfaced in the recent-row hint. */
  count: number;
  /** ISO timestamp. */
  at: string;
}

const MAX_RECENT = 8;
/** Per-user storage key. A shared MDT must not leak one operator's queries to
 *  the next person to sit down. Falls back to null (no read/write) when no
 *  user is known (mid-login). */
const recentKey = (userId: string | undefined) =>
  userId ? `rmpg_kb_recent_${userId}` : null;

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState<KbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(params.get('type') || null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<RecentSearch[]>(() => {
    // Lazy init from per-user storage. Bare key is intentionally not migrated:
    // the previous page never wrote any local history, so there's nothing to
    // carry forward.
    try {
      const k = recentKey(undefined);
      if (!k) return [];
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
    } catch {
      return [];
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-load recent list once the user id is known (lazy init above ran with
  // undefined). Effect re-runs only when user.id changes — same MDT shift.
  useEffect(() => {
    try {
      const k = recentKey(user?.id);
      if (!k) { setRecent([]); return; }
      const raw = localStorage.getItem(k);
      setRecent(raw ? (JSON.parse(raw) as RecentSearch[]) : []);
    } catch {
      setRecent([]);
    }
  }, [user?.id]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search; mirror the live query AND active type filter into the
  // URL so a search is shareable / reloadable. ?q= is the query, ?type= is
  // the active chip — both round-trip on refresh.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]); setSearched(false); setLoading(false);
      // Strip ?q= but keep ?type= for a clean URL while the operator is
      // mid-edit. We only clear ?q below.
      const next: Record<string, string> = {};
      if (typeFilter) next.type = typeFilter;
      setParams(next, { replace: true });
      return;
    }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await knowledgeBaseSearch(q, 80);
      if (cancelled) return;
      setResults(r);
      setSearched(true);
      setLoading(false);
      setSelectedIndex(0);
      const next: Record<string, string> = { q };
      if (typeFilter) next.type = typeFilter;
      setParams(next, { replace: true });

      // Append to recent — newest first, dedup by query, capped at MAX_RECENT.
      const k = recentKey(user?.id);
      if (k) {
        setRecent((prev) => {
          const entry: RecentSearch = { q, count: r.length, at: new Date().toISOString() };
          const updated = [entry, ...prev.filter((p) => p.q.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
          try { localStorage.setItem(k, JSON.stringify(updated)); } catch { /* quota — ignore */ }
          return updated;
        });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // setParams intentionally omitted — its identity churns and would
    // re-fire the search needlessly. typeFilter is tracked so a chip-only
    // change updates the URL without re-querying the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, typeFilter, user?.id]);

  // Counts per type (for the filter chips), in result order.
  const typeCounts = useMemo(() => {
    const order: string[] = [];
    const counts: Record<string, number> = {};
    for (const r of results) {
      if (!(r.type in counts)) { counts[r.type] = 0; order.push(r.type); }
      counts[r.type] += 1;
    }
    return order.map((t) => ({ type: t, count: counts[t] }));
  }, [results]);

  const shown = useMemo(
    () => (typeFilter ? results.filter((r) => r.type === typeFilter) : results),
    [results, typeFilter],
  );

  // Drop a stale type filter if the current result set has zero rows of that
  // type — otherwise the operator stares at "0 results" with no chips to tell
  // them they're filtering. The chips collapse only when there are results to
  // measure against, so a mid-flight loading state doesn't drop the filter.
  useEffect(() => {
    if (!typeFilter) return;
    if (!searched || loading) return;
    if (results.length === 0) return;
    if (!results.some((r) => r.type === typeFilter)) setTypeFilter(null);
  }, [typeFilter, results, searched, loading]);

  const open = useCallback((r: KbResult) => {
    navigate(`${r.route}?kb=${r.type}:${r.recordId}`);
  }, [navigate]);

  const handlePrint = useCallback(() => {
    const officerName = user?.full_name
      || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
      || user?.username
      || undefined;
    const doc = generateKnowledgeBaseSearchPdf({
      query,
      results,
      activeTypeFilter: typeFilter,
      officerName,
      badgeNumber: user?.badge_number,
    });
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Revoke shortly after — the new tab loads a copy.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [query, results, typeFilter, user]);

  const clearRecent = useCallback(() => {
    const k = recentKey(user?.id);
    if (k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    setRecent([]);
  }, [user?.id]);

  // Keyboard contract — mirrors GlobalSearch so the dedicated page feels the
  // same as Cmd+K. Suppressed inside other text inputs / contenteditable.
  // Esc smart-cascade: chip → query → blur. Each level peels back one layer.
  // ↑/↓ navigate the visible result list, Enter opens the highlighted row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inOurInput = target === inputRef.current;
      const inOtherField = !inOurInput && (
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
        || target?.isContentEditable
      );

      if (e.key === 'Escape') {
        // Esc inside the field: chip → query → blur. Outside any field: same
        // cascade but skip the blur step.
        if (typeFilter) { e.preventDefault(); setTypeFilter(null); return; }
        if (query) { e.preventDefault(); setQuery(''); return; }
        if (inOurInput) { e.preventDefault(); inputRef.current?.blur(); return; }
        return;
      }

      if (inOtherField) return;

      if (e.key === 'ArrowDown') {
        if (shown.length === 0) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp') {
        if (shown.length === 0) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && shown.length > 0 && (inOurInput || document.activeElement === document.body)) {
        e.preventDefault();
        const r = shown[Math.min(selectedIndex, shown.length - 1)];
        if (r) open(r);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, selectedIndex, query, typeFilter, open]);

  const canPrint = searched && results.length > 0;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-brand-400" />
        <h1 className="text-[13px] font-bold uppercase tracking-widest text-rmpg-100">Knowledge Base</h1>
        <span className="text-[10px] text-rmpg-500">— system-wide search</span>
        <div className="ml-auto">
          <button
            type="button" onClick={handlePrint} disabled={!canPrint}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide border text-rmpg-100 disabled:opacity-40 disabled:cursor-not-allowed hover:border-brand-500 transition-colors"
            style={{ borderRadius: 2, borderColor: 'var(--border-default)' }}
            title={canPrint ? 'Print these search results' : 'Run a search first'}
          >
            <Printer className="w-3.5 h-3.5" /> Print Results
          </button>
        </div>
      </div>

      {/* Search box */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised border border-rmpg-600"
        style={{ borderTop: '2px solid var(--brand-500)', borderRadius: 2 }}
      >
        {loading ? <Loader2 className="w-5 h-5 text-rmpg-300 animate-spin shrink-0" /> : <Search className="w-5 h-5 text-rmpg-300 shrink-0" />}
        <input
          ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by call #, name, plate, warrant / citation #, badge, unit call sign, statute…"
          aria-label="Knowledge base search"
          className="flex-1 bg-transparent text-sm text-rmpg-100 placeholder-rmpg-600 outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="text-rmpg-500 hover:text-rmpg-100 shrink-0" aria-label="Clear"><X className="w-4 h-4" /></button>
        )}
      </div>

      {/* Type filter chips */}
      {typeCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button" onClick={() => setTypeFilter(null)}
            className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border"
            style={{
              borderRadius: 2,
              color: typeFilter === null ? 'var(--surface-base)' : 'var(--rmpg-400)',
              background: typeFilter === null ? 'var(--brand-500)' : 'transparent',
              borderColor: typeFilter === null ? 'var(--brand-500)' : 'var(--border-default)',
            }}
          >
            All {results.length}
          </button>
          {typeCounts.map(({ type, count }) => {
            const active = typeFilter === type;
            const color = KB_TYPE_META[type]?.color || 'var(--rmpg-400)';
            return (
              <button
                key={type} type="button" onClick={() => setTypeFilter(active ? null : type)}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border flex items-center gap-1"
                style={{
                  borderRadius: 2,
                  color: active ? 'var(--surface-base)' : color,
                  background: active ? color : 'transparent',
                  borderColor: active ? color : 'var(--border-default)',
                }}
              >
                {kbTypeLabel(type)} {count}
              </button>
            );
          })}
        </div>
      )}

      {/* Results */}
      <div className="space-y-1.5">
        {!searched && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-rmpg-500 text-center px-6">
            <BookOpen className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Search the entire system by what you see.</p>
            <p className="text-xs text-rmpg-600 mt-1 max-w-md">
              Results are matched and shown by their visible assignment number or name — a call number,
              person, plate, warrant or citation number, badge, unit call sign, or statute cite — not
              internal record ids.
            </p>
            <p className="text-[10px] text-rmpg-700 mt-3">
              <kbd className="px-1.5 py-0.5 bg-rmpg-700 border border-rmpg-600 text-rmpg-200">↑↓</kbd>{' '}
              navigate ·{' '}
              <kbd className="px-1.5 py-0.5 bg-rmpg-700 border border-rmpg-600 text-rmpg-200">Enter</kbd>{' '}
              open ·{' '}
              <kbd className="px-1.5 py-0.5 bg-rmpg-700 border border-rmpg-600 text-rmpg-200">Esc</kbd>{' '}
              back out
            </p>

            {recent.length > 0 && (
              <div className="mt-6 w-full max-w-md text-left">
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-rmpg-400">
                    <Clock className="w-3 h-3" /> Your recent searches
                  </div>
                  <button
                    type="button" onClick={clearRecent}
                    className="text-[10px] text-rmpg-500 hover:text-rmpg-200 transition-colors"
                  >Clear</button>
                </div>
                <ul className="space-y-1">
                  {recent.map((r) => (
                    <li key={`${r.q}-${r.at}`}>
                      <button
                        type="button"
                        onClick={() => { setQuery(r.q); inputRef.current?.focus(); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left bg-surface-raised/40 border border-rmpg-800 hover:border-brand-600 transition-colors"
                        style={{ borderRadius: 2 }}
                      >
                        <Search className="w-3.5 h-3.5 text-rmpg-500 shrink-0" />
                        <span className="flex-1 text-xs text-rmpg-100 truncate">{r.q}</span>
                        <span className="text-[10px] text-rmpg-500 shrink-0">
                          {r.count} hit{r.count === 1 ? '' : 's'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {searched && !loading && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-400">
            <Search className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">No records match “{query.trim()}”.</p>
            <p className="text-xs text-rmpg-500 mt-2">
              Try a shorter substring or a different identifier (call #, plate, badge…).
            </p>
          </div>
        )}
        {searched && !loading && results.length > 0 && shown.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-rmpg-400">
            <p className="text-sm">No <span className="text-rmpg-200 font-medium">{kbTypeLabel(typeFilter || '')}</span> results in this set.</p>
            <button
              type="button" onClick={() => setTypeFilter(null)}
              className="mt-3 text-xs text-brand-400 hover:underline"
            >Show all {results.length} results</button>
          </div>
        )}
        {shown.map((r, idx) => {
          const Icon = iconFor(r.type);
          const color = KB_TYPE_META[r.type]?.color || 'var(--rmpg-400)';
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={`${r.type}-${r.recordId}`} type="button" onClick={() => open(r)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left bg-surface-raised/40 border transition-colors ${
                isSelected ? 'border-brand-500' : 'border-rmpg-800 hover:border-brand-600'
              }`}
              style={{ borderRadius: 2 }}
              aria-current={isSelected ? 'true' : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-rmpg-100 truncate font-medium">{r.label}</p>
                {(r.title || r.subtitle) && (
                  <p className="text-xs text-rmpg-400 truncate">{[r.title, r.subtitle].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wide border border-rmpg-700 text-rmpg-300 shrink-0" style={{ borderRadius: 2 }}>{kbTypeLabel(r.type)}</span>
              <ArrowRight className="w-4 h-4 text-rmpg-500 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
