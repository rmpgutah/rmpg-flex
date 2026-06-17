// Knowledge Base — the system-wide search destination. One search box queries
// every record type at once and shows consolidated, human-readable cards keyed
// on the VISIBLE identifier (call/case/citation/warrant number, name, plate,
// badge, unit call sign, statute cite) — never the backend row id or code.
// Each result opens its section. Shares the /api/knowledge-base endpoint with
// the global Ctrl/Cmd+K search.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Loader2, ArrowRight, BookOpen, X, User, Car, FileText, Phone,
  AlertTriangle, Shield, Building2, Users, Radio, Package, Scale, Receipt,
  Fingerprint, type LucideIcon,
} from 'lucide-react';
import { knowledgeBaseSearch, kbTypeLabel, KB_TYPE_META, type KbResult } from '../utils/knowledgeBase';

const TYPE_ICON: Record<string, LucideIcon> = {
  call: Phone, person: User, vehicle: Car, warrant: Shield, citation: Receipt,
  incident: FileText, personnel: Users, unit: Radio, evidence: Package,
  bolo: AlertTriangle, property: Building2, arrest: Fingerprint, statute: Scale,
};
const iconFor = (t: string): LucideIcon => TYPE_ICON[t] || BookOpen;

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState<KbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search; mirror the live query into the URL so a search is
  // shareable / reloadable.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await knowledgeBaseSearch(q, 80);
      if (cancelled) return;
      setResults(r);
      setSearched(true);
      setLoading(false);
      setParams(q ? { q } : {}, { replace: true });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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

  const open = useCallback((r: KbResult) => {
    navigate(`${r.route}?kb=${r.type}:${r.recordId}`);
  }, [navigate]);

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-brand-400" />
        <h1 className="text-[13px] font-bold uppercase tracking-widest text-rmpg-100">Knowledge Base</h1>
        <span className="text-[10px] text-rmpg-500">— system-wide search</span>
      </div>

      {/* Search box */}
      <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised border border-rmpg-600" style={{ borderTop: '2px solid #d4a017', borderRadius: 2 }}>
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
            style={{ borderRadius: 2, color: typeFilter === null ? '#0a0a0a' : '#a0a0a0', background: typeFilter === null ? '#d4a017' : 'transparent', borderColor: typeFilter === null ? '#d4a017' : '#2e2e2e' }}
          >
            All {results.length}
          </button>
          {typeCounts.map(({ type, count }) => {
            const active = typeFilter === type;
            const color = KB_TYPE_META[type]?.color || '#9ca3af';
            return (
              <button
                key={type} type="button" onClick={() => setTypeFilter(active ? null : type)}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border flex items-center gap-1"
                style={{ borderRadius: 2, color: active ? '#0a0a0a' : color, background: active ? color : 'transparent', borderColor: active ? color : '#2e2e2e' }}
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
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-500 text-center px-6">
            <BookOpen className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Search the entire system by what you see.</p>
            <p className="text-xs text-rmpg-600 mt-1 max-w-md">
              Results are matched and shown by their visible assignment number or name — a call number,
              person, plate, warrant or citation number, badge, unit call sign, or statute cite — not
              internal record ids.
            </p>
          </div>
        )}
        {searched && !loading && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-rmpg-400">
            <Search className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">No records match “{query.trim()}”.</p>
          </div>
        )}
        {shown.map((r) => {
          const Icon = iconFor(r.type);
          const color = KB_TYPE_META[r.type]?.color || '#9ca3af';
          return (
            <button
              key={`${r.type}-${r.recordId}`} type="button" onClick={() => open(r)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-surface-raised/40 border border-rmpg-800 hover:border-brand-600 transition-colors"
              style={{ borderRadius: 2 }}
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
