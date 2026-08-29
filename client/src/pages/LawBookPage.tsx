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
import { useSearchParams } from 'react-router';
import {
  Scale, Search, ChevronRight, ChevronDown, ExternalLink, Loader2, BookOpen,
  Gavel, Car, ShieldCheck, FileText, X, ArrowLeft, Layers, Printer, Sparkles,
  Pill, ShieldAlert, Users, Leaf, Wine, Shield, Banknote, History, type LucideIcon,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { OffenseLevelBadge, type StatuteResult } from '../components/StatuteLookup';
import { parseOutline } from '../utils/statuteOutline';
import { generateStatutePdf, printStatuteSection, printStatuteChapter } from '../utils/statutePdfGenerator';
import { toDisplayLabel } from '../utils/formatters';

// Roles allowed to add/edit/delete statutes.
const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

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
  criminal:      { label: 'Criminal Code',          short: 'Criminal',   blurb: 'Title 76 — offenses against persons, property, government & public order',          icon: Gavel,       accent: 'var(--sev-critical)' },
  fraud:         { label: 'Fraud',                  short: 'Fraud',      blurb: 'Title 25 — Statute of Frauds, fraudulent transfers & related fraud law',           icon: Banknote,    accent: '#db2777' },
  procedure:     { label: 'Criminal Procedure',     short: 'Procedure',  blurb: 'Title 77 — arrest, search & seizure, warrants, evidence & trial process',          icon: Scale,       accent: 'var(--brand-gold)' },
  vehicle:       { label: 'Motor Vehicle & Traffic',short: 'Vehicle',    blurb: 'Title 41 — traffic code, DUI, registration, equipment & licensing',                icon: Car,         accent: '#fb923c' },
  controlled:    { label: 'Controlled Substances',  short: 'Drugs',      blurb: 'Title 58 ch 37 — schedules, possession, distribution & paraphernalia',             icon: Pill,        accent: 'var(--sev-warn)' },
  public_safety: { label: 'Public Safety',          short: 'Pub Safety', blurb: 'Title 53 — peace officer standards (POST), highway patrol & emergency management',  icon: ShieldAlert, accent: 'var(--sev-ok)' },
  juvenile:      { label: 'Juvenile Justice',       short: 'Juvenile',   blurb: 'Title 80 — juvenile court, delinquency, custody & child welfare',                   icon: Users,       accent: '#a3e635' },
  wildlife:      { label: 'Wildlife Resources',     short: 'Wildlife',   blurb: 'Title 23A — hunting, fishing, licensing & wildlife offenses',                       icon: Leaf,        accent: '#65a30d' },
  alcohol:       { label: 'Alcoholic Beverage',     short: 'Alcohol',    blurb: 'Title 32B — alcohol control, licensing & related offenses',                        icon: Wine,        accent: '#b45309' },
  protective:    { label: 'Protective Orders',      short: 'Protective', blurb: 'Title 78B ch 7 — protective orders, stalking injunctions & enforcement',            icon: Shield,      accent: '#e11d48' },
  licensing:     { label: 'Security · PI · Process',short: 'Licensing',  blurb: 'Title 58/78B licensing statutes + implementing administrative rules',               icon: ShieldCheck, accent: 'var(--text-secondary)' },
};
const CATEGORY_ORDER = ['criminal', 'fraud', 'procedure', 'vehicle', 'controlled', 'public_safety', 'juvenile', 'wildlife', 'alcohol', 'protective', 'licensing'];
function getCatMeta(cat: string): CatMeta {
  return CATEGORY_META[cat] || { label: toDisplayLabel(cat), short: cat, blurb: '', icon: Layers, accent: 'var(--spm-text-muted)' };
}

// Offense-level filter chips, ordered most→least severe, color-coded.
const LEVELS: { key: string; short: string; dot: string }[] = [
  { key: 'capital_felony', short: 'Capital', dot: 'var(--sev-critical)' },
  { key: 'first_degree_felony', short: '1° Felony', dot: 'var(--sev-critical)' },
  { key: 'second_degree_felony', short: '2° Felony', dot: '#f87171' },
  { key: 'third_degree_felony', short: '3° Felony', dot: '#fb923c' },
  { key: 'class_a_misdemeanor', short: 'Class A', dot: 'var(--sev-warn-soft)' },
  { key: 'class_b_misdemeanor', short: 'Class B', dot: 'var(--sev-caution)' },
  { key: 'class_c_misdemeanor', short: 'Class C', dot: '#eab308' },
  { key: 'infraction', short: 'Infraction', dot: 'var(--rmpg-400)' },
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
    <div className="bg-surface-sunken border border-rmpg-800" style={{ borderRadius: 2, borderLeft: '2px solid var(--brand-gold)' }}>
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

// ── Recent statutes (user-scoped) ──
// Keys: `rmpg_lawbook_recent_<user.id>`. Capped at 8 most-recent.
// Operators frequently re-read the same handful of statutes (DUI, assault,
// trespass) — surfacing them on the landing card cuts the scroll/search cycle.
interface RecentStatute { id: number; citation: string; short_title: string; title: number; chapter_code: string }
const RECENT_MAX = 8;
function recentKey(userId: string | undefined): string {
  return userId ? `rmpg_lawbook_recent_${userId}` : 'rmpg_lawbook_recent_anon';
}
function getRecentStatutes(userId: string | undefined): RecentStatute[] {
  try {
    const raw = localStorage.getItem(recentKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentStatute[]).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function pushRecentStatute(userId: string | undefined, s: StatuteResult): RecentStatute[] {
  if (!s.citation || s.id == null) return getRecentStatutes(userId);
  // Section reader needs chapter context; derive from the citation when the row
  // doesn't carry chapter_code directly (search hits include it via shape()).
  const titleNum = parseInt(String(s.citation).split('-')[0] || '', 10);
  const chap = (s.chapter_code || String(s.citation).split('-')[1] || '').trim();
  if (!Number.isFinite(titleNum) || !chap) return getRecentStatutes(userId);
  const entry: RecentStatute = {
    id: s.id, citation: s.citation, short_title: s.short_title || s.citation,
    title: titleNum, chapter_code: chap,
  };
  try {
    const list = getRecentStatutes(userId).filter((r) => r.citation !== entry.citation);
    list.unshift(entry);
    const next = list.slice(0, RECENT_MAX);
    localStorage.setItem(recentKey(userId), JSON.stringify(next));
    return next;
  } catch { return getRecentStatutes(userId); }
}

export default function LawBookPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [toc, setToc] = useState<TocRow[]>([]);
  const [tocLoading, setTocLoading] = useState(true);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [level, setLevel] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StatuteResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [clearRecentConfirm, setClearRecentConfirm] = useState(false);

  const [chapter, setChapter] = useState<{ title: number; code: string; name: string } | null>(null);
  const [sections, setSections] = useState<StatuteResult[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Recent statutes — hydrated on mount + bumped every time an operator opens
  // a section in the reader. Per-user so a shared workstation doesn't bleed
  // one officer's reading history into another's landing card.
  const [recent, setRecent] = useState<RecentStatute[]>(() => getRecentStatutes(user?.id));
  useEffect(() => { setRecent(getRecentStatutes(user?.id)); }, [user?.id]);

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

  const loadChapter = useCallback(async (
    title: number, code: string, name: string, opts?: { openCitation?: string },
  ): Promise<StatuteResult[]> => {
    setChapter({ title, code, name });
    setQuery(''); setResults(null); setLevel(null);
    setOpenSection(opts?.openCitation ?? null);
    setSectionsLoading(true);
    try {
      const r = await apiFetch<{ data: StatuteResult[] }>(`/statutes/chapter?title=${title}&chapter=${encodeURIComponent(code)}`);
      const data = r.data || [];
      setSections(data);
      return data;
    } catch {
      setSections([]);
      return [];
    } finally {
      setSectionsLoading(false);
    }
  }, []);

  // ── URL deep-link: /law-book?statute_id=<id> | /law-book?citation=76-5-102 | /law-book?section=76-5-102 ──
  // Strategy:
  //   1. Direct-fetch the statute via /statutes/section/:citation (works
  //      regardless of which chapter is loaded).
  //   2. Load the containing chapter so the operator sees its siblings.
  //   3. Auto-open the target section.
  //   4. Strip the param from the URL so a hard refresh doesn't re-trigger.
  // `section=` is accepted as an alias for `citation=` so cross-page links can
  // use the more intuitive name. `statute_id=` falls back to a search when no
  // direct /section/:id route exists.
  const pendingDeepLinkRef = useRef<{ statuteId: string | null; citation: string | null }>({
    statuteId: searchParams.get('statute_id'),
    // accept both ?citation= and ?section= as entry points
    citation: searchParams.get('citation') ?? searchParams.get('section'),
  });
  useEffect(() => {
    const { statuteId, citation } = pendingDeepLinkRef.current;
    if (!statuteId && !citation) return;
    pendingDeepLinkRef.current = { statuteId: null, citation: null };
    let cancelled = false;
    (async () => {
      try {
        let target: StatuteResult | null = null;
        if (citation) {
          const r = await apiFetch<{ data: StatuteResult }>(`/statutes/section/${encodeURIComponent(citation)}`);
          target = r?.data ?? null;
        } else if (statuteId) {
          // No /section/:id route — pivot via search with the id as q (the
          // server matches numeric tokens against citation too).
          const r = await apiFetch<{ data: StatuteResult[] }>(`/statutes/search?id=${encodeURIComponent(statuteId)}&limit=1`);
          const hits = r?.data || [];
          target = hits[0] || null;
        }
        if (cancelled) return;
        if (!target) {
          addToast(`Statute ${citation ?? statuteId ?? ''} not found`, 'error');
          return;
        }
        const citationStr = target.citation;
        const titleNum = parseInt(String(citationStr).split('-')[0] || '', 10);
        const chapCode = (target.chapter_code || String(citationStr).split('-')[1] || '').trim();
        const chapName = target.subcategory || `Title ${titleNum}`;
        if (Number.isFinite(titleNum) && chapCode) {
          await loadChapter(titleNum, chapCode, chapName, { openCitation: citationStr });
          if (!cancelled) setRecent(pushRecentStatute(user?.id, target));
        }
      } catch {
        // Quiet fail — operator can still browse normally.
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('statute_id');
          next.delete('citation');
          next.delete('section');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bump recent list every time the operator opens a section in the reader.
  // The open-toggle below calls this through openSectionTracked() so we
  // record the full StatuteResult (not just a citation) for the landing card.
  const openSectionTracked = useCallback((s: StatuteResult) => {
    const next = openSection === s.citation ? null : s.citation;
    setOpenSection(next);
    if (next) setRecent(pushRecentStatute(user?.id, s));
  }, [openSection, user?.id]);

  const showingSearch = results !== null;
  const shown = showingSearch ? results! : sections;
  const visibleSections = level && !showingSearch ? shown.filter((s) => s.offense_level === level) : shown;

  const resetToBrowse = () => { setChapter(null); setResults(null); setQuery(''); setLevel(null); setOpenSection(null); };

  // ── Keyboard shortcuts ──
  // `/` focuses the search input (when not already in a field).
  // Esc smart-cascade — close smallest-open-first:
  //   1. open section in reader      → close it (keep chapter / search visible)
  //   2. active search                → clear it
  //   3. open chapter (no search)     → return to browse landing
  // Disabled while the operator is typing in an input so Esc keeps native
  // form-clear semantics inside the search box.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if (e.key === '/' && !inField) {
        e.preventDefault();
        e.stopPropagation();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key !== 'Escape') return;
      if (inField) return;
      e.stopPropagation();
      if (openSection) { setOpenSection(null); return; }
      if (results !== null || query) { setResults(null); setQuery(''); setLevel(null); return; }
      if (chapter) { resetToBrowse(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearRecentConfirm, openSection, results, query, chapter, user]);

  // Print whatever the reader is currently showing (a chapter, or search results).
  const handlePrint = () => {
    if (!visibleSections.length) return;
    if (showingSearch) {
      generateStatutePdf({
        docTitle: 'Search Results',
        subtitle: query.trim() ? `"${query.trim()}"${level ? ` · ${toDisplayLabel(level)}` : ''}` : 'Filtered results',
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

      {/* ── ConfirmDialog: clear recent statutes history ── */}
      <ConfirmDialog
        isOpen={clearRecentConfirm}
        onClose={() => setClearRecentConfirm(false)}
        onConfirm={() => {
          try { localStorage.removeItem(recentKey(user?.id)); } catch { /* ignore */ }
          setRecent([]);
          setClearRecentConfirm(false);
        }}
        title="Clear Recent Statutes"
        message="Remove your recent statute history? This only affects your account on this device."
        confirmLabel="Clear History"
        confirmVariant="warning"
      />

      {/* ── Stats ribbon ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {[
          { label: 'Sections', value: stats.total, accent: 'var(--brand-gold)' },
          { label: 'Areas of Law', value: stats.areas, accent: 'var(--sev-critical)' },
          { label: 'Chapters', value: stats.chapters, accent: 'var(--sev-high)' },
          { label: 'Plain-Language', value: stats.summaries, accent: 'var(--sev-ok)' },
          { label: 'Admin Rules', value: stats.rules, accent: 'var(--spm-text-muted)' },
          { label: 'Classified Offenses', value: stats.offenses, accent: 'var(--sev-warn-soft)' },
        ].map((t) => (
          <div key={t.label} className="border border-rmpg-800 bg-surface-raised px-3 py-2" style={{ borderRadius: 2, borderTop: `2px solid ${t.accent}` }}>
            <div className="text-[18px] font-black tabular-nums leading-none text-rmpg-100">{tocLoading ? '—' : t.value.toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filter bar ── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setCategory('all'); resetToBrowse(); }}
            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
            style={{ background: category === 'all' ? 'var(--brand-gold)' : 'var(--surface-base)', color: category === 'all' ? 'var(--surface-base)' : 'var(--spm-text-muted)', borderColor: category === 'all' ? 'var(--brand-gold)' : 'var(--border-subtle)', borderRadius: 2 }}>
            All Law
          </button>
          {categoriesPresent.map((c) => {
            const meta = getCatMeta(c);
            const active = category === c;
            return (
              <button key={c} type="button"
                onClick={() => { setCategory(c); resetToBrowse(); }}
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border"
                style={{ background: active ? meta.accent : 'var(--surface-base)', color: active ? 'var(--surface-base)' : 'var(--spm-text-muted)', borderColor: active ? meta.accent : 'var(--border-subtle)', borderRadius: 2 }}>
                {meta.short}
              </button>
            );
          })}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search — "76-5-102", "assault", "DUI", "arrest", "stalking"… (press / to focus)'
              aria-label="Search Utah Code"
              className="w-full pl-8 pr-8 py-2 text-xs bg-surface-sunken border border-rmpg-700 text-rmpg-100 placeholder:text-rmpg-500"
              style={{ borderRadius: 2 }}
            />
            {(query || level) && (
              <button type="button" onClick={resetToBrowse} aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100">
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
                background: level === l.key ? 'var(--surface-raised)' : 'var(--surface-sunken)',
                borderColor: level === l.key ? l.dot : 'var(--border-subtle)',
                color: level === l.key ? 'var(--text-primary)' : 'var(--spm-text-muted)', borderRadius: 2,
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
            /* Loading state — spinner while TOC fetches */
            <div className="p-6 text-center"><Loader2 className="w-4 h-4 text-brand-gold-500 animate-spin inline" /></div>
          ) : Object.keys(grouped).length === 0 ? (
            /* No-data state — TOC loaded but no chapters match active filter */
            <div className="p-6 text-center space-y-1">
              <BookOpen className="w-5 h-5 text-rmpg-600 mx-auto" />
              <div className="text-[10px] text-rmpg-500 uppercase tracking-wider">
                {category !== 'all' ? `No chapters in ${getCatMeta(category).label}` : 'No chapters available'}
              </div>
            </div>
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
                      style={chapter?.title === r.title && chapter?.code === r.chapter_code ? { background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--brand-gold)' } : undefined}>
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
              <button aria-label="Back" type="button" onClick={resetToBrowse} className="text-rmpg-500 hover:text-brand-gold-500 flex items-center gap-1">
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

          {/* Landing overview — shown when not searching and no chapter is open */}
          {!showingSearch && !chapter ? (
            <div className="p-4 space-y-3">
              {/* Recent statutes (per-user). Hidden until the operator has
                  actually opened something so the empty zero-state of a
                  fresh device doesn't read as broken. */}
              {recent.length > 0 && (
                <div className="border border-rmpg-800 bg-surface-base" style={{ borderRadius: 2 }}>
                  <div className="px-3 py-1.5 border-b border-rmpg-900 flex items-center gap-1.5">
                    <History className="w-3 h-3 text-brand-gold-500" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400">Recent Statutes</span>
                    <span className="text-[9px] font-mono text-rmpg-600 ml-1">{recent.length}</span>
                    {canManage && (
                      <button type="button" onClick={() => { try { localStorage.removeItem(recentKey(user?.id)); } catch { /* ignore */ } setRecent([]); }}
                        className="ml-auto text-[9px] uppercase tracking-wider text-rmpg-500 hover:text-rmpg-200"
                        aria-label="Clear recent statutes">
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-1.5">
                    {recent.map((r) => (
                      <button key={r.citation} type="button"
                        onClick={() => loadChapter(r.title, r.chapter_code, r.short_title, { openCitation: r.citation })}
                        className="text-left border border-rmpg-800 bg-surface-sunken hover:bg-surface-raised px-2 py-1.5 transition-colors"
                        style={{ borderRadius: 2 }}>
                        <div className="font-mono text-[10px] text-brand-gold-500">{r.citation}</div>
                        <div className="text-[10.5px] text-rmpg-200 leading-snug truncate">{r.short_title}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tocLoading ? (
                /* Loading skeleton for category grid — distinct from no-data */
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="border border-rmpg-800 bg-surface-base p-3 animate-pulse" style={{ borderRadius: 2 }}>
                      <div className="w-5 h-5 bg-rmpg-800 mb-2" style={{ borderRadius: 2 }} />
                      <div className="h-3 bg-rmpg-800 w-3/4 mb-1" style={{ borderRadius: 2 }} />
                      <div className="h-2 bg-rmpg-900 w-full" style={{ borderRadius: 2 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {categoriesPresent.map((c) => {
                  const meta = getCatMeta(c); const Icon = meta.icon;
                  const count = toc.filter((r) => r.category === c).reduce((a, r) => a + r.section_count, 0);
                  return (
                    <button key={c} type="button" onClick={() => { setCategory(c); setOpenGroups((g) => ({ ...g, [c]: true })); }}
                      className="text-left border border-rmpg-800 bg-surface-base hover:bg-surface-sunken p-3 transition-colors"
                      style={{ borderRadius: 2, borderTop: `2px solid ${meta.accent}` }}>
                      <Icon className="w-5 h-5 mb-2" style={{ color: meta.accent }} />
                      <div className="text-[12px] font-bold text-rmpg-100">{meta.label}</div>
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
              )}
            </div>
          ) : sectionsLoading ? (
            /* Loading: chapter requested, waiting for sections */
            <div className="p-6 text-center"><Loader2 className="w-5 h-5 text-brand-gold-500 animate-spin inline" /></div>
          ) : visibleSections.length === 0 ? (
            /* Empty states: distinguish no-results from filtered-empty */
            <div className="p-6 text-[10px] text-rmpg-500 text-center uppercase tracking-wider">
              {showingSearch
                ? searching
                  ? null  /* spinner shown in search field while debounce runs */
                  : (query.trim() && level
                      ? `No statutes match "${query.trim()}" at this severity`
                      : query.trim()
                        ? `No statutes match "${query.trim()}"`
                        : 'No statutes at this severity')
                : level
                  ? 'No sections at this severity in this chapter'
                  : 'This chapter has no sections'}
            </div>
          ) : (
            <div className="divide-y divide-rmpg-900">
              {visibleSections.map((s) => {
                const open = openSection === s.citation;
                return (
                  <div key={s.id ?? s.citation} style={open ? { background: 'var(--surface-overlay)' } : undefined}>
                    <button type="button" onClick={() => openSectionTracked(s)}
                      className="w-full text-left px-3 py-2 hover:bg-surface-base flex items-start gap-2">
                      {open ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500 mt-0.5 shrink-0" />}
                      <span className="font-mono text-[11px] text-brand-gold-500 shrink-0 w-24">{s.citation}</span>
                      <span className="text-[12px] text-rmpg-100 leading-tight flex-1">{s.short_title}</span>
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
