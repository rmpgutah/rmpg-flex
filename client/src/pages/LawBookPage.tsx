// ============================================================
// RMPG Flex — Utah Law Book
// Browsable, formally-formatted reference for the Utah Code offenses + licensing
// law seeded into utah_statutes (Title 76 Criminal, Title 41 Motor Vehicles,
// Title 58 Security/PI licensing, Title 78B Process Server) and the matching
// administrative rules. Backed by /api/statutes (search / toc / chapter / section).
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Scale, Search, ChevronRight, ChevronDown, ExternalLink, Loader2, BookOpen } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import EmptyState from '../components/EmptyState';
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

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All Law' },
  { key: 'criminal', label: 'Criminal (Title 76)' },
  { key: 'vehicle', label: 'Motor Vehicle (Title 41)' },
  { key: 'licensing', label: 'Licensing (58 / 78B)' },
];

const CATEGORY_LABEL: Record<string, string> = {
  criminal: 'Utah Criminal Code',
  vehicle: 'Motor Vehicle Code',
  licensing: 'Security · PI · Process Server',
};

export default function LawBookPage() {
  const [category, setCategory] = useState<CategoryKey>('all');
  const [toc, setToc] = useState<TocRow[]>([]);
  const [tocLoading, setTocLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ criminal: true });

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatuteResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [chapter, setChapter] = useState<{ title: number; code: string; name: string } | null>(null);
  const [sections, setSections] = useState<StatuteResult[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Table of contents ─────────────────────────────────────
  useEffect(() => {
    setTocLoading(true);
    const catParam = category === 'all' ? '' : `?category=${category}`;
    apiFetch<{ data: TocRow[] }>(`/statutes/toc${catParam}`)
      .then((r) => setToc(r.data || []))
      .catch(() => setToc([]))
      .finally(() => setTocLoading(false));
  }, [category]);

  // TOC grouped by category → chapters
  const grouped = useMemo(() => {
    const g: Record<string, TocRow[]> = {};
    for (const row of toc) {
      (g[row.category] ||= []).push(row);
    }
    return g;
  }, [toc]);

  // ── Search ────────────────────────────────────────────────
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    debounce.current = setTimeout(() => {
      const catParam = category === 'all' ? '' : `&category=${category}`;
      apiFetch<{ data: StatuteResult[] }>(`/statutes/search?q=${encodeURIComponent(query.trim())}${catParam}&limit=40`)
        .then((r) => setResults(r.data || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, category]);

  const loadChapter = useCallback((title: number, code: string, name: string) => {
    setChapter({ title, code, name });
    setQuery('');
    setResults(null);
    setOpenSection(null);
    setSectionsLoading(true);
    apiFetch<{ data: StatuteResult[] }>(`/statutes/chapter?title=${title}&chapter=${encodeURIComponent(code)}`)
      .then((r) => setSections(r.data || []))
      .catch(() => setSections([]))
      .finally(() => setSectionsLoading(false));
  }, []);

  const shown = results !== null ? results : sections;
  const showingSearch = results !== null;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="UTAH LAW BOOK" icon={Scale} />

      {/* Category tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => { setCategory(c.key); setChapter(null); setResults(null); setQuery(''); }}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
            style={{
              background: category === c.key ? '#d4a017' : '#141414',
              color: category === c.key ? '#0a0a0a' : '#888888',
              borderColor: category === c.key ? '#d4a017' : '#222222',
              borderRadius: 2,
            }}
          >
            {c.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search statutes — "76-5-102", "assault", "DUI", "security guard"…'
            className="w-full pl-8 pr-3 py-2 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder:text-rmpg-500"
            style={{ borderRadius: 2 }}
          />
          {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-gold-500 animate-spin" />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* ── TOC sidebar ── */}
        <div className="border border-rmpg-800 bg-surface-raised" style={{ borderRadius: 2, maxHeight: '70vh', overflowY: 'auto' }}>
          <div className="px-3 py-2 border-b border-rmpg-800 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" /> Table of Contents
          </div>
          {tocLoading ? (
            <div className="p-4 text-center"><Loader2 className="w-4 h-4 text-brand-gold-500 animate-spin inline" /></div>
          ) : (
            Object.entries(grouped).map(([cat, rows]) => (
              <div key={cat}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((g) => ({ ...g, [cat]: !g[cat] }))}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-gold-500 hover:bg-surface-base border-b border-rmpg-900"
                >
                  {openGroups[cat] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {CATEGORY_LABEL[cat] || cat}
                  <span className="ml-auto text-rmpg-500 font-mono">{rows.length}</span>
                </button>
                {openGroups[cat] && rows.map((r) => (
                  <button
                    key={`${r.title}-${r.chapter_code}`}
                    type="button"
                    onClick={() => loadChapter(r.title, r.chapter_code, r.subcategory)}
                    className="w-full text-left px-3 py-1.5 hover:bg-surface-base flex items-baseline gap-2 border-b border-rmpg-900"
                    style={chapter?.title === r.title && chapter?.code === r.chapter_code ? { background: '#1a1a1a' } : undefined}
                  >
                    <span className="text-[10px] font-mono text-rmpg-500 shrink-0">{r.title}-{r.chapter_code}</span>
                    <span className="text-[11px] text-rmpg-200 leading-tight">{r.subcategory}</span>
                    <span className="ml-auto text-[9px] font-mono text-rmpg-600 shrink-0">{r.section_count}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        {/* ── Main reading pane ── */}
        <div className="border border-rmpg-800 bg-surface-raised" style={{ borderRadius: 2, maxHeight: '70vh', overflowY: 'auto' }}>
          <div className="px-3 py-2 border-b border-rmpg-800 text-[11px] font-bold uppercase tracking-wider text-rmpg-300 sticky top-0 bg-surface-raised z-10">
            {showingSearch
              ? `Search · ${shown.length} result${shown.length === 1 ? '' : 's'}`
              : chapter
                ? `${chapter.title}-${chapter.code} · ${chapter.name}`
                : 'Select a chapter or search'}
          </div>

          {!showingSearch && !chapter ? (
            <EmptyState icon={Scale} title="Utah Law Book" description="Pick a chapter from the table of contents, or search by citation, keyword, or offense." />
          ) : sectionsLoading ? (
            <div className="p-6 text-center"><Loader2 className="w-5 h-5 text-brand-gold-500 animate-spin inline" /></div>
          ) : shown.length === 0 ? (
            <EmptyState icon={Search} title="Nothing found" description={showingSearch ? 'No statutes match that search.' : 'This chapter has no sections.'} />
          ) : (
            <div className="divide-y divide-rmpg-900">
              {shown.map((s) => {
                const open = openSection === s.citation;
                return (
                  <div key={s.id ?? s.citation}>
                    <button
                      type="button"
                      onClick={() => setOpenSection(open ? null : s.citation)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-base flex items-start gap-2"
                    >
                      {open ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" />}
                      <span className="font-mono text-[11px] text-brand-gold-500 shrink-0 w-24">{s.citation}</span>
                      <span className="text-[12px] text-white leading-tight flex-1">{s.short_title}</span>
                      {s.code_type === 'rule' && (
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border border-rmpg-600 text-rmpg-400 shrink-0" style={{ borderRadius: 2 }}>Rule</span>
                      )}
                      {s.offense_level && <OffenseLevelBadge level={s.offense_level} />}
                    </button>
                    {open && (
                      <div className="px-3 pb-4 pl-9 space-y-2">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-rmpg-400">
                          {s.subcategory && <span>{s.subcategory}{s.part_name ? ` · ${s.part_name}` : ''}</span>}
                          {s.effective_date && <span>Effective {s.effective_date}</span>}
                          {s.source_url && (
                            <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 text-brand-gold-500 hover:underline">
                              le.utah.gov <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div
                          className="text-[12px] text-rmpg-100 leading-relaxed border-l-2 border-rmpg-800 pl-3"
                          style={{ whiteSpace: 'pre-wrap', fontFamily: 'Georgia, "Times New Roman", serif' }}
                        >
                          {s.description || 'No text on file for this section.'}
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
