// ============================================================
// RMPG Flex — Utah Law Book (advanced reference system)
// A formally-formatted, browsable reference for the Utah Code offenses +
// licensing law in utah_statutes (Title 76 Criminal, Title 41 Motor Vehicles,
// Title 58 Security/PI licensing, Title 78B Process Server) and the matching
// Administrative Code rules. Backed by /api/statutes (search / toc / chapter).
//
// Replaces the old MenuBar "Law Books" modal. Layout: a stats ribbon, color-
// coded offense-level + category filters, a collapsible table-of-contents, a
// category landing overview, and a premium statute reader that re-indents the
// nested (1)(a)(i) legal outline.
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Scale, Search, ChevronRight, ChevronDown, ExternalLink, Loader2, BookOpen,
  Gavel, Car, ShieldCheck, FileText, X, ArrowLeft, Layers,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { OffenseLevelBadge, type StatuteResult } from '../components/StatuteLookup';

interface TocRow {
  category: 'criminal' | 'vehicle' | 'licensing';
  title: number;
  chapter: number;
  chapter_code: string;
  subcategory: string;
  code_type: string;
  section_count: number;
  offense_count: number;
}

type CategoryKey = 'all' | 'criminal' | 'vehicle' | 'licensing';

const CATEGORY_META: Record<Exclude<CategoryKey, 'all'>, { label: string; blurb: string; icon: typeof Gavel; accent: string }> = {
  criminal: { label: 'Criminal Code', blurb: 'Title 76 — offenses against persons, property, government & public order', icon: Gavel, accent: '#d4a017' },
  vehicle: { label: 'Motor Vehicle & Traffic', blurb: 'Title 41 — traffic code, DUI, registration, equipment & licensing', icon: Car, accent: '#c08a13' },
  licensing: { label: 'Security · PI · Process Server', blurb: 'Title 58/78B licensing statutes + the implementing administrative rules', icon: ShieldCheck, accent: '#9a6f0f' },
};

// Offense-level filter chips, ordered most→least severe, color-coded.
const LEVELS: { key: string; short: string; dot: string }[] = [
  { key: 'capital_felony', short: 'Capital', dot: '#dc2626' },
  { key: 'first_degree_felony', short: '1° Felony', dot: '#ef4444' },
  { key: 'second_degree_felony', short: '2° Felony', dot: '#f87171' },
  { key: 'third_degree_felony', short: '3° Felony', dot: '#fb923c' },
  { key: 'class_a_misdemeanor', short: 'Class A', dot: '#fbbf24' },
  { key: 'class_b_misdemeanor', short: 'Class B', dot: '#facc15' },
  { key: 'class_c_misdemeanor', short: 'Class C', dot: '#eab308' },
  { key: 'infraction', short: 'Infraction', dot: '#9ca3af' },
];

// Indent depth for a statutory line, from its leading (1)/(a)/(i)/(A) marker.
function lineDepth(line: string): number {
  const m = line.match(/^\(([0-9a-zA-Z]{1,4})\)/);
  if (!m) return -1; // continuation / prose
  const tok = m[1];
  if (/^\d+$/.test(tok)) return 0;
  if (/^[ivxl]{2,}$/.test(tok)) return 2;      // roman numerals (ii, iii, iv…)
  if (/^[A-Z]+$/.test(tok)) return 3;          // (A), (B)…
  if (/^[a-z]$/.test(tok)) return 1;           // single letter (a)…
  if (/^[ivxl]$/.test(tok)) return 2;          // lone roman (i)
  return 1;
}

function StatuteBody({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  let last = 0;
  return (
    <div className="space-y-1" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      {lines.map((ln, i) => {
        let d = lineDepth(ln);
        if (d < 0) d = last; else last = d;
        const marker = ln.match(/^(\([0-9a-zA-Z]{1,4}\)(\s*\([0-9a-zA-Z]{1,4}\))*)\s*/);
        const head = marker ? marker[1] : '';
        const rest = marker ? ln.slice(marker[0].length) : ln;
        return (
          <p key={i} className="text-[12.5px] text-rmpg-100 leading-relaxed" style={{ paddingLeft: d * 18 }}>
            {head && <span className="font-mono text-brand-gold-500 mr-1.5">{head}</span>}
            {rest}
          </p>
        );
      })}
    </div>
  );
}

export default function LawBookPage() {
  const [toc, setToc] = useState<TocRow[]>([]);
  const [tocLoading, setTocLoading] = useState(true);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [level, setLevel] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ criminal: true, vehicle: true, licensing: true });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatuteResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [chapter, setChapter] = useState<{ title: number; code: string; name: string } | null>(null);
  const [sections, setSections] = useState<StatuteResult[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Full TOC fetched once; stats + category filtering derived client-side.
  useEffect(() => {
    apiFetch<{ data: TocRow[] }>(`/statutes/toc`)
      .then((r) => setToc(r.data || []))
      .catch(() => setToc([]))
      .finally(() => setTocLoading(false));
  }, []);

  const stats = useMemo(() => {
    const s = { total: 0, criminal: 0, vehicle: 0, licensing: 0, rules: 0, offenses: 0 };
    for (const r of toc) {
      s.total += r.section_count;
      s[r.category] += r.section_count;
      if (r.code_type === 'rule') s.rules += r.section_count;
      s.offenses += r.offense_count;
    }
    return s;
  }, [toc]);

  const grouped = useMemo(() => {
    const g: Record<string, TocRow[]> = {};
    for (const r of toc) {
      if (category !== 'all' && r.category !== category) continue;
      (g[r.category] ||= []).push(r);
    }
    return g;
  }, [toc, category]);

  // Search (debounced). A level chip with no text still searches by level.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2 && !level) { setResults(null); setSearching(false); return; }
    setSearching(true);
    debounce.current = setTimeout(() => {
      const params = new URLSearchParams({ limit: '60' });
      if (q.length >= 2) params.set('q', q);
      if (category !== 'all') params.set('category', category);
      if (level) params.set('level', level);
      apiFetch<{ data: StatuteResult[] }>(`/statutes/search?${params}`)
        .then((r) => setResults(r.data || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 280);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, category, level]);

  const loadChapter = useCallback((title: number, code: string, name: string) => {
    setChapter({ title, code, name });
    setQuery(''); setResults(null); setLevel(null); setOpenSection(null);
    setSectionsLoading(true);
    apiFetch<{ data: StatuteResult[] }>(`/statutes/chapter?title=${title}&chapter=${encodeURIComponent(code)}`)
      .then((r) => setSections(r.data || []))
      .catch(() => setSections([]))
      .finally(() => setSectionsLoading(false));
  }, []);

  const showingSearch = results !== null;
  const shown = showingSearch ? results! : sections;
  const visibleSections = level && !showingSearch ? shown.filter((s) => s.offense_level === level) : shown;

  const resetToBrowse = () => { setChapter(null); setResults(null); setQuery(''); setLevel(null); setOpenSection(null); };

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="UTAH LAW BOOK" icon={Scale} />

      {/* ── Stats ribbon ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Sections', value: stats.total, accent: '#d4a017' },
          { label: 'Criminal', value: stats.criminal, accent: '#ef4444' },
          { label: 'Vehicle', value: stats.vehicle, accent: '#fb923c' },
          { label: 'Licensing', value: stats.licensing, accent: '#22c55e' },
          { label: 'Admin Rules', value: stats.rules, accent: '#888888' },
          { label: 'Classified Offenses', value: stats.offenses, accent: '#fbbf24' },
        ].map((t) => (
          <div key={t.label} className="border border-rmpg-800 bg-surface-raised px-3 py-2" style={{ borderRadius: 2, borderTop: `2px solid ${t.accent}` }}>
            <div className="text-[18px] font-black tabular-nums leading-none text-white">{tocLoading ? '—' : t.value.toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'criminal', 'vehicle', 'licensing'] as CategoryKey[]).map((c) => (
            <button key={c} type="button"
              onClick={() => { setCategory(c); resetToBrowse(); }}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
              style={{
                background: category === c ? '#d4a017' : '#141414',
                color: category === c ? '#0a0a0a' : '#888888',
                borderColor: category === c ? '#d4a017' : '#222222', borderRadius: 2,
              }}>
              {c === 'all' ? 'All Law' : CATEGORY_META[c].label}
            </button>
          ))}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder='Search — "76-5-102", "assault", "DUI", "security guard"…'
              className="w-full pl-8 pr-8 py-2 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder:text-rmpg-500" style={{ borderRadius: 2 }} />
            {(query || level) && (
              <button type="button" onClick={resetToBrowse} aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white">
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-gold-500" /> : <X className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
        {/* Offense-level chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-rmpg-600 mr-1">Severity</span>
          {LEVELS.map((l) => (
            <button key={l.key} type="button"
              onClick={() => setLevel(level === l.key ? null : l.key)}
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold border"
              style={{
                background: level === l.key ? '#1a1a1a' : '#0a0a0a',
                borderColor: level === l.key ? l.dot : '#222222',
                color: level === l.key ? '#fff' : '#888888', borderRadius: 2,
              }}>
              <span className="w-2 h-2 rounded-full" style={{ background: l.dot }} />
              {l.short}
            </button>
          ))}
        </div>
      </div>

      {/* ── Two-pane ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-3">
        {/* TOC */}
        <div className="border border-rmpg-800 bg-surface-raised" style={{ borderRadius: 2, maxHeight: '64vh', overflowY: 'auto' }}>
          <div className="px-3 py-2 border-b border-rmpg-800 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 flex items-center gap-1.5 sticky top-0 bg-surface-raised z-10">
            <BookOpen className="w-3 h-3" /> Table of Contents
          </div>
          {tocLoading ? (
            <div className="p-4 text-center"><Loader2 className="w-4 h-4 text-brand-gold-500 animate-spin inline" /></div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="p-4 text-[10px] text-rmpg-500 text-center uppercase tracking-wider">No chapters</div>
          ) : (
            Object.entries(grouped).map(([cat, rows]) => {
              const meta = CATEGORY_META[cat as Exclude<CategoryKey, 'all'>];
              const Icon = meta?.icon || Layers;
              return (
                <div key={cat}>
                  <button type="button" onClick={() => setOpenGroups((g) => ({ ...g, [cat]: !g[cat] }))}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-gold-500 hover:bg-surface-base border-b border-rmpg-900">
                    {openGroups[cat] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <Icon className="w-3 h-3" />
                    {meta?.label || cat}
                    <span className="ml-auto text-rmpg-600 font-mono">{rows.length}</span>
                  </button>
                  {openGroups[cat] && rows.map((r) => (
                    <button key={`${r.title}-${r.chapter_code}`} type="button"
                      onClick={() => loadChapter(r.title, r.chapter_code, r.subcategory)}
                      className="w-full text-left px-3 py-1.5 hover:bg-surface-base flex items-baseline gap-2 border-b border-rmpg-900"
                      style={chapter?.title === r.title && chapter?.code === r.chapter_code ? { background: '#1a1a1a', boxShadow: 'inset 2px 0 0 #d4a017' } : undefined}>
                      <span className="text-[10px] font-mono text-rmpg-500 shrink-0">{r.title}-{r.chapter_code}</span>
                      <span className="text-[11px] text-rmpg-200 leading-tight">{r.subcategory}</span>
                      <span className="ml-auto text-[9px] font-mono text-rmpg-600 shrink-0">{r.section_count}</span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Reader */}
        <div className="border border-rmpg-800 bg-surface-raised" style={{ borderRadius: 2, maxHeight: '64vh', overflowY: 'auto' }}>
          <div className="px-3 py-2 border-b border-rmpg-800 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rmpg-300 sticky top-0 bg-surface-raised z-10">
            {(chapter || showingSearch) && (
              <button type="button" onClick={resetToBrowse} className="text-rmpg-500 hover:text-brand-gold-500 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" />
              </button>
            )}
            <span className="truncate">
              {showingSearch
                ? `Search · ${visibleSections.length} result${visibleSections.length === 1 ? '' : 's'}`
                : chapter ? `${chapter.title}-${chapter.code} · ${chapter.name}` : 'Browse the Utah Law Book'}
            </span>
          </div>

          {/* Landing overview */}
          {!showingSearch && !chapter ? (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['criminal', 'vehicle', 'licensing'] as const).map((c) => {
                const meta = CATEGORY_META[c]; const Icon = meta.icon;
                const count = stats[c];
                return (
                  <button key={c} type="button" onClick={() => { setCategory(c); setOpenGroups((g) => ({ ...g, [c]: true })); }}
                    className="text-left border border-rmpg-800 bg-surface-base hover:bg-surface-sunken p-3 transition-colors"
                    style={{ borderRadius: 2, borderTop: `2px solid ${meta.accent}` }}>
                    <Icon className="w-5 h-5 mb-2" style={{ color: meta.accent }} />
                    <div className="text-[12px] font-bold text-white">{meta.label}</div>
                    <div className="text-[10px] text-rmpg-500 leading-snug mt-1">{meta.blurb}</div>
                    <div className="text-[10px] font-mono text-brand-gold-500 mt-2">{count.toLocaleString()} sections →</div>
                  </button>
                );
              })}
              <div className="sm:col-span-3 text-[10px] text-rmpg-600 leading-relaxed pt-1">
                <FileText className="w-3 h-3 inline mr-1 -mt-0.5" />
                Scraped from le.utah.gov &amp; adminrules.utah.gov. Each section links back to the official source. Use the severity chips to list all offenses of a given class, or open a chapter to read it in full.
              </div>
            </div>
          ) : sectionsLoading ? (
            <div className="p-6 text-center"><Loader2 className="w-5 h-5 text-brand-gold-500 animate-spin inline" /></div>
          ) : visibleSections.length === 0 ? (
            <div className="p-6 text-[10px] text-rmpg-500 text-center uppercase tracking-wider">
              {showingSearch ? 'No statutes match' : level ? 'No sections at this severity in this chapter' : 'This chapter has no sections'}
            </div>
          ) : (
            <div className="divide-y divide-rmpg-900">
              {visibleSections.map((s) => {
                const open = openSection === s.citation;
                return (
                  <div key={s.id ?? s.citation} style={open ? { background: '#0d0d0d' } : undefined}>
                    <button type="button" onClick={() => setOpenSection(open ? null : s.citation)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-base flex items-start gap-2">
                      {open ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" />}
                      <span className="font-mono text-[11px] text-brand-gold-500 shrink-0 w-24">{s.citation}</span>
                      <span className="text-[12px] text-white leading-tight flex-1">{s.short_title}</span>
                      {s.code_type === 'rule' && (
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border border-rmpg-600 text-rmpg-400 shrink-0" style={{ borderRadius: 2 }}>Rule</span>
                      )}
                      {s.offense_level && <OffenseLevelBadge level={s.offense_level} />}
                    </button>
                    {open && (
                      <div className="px-3 pb-4 pl-9 space-y-3">
                        {/* Reader header card */}
                        <div className="border border-rmpg-800 bg-surface-sunken px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-rmpg-400" style={{ borderRadius: 2 }}>
                          <span className="font-mono text-brand-gold-500 text-[11px]">{s.citation}</span>
                          {s.offense_level && <OffenseLevelBadge level={s.offense_level} />}
                          {s.subcategory && <span>{s.subcategory}{s.part_name ? ` · ${s.part_name}` : ''}</span>}
                          {s.effective_date && <span>Effective {s.effective_date}</span>}
                          {s.code_type === 'rule' && <span className="uppercase tracking-wider">Admin Rule</span>}
                          {s.source_url && (
                            <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 text-brand-gold-500 hover:underline ml-auto">
                              Official source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="border-l-2 border-brand-gold-500/30 pl-3">
                          {s.description ? <StatuteBody text={s.description} /> : <span className="text-[11px] text-rmpg-500 italic">No text on file for this section.</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
