// ============================================================
// RMPG Flex — Utah Law Book (advanced reference system)
// A formally-formatted, browsable reference for the Utah Code + Administrative
// Code in utah_statutes. Covers the criminal/vehicle/licensing core PLUS the
// LE-relevant expansion (Criminal Procedure, Public Safety, Juvenile Justice,
// Wildlife, Alcohol, Controlled Substances, Protective Orders) and the matching
// admin rules. Backed by /api/statutes (search / toc / chapter).
//
// Layout: a stats ribbon, data-driven category + offense-level filters, a
// collapsible table-of-contents, a category landing overview, and a premium
// statute reader that re-indents the nested (1)(a)(i) legal outline AND surfaces
// the plain-language ("basic language and understanding") summary for each
// section. Any section or whole chapter can be printed to a formatted PDF.
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Scale, Search, ChevronRight, ChevronDown, ExternalLink, Loader2, BookOpen,
  Gavel, Car, ShieldCheck, FileText, X, ArrowLeft, Layers, Printer, Sparkles,
  Pill, ShieldAlert, Users, Leaf, Wine, Shield, Banknote, type LucideIcon,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { OffenseLevelBadge, type StatuteResult } from '../components/StatuteLookup';
import { parseOutline } from '../utils/statuteOutline';
import { generateStatutePdf, printStatuteSection, printStatuteChapter } from '../utils/statutePdfGenerator';

interface TocRow {
  category: string;
  title: number;
  chapter: number;
  chapter_code: string;
  subcategory: string;
  code_type: string;
  section_count: number;
  offense_count: number;
  summary_count: number;
}

type CategoryKey = string; // 'all' | one of the CATEGORY_META keys

interface CatMeta { label: string; short: string; blurb: string; icon: LucideIcon; accent: string }

// Full category taxonomy. The filter bar + landing render only the categories
// actually present in the data (derived from the TOC), so adding a scraped
// title automatically surfaces here without further UI work.
const CATEGORY_META: Record<string, CatMeta> = {
  criminal:      { label: 'Criminal Code',          short: 'Criminal',   blurb: 'Title 76 — offenses against persons, property, government & public order',          icon: Gavel,       accent: '#ef4444' },
  fraud:         { label: 'Fraud',                  short: 'Fraud',      blurb: 'Title 25 — Statute of Frauds, fraudulent transfers & related fraud law',           icon: Banknote,    accent: '#db2777' },
  procedure:     { label: 'Criminal Procedure',     short: 'Procedure',  blurb: 'Title 77 — arrest, search & seizure, warrants, evidence & trial process',          icon: Scale,       accent: '#d4a017' },
  vehicle:       { label: 'Motor Vehicle & Traffic',short: 'Vehicle',    blurb: 'Title 41 — traffic code, DUI, registration, equipment & licensing',                icon: Car,         accent: '#fb923c' },
  controlled:    { label: 'Controlled Substances',  short: 'Drugs',      blurb: 'Title 58 ch 37 — schedules, possession, distribution & paraphernalia',             icon: Pill,        accent: '#f59e0b' },
  public_safety: { label: 'Public Safety',          short: 'Pub Safety', blurb: 'Title 53 — peace officer standards (POST), highway patrol & emergency management',  icon: ShieldAlert, accent: '#22c55e' },
  juvenile:      { label: 'Juvenile Justice',       short: 'Juvenile',   blurb: 'Title 80 — juvenile court, delinquency, custody & child welfare',                   icon: Users,       accent: '#a3e635' },
  wildlife:      { label: 'Wildlife Resources',     short: 'Wildlife',   blurb: 'Title 23A — hunting, fishing, licensing & wildlife offenses',                       icon: Leaf,        accent: '#65a30d' },
  alcohol:       { label: 'Alcoholic Beverage',     short: 'Alcohol',    blurb: 'Title 32B — alcohol control, licensing & related offenses',                        icon: Wine,        accent: '#b45309' },
  protective:    { label: 'Protective Orders',      short: 'Protective', blurb: 'Title 78B ch 7 — protective orders, stalking injunctions & enforcement',            icon: Shield,      accent: '#e11d48' },
  licensing:     { label: 'Security · PI · Process',short: 'Licensing',  blurb: 'Title 58/78B licensing statutes + implementing administrative rules',               icon: ShieldCheck, accent: '#9ca3af' },
};
const CATEGORY_ORDER = ['criminal', 'fraud', 'procedure', 'vehicle', 'controlled', 'public_safety', 'juvenile', 'wildlife', 'alcohol', 'protective', 'licensing'];
function getCatMeta(cat: string): CatMeta {
  return CATEGORY_META[cat] || { label: cat.replace(/_/g, ' '), short: cat, blurb: '', icon: Layers, accent: '#888888' };
}

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

function StatuteBody({ text }: { text: string }) {
  const segs = parseOutline(text);
  return (
    <div style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
      {segs.map((s, i) => (
        <p
          key={i}
          className="text-[12.5px] text-rmpg-100 leading-relaxed"
          style={{
            paddingLeft: 16 + s.depth * 26,
            textIndent: s.marker ? -16 : 0,        // hanging indent: marker hangs, wraps align under text
            marginTop: s.depth === 0 && i > 0 ? 8 : 2,
          }}
        >
          {s.marker && <span className="font-mono font-semibold text-brand-gold-500 mr-1.5">{s.marker}</span>}
          {s.text}
        </p>
      ))}
    </div>
  );
}

// "Basic language and understanding" panel — the AI plain-language summary +
// key-point bullets, shown above the verbatim statutory text in the reader.
function PlainLanguagePanel({ s }: { s: StatuteResult }) {
  if (!s.plain_summary) return null;
  const els = Array.isArray(s.plain_elements) ? s.plain_elements : [];
  return (
    <div className="bg-surface-sunken border border-rmpg-800" style={{ borderRadius: 2, borderLeft: '2px solid #d4a017' }}>
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <Sparkles className="w-3 h-3 text-brand-gold-500" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-brand-gold-500">Plain Language</span>
        <span className="text-[8px] uppercase tracking-wider text-rmpg-600 border border-rmpg-700 px-1 py-px" style={{ borderRadius: 2 }}>AI summary</span>
      </div>
      <p className="px-3 pt-1.5 text-[12px] text-rmpg-100 leading-relaxed">{s.plain_summary}</p>
      {els.length > 0 && (
        <ul className="px-3 pt-1.5 pb-1 space-y-0.5">
          {els.map((e, i) => (
            <li key={i} className="text-[11px] text-rmpg-300 leading-snug flex gap-1.5">
              <span className="text-brand-gold-500 shrink-0">•</span><span>{e}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="px-3 pb-2 pt-1 text-[8.5px] text-rmpg-600 italic">
        AI-generated reference aid — verify against the verbatim text below.
      </div>
    </div>
  );
}

export default function LawBookPage() {
  const [toc, setToc] = useState<TocRow[]>([]);
  const [tocLoading, setTocLoading] = useState(true);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [level, setLevel] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
    const cats = new Set<string>();
    const s = { total: 0, rules: 0, offenses: 0, summaries: 0, chapters: toc.length };
    for (const r of toc) {
      s.total += r.section_count;
      s.summaries += r.summary_count || 0;
      if (r.code_type === 'rule') s.rules += r.section_count;
      s.offenses += r.offense_count;
      cats.add(r.category);
    }
    return { ...s, areas: cats.size };
  }, [toc]);

  // Categories actually present, in the canonical order (unknowns appended).
  const categoriesPresent = useMemo(() => {
    const set = new Set(toc.map((r) => r.category));
    return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c))];
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

  // Print whatever the reader is currently showing (a chapter, or search results).
  const handlePrint = () => {
    if (!visibleSections.length) return;
    if (showingSearch) {
      generateStatutePdf({
        docTitle: 'Search Results',
        subtitle: query.trim() ? `“${query.trim()}”${level ? ` · ${level.replace(/_/g, ' ')}` : ''}` : 'Filtered results',
        sections: visibleSections,
        fileName: 'RMPG-LawBook-Search',
      });
    } else if (chapter) {
      const titleCode = visibleSections[0]?.citation.split('-')[0] || String(chapter.title);
      printStatuteChapter(titleCode, chapter.code, chapter.name, visibleSections);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="UTAH LAW BOOK" icon={Scale} />

      {/* ── Stats ribbon ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Sections', value: stats.total, accent: '#d4a017' },
          { label: 'Areas of Law', value: stats.areas, accent: '#ef4444' },
          { label: 'Chapters', value: stats.chapters, accent: '#fb923c' },
          { label: 'Plain-Language', value: stats.summaries, accent: '#22c55e' },
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
          <button type="button" onClick={() => { setCategory('all'); resetToBrowse(); }}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
            style={{ background: category === 'all' ? '#d4a017' : '#141414', color: category === 'all' ? '#0a0a0a' : '#888888', borderColor: category === 'all' ? '#d4a017' : '#222222', borderRadius: 2 }}>
            All Law
          </button>
          {categoriesPresent.map((c) => {
            const meta = getCatMeta(c);
            const active = category === c;
            return (
              <button key={c} type="button"
                onClick={() => { setCategory(c); resetToBrowse(); }}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
                style={{ background: active ? meta.accent : '#141414', color: active ? '#0a0a0a' : '#888888', borderColor: active ? meta.accent : '#222222', borderRadius: 2 }}>
                {meta.short}
              </button>
            );
          })}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder='Search — "76-5-102", "assault", "DUI", "arrest", "stalking"…'
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
            categoriesPresent.filter((c) => grouped[c]).map((cat) => {
              const rows = grouped[cat];
              const meta = getCatMeta(cat);
              const Icon = meta.icon;
              const open = openGroups[cat] ?? true;
              return (
                <div key={cat}>
                  <button type="button" onClick={() => setOpenGroups((g) => ({ ...g, [cat]: !(g[cat] ?? true) }))}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider hover:bg-surface-base border-b border-rmpg-900"
                    style={{ color: meta.accent }}>
                    {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <Icon className="w-3 h-3" />
                    {meta.label}
                    <span className="ml-auto text-rmpg-600 font-mono">{rows.length}</span>
                  </button>
                  {open && rows.map((r) => (
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
            {(chapter || showingSearch) && visibleSections.length > 0 && (
              <button type="button" onClick={handlePrint}
                className="ml-auto flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-rmpg-400 hover:text-brand-gold-500 border border-rmpg-700 px-2 py-1"
                style={{ borderRadius: 2 }} title="Print to PDF">
                <Printer className="w-3 h-3" /> PDF
              </button>
            )}
          </div>

          {/* Landing overview */}
          {!showingSearch && !chapter ? (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {categoriesPresent.map((c) => {
                const meta = getCatMeta(c); const Icon = meta.icon;
                const count = toc.filter((r) => r.category === c).reduce((a, r) => a + r.section_count, 0);
                return (
                  <button key={c} type="button" onClick={() => { setCategory(c); setOpenGroups((g) => ({ ...g, [c]: true })); }}
                    className="text-left border border-rmpg-800 bg-surface-base hover:bg-surface-sunken p-3 transition-colors"
                    style={{ borderRadius: 2, borderTop: `2px solid ${meta.accent}` }}>
                    <Icon className="w-5 h-5 mb-2" style={{ color: meta.accent }} />
                    <div className="text-[12px] font-bold text-white">{meta.label}</div>
                    <div className="text-[10px] text-rmpg-500 leading-snug mt-1">{meta.blurb}</div>
                    <div className="text-[10px] font-mono mt-2" style={{ color: meta.accent }}>{count.toLocaleString()} sections →</div>
                  </button>
                );
              })}
              <div className="sm:col-span-2 xl:col-span-3 text-[10px] text-rmpg-600 leading-relaxed pt-1">
                <FileText className="w-3 h-3 inline mr-1 -mt-0.5" />
                Verbatim text scraped from le.utah.gov &amp; adminrules.utah.gov; each section links back to the official source and carries a plain-language summary. Use the severity chips to list all offenses of a class, open a chapter to read it in full, or print any section or chapter to PDF.
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
                      {s.plain_summary && <Sparkles className="w-3 h-3 text-brand-gold-500/70 shrink-0 mt-0.5" aria-label="Has plain-language summary" />}
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
                          <div className="ml-auto flex items-center gap-3">
                            <button type="button" onClick={() => printStatuteSection(s)}
                              className="inline-flex items-center gap-1 text-rmpg-400 hover:text-brand-gold-500" title="Print this section to PDF">
                              <Printer className="w-3 h-3" /> PDF
                            </button>
                            {s.source_url && (
                              <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                                 className="inline-flex items-center gap-1 text-brand-gold-500 hover:underline">
                                Official source <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                        <PlainLanguagePanel s={s} />
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
