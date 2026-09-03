// ============================================================
// RMPG Flex — Help & Documentation Page
// System reference, keyboard shortcuts, module guides, FAQ
//
// URL deep-linking (so /help?topic=shortcuts loads straight
// into the shortcuts tab and pastes well into chat/email):
//   ?topic=overview|shortcuts|modules|dispatch|faq|system
//   ?faq=<idx>            expand FAQ #idx (and force topic=faq)
//   ?search=<term>        global content search across all
//                         shortcuts/modules/FAQ — renders a
//                         consolidated result list at the top.
//
// Keyboard:
//   /         focus the search box (unless typing in a field)
//   Esc       smart-cascade — clears search first, then
//             collapses any expanded FAQ, then drops back to
//             the Overview tab
//
// PDFs (printable take-away artifacts for the console):
//   • Quick Reference Card (shortcuts + priorities + statuses)
//   • Dispatch Console Guide (long-form training PDF, reused
//     from dispatchGuidePdfGenerator)
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { importWithRetry } from '../utils/importWithRetry';
import {
  HelpCircle, Keyboard, BookOpen, Monitor, Radio, Map, Database, FileText, Users,
  MessageSquare, BarChart3, Search, AlertTriangle, Shield, Settings, ChevronRight,
  Zap, Send, Car, Gavel, Briefcase, Mail, Globe, FlaskConical, UserCog,
  GraduationCap, Download, Printer, X,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { APP_VERSION } from '../utils/version';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { helpTopicsToCsv, downloadTextFile } from '../utils/rmsListExport';
import {
  SHORTCUT_GROUPS, PRIORITIES, UNIT_STATUSES, CAD_COMMANDS,
} from '../utils/helpReferenceData';

// ── Health data type ────────────────────────────────────────
interface HealthData {
  version?: string;
  status?: string;
  db?: {
    connected?: boolean;
    version?: string;
    users?: number;
  };
  timestamp?: string;
}

// ── Section IDs ─────────────────────────────────────────────
type SectionId = 'overview' | 'shortcuts' | 'modules' | 'dispatch' | 'faq' | 'system';

const SECTION_IDS: SectionId[] = ['overview', 'shortcuts', 'modules', 'dispatch', 'faq', 'system'];
const isSectionId = (v: string | null): v is SectionId =>
  v != null && (SECTION_IDS as string[]).includes(v);

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'modules', label: 'Module Guide', icon: Monitor },
  { id: 'dispatch', label: 'Dispatch Reference', icon: Radio },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'system', label: 'System Info', icon: Settings },
];

// ── Module Guide data ───────────────────────────────────────
interface ModuleInfo {
  name: string;
  icon: React.ElementType;
  path: string;
  description: string;
  features: string[];
}

const MODULES: ModuleInfo[] = [
  {
    name: 'Dashboard',
    icon: Monitor,
    path: '/',
    description: 'Central operations overview with live statistics, active calls, unit status, and agency metrics.',
    features: ['Live call counts', 'Unit status overview', 'Priority statistics', 'Recent activity feed'],
  },
  {
    name: 'Dispatch',
    icon: Radio,
    path: '/dispatch',
    description: 'Full-featured CAD dispatch console for managing calls for service, unit assignments, and real-time operations.',
    features: ['Call queue management', 'Unit dispatch & tracking', 'CAD command line', 'Priority-based filtering', 'Voice alerts', 'Auto-dispatch protocols'],
  },
  {
    name: 'Tactical Map',
    icon: Map,
    path: '/map',
    description: 'Real-time tactical map with live unit GPS, active call markers, beat boundaries, and GeoJSON overlays.',
    features: ['Live GPS tracking', 'Call markers with details', 'Beat/zone overlays', 'Dark tactical theme', 'Offline tile fallback'],
  },
  {
    name: 'Records',
    icon: Database,
    path: '/records',
    description: 'Master records management for persons, vehicles, addresses, and property. Includes NCIC-style compound search.',
    features: ['Person records (MNI)', 'Vehicle records', 'Address records', 'Property records', 'Universal search', 'Compound search'],
  },
  {
    name: 'Incidents',
    icon: FileText,
    path: '/incidents',
    description: 'Incident report management with UCR/NIBRS classification, multi-officer tracking, and cross-referencing.',
    features: ['Full incident reports', 'Offense codes', 'Officer tracking', 'Cross-links to calls/cases', 'Person/vehicle associations'],
  },
  {
    name: 'Warrants',
    icon: AlertTriangle,
    path: '/warrants',
    description: 'Active warrant tracking and management with person associations and status tracking.',
    features: ['Warrant entry & tracking', 'Person associations', 'Status management', 'National warrant search'],
  },
  {
    name: 'Citations',
    icon: FileText,
    path: '/citations',
    description: 'Traffic and non-traffic citation management with violation tracking, fine calculations, and batch operations.',
    features: ['Citation entry', 'Multiple violations', 'Fine calculation', 'Court tracking', 'Batch operations'],
  },
  {
    name: 'Law Book',
    icon: BookOpen,
    path: '/law-book',
    description: 'Full Utah Code reference — criminal (Title 76), motor-vehicle (Title 41), and security/PI/process-server licensing statutes plus administrative rules, with offense levels and official source links.',
    features: ['Statute & citation search', 'Browse by chapter', 'Severity filters', 'Full statutory text', 'le.utah.gov source links'],
  },
  {
    name: 'Process Service',
    icon: Send,
    path: '/serve',
    description: 'Serve queue management for process service with GPS tracking, route planning, and attempt logging.',
    features: ['Serve queue', 'GPS-tracked attempts', 'Route optimization', 'Skip trace integration', 'Photo/signature capture'],
  },
  {
    name: 'Personnel',
    icon: Users,
    path: '/personnel',
    description: 'Officer and staff management with profiles, certifications, and assignment tracking.',
    features: ['Officer profiles', 'Badge/unit assignments', 'Certification tracking', 'Contact information'],
  },
  {
    name: 'Fleet',
    icon: Car,
    path: '/fleet',
    description: 'Vehicle fleet management with maintenance tracking, fuel logs, and inspection records.',
    features: ['Vehicle inventory', 'Maintenance scheduling', 'Fuel logs', 'Damage reports', 'Inspections'],
  },
  {
    name: 'Communications',
    icon: MessageSquare,
    path: '/communications',
    description: 'Secure messaging between dispatchers and units with channel-based communication.',
    features: ['Dispatch messages', 'Unit-to-unit messaging', 'Broadcast alerts', 'BOLO distribution'],
  },
  {
    name: 'Reports',
    icon: BarChart3,
    path: '/reports',
    description: 'Comprehensive reporting with charts, analytics, and PDF export capabilities.',
    features: ['Standard reports', 'Crime statistics', 'Officer activity', 'Response time analysis', 'Custom report builder'],
  },
  {
    name: 'Cases',
    icon: Briefcase,
    path: '/cases',
    description: 'Case management with evidence tracking, person/vehicle associations, and cross-referencing.',
    features: ['Case creation & tracking', 'Evidence management', 'Suspect/witness associations', 'Cross-links to incidents/calls'],
  },
  {
    name: 'Skip Tracer',
    icon: Search,
    path: '/skip-tracer',
    description: 'Multi-source skip tracing for locating persons across public and proprietary databases.',
    features: ['22+ data sources', 'FBI Wanted', 'Utah Courts', 'Property records', 'Arrest records'],
  },
  {
    name: 'Forensic Lab',
    icon: FlaskConical,
    path: '/forensic-lab',
    description: 'Evidence processing and forensic analysis tracking with chain-of-custody management.',
    features: ['Case management', 'Exhibit tracking', 'Analysis records', 'Chain of custody'],
  },
  {
    name: 'Court Tracker',
    icon: Gavel,
    path: '/court',
    description: 'Court date and event tracking for officers and cases.',
    features: ['Court event scheduling', 'Officer assignments', 'Case associations', 'Calendar view'],
  },
  {
    name: 'Email',
    icon: Mail,
    path: '/email',
    description: 'Integrated email client for agency communications.',
    features: ['Send/receive email', 'Attachments', 'Contact integration'],
  },
  {
    name: 'CRM',
    icon: Globe,
    path: '/crm',
    description: 'Client relationship management for contracts and service agreements.',
    features: ['Client profiles', 'Contract management', 'Proposals', 'Invoicing'],
  },
  {
    name: 'Training',
    icon: GraduationCap,
    path: '/training',
    description: 'Training dashboard and documentation management for policies, SOPs, and manuals.',
    features: ['Training records', 'Policy documents', 'SOP management', 'Form templates'],
  },
  {
    name: 'Human Resources',
    icon: UserCog,
    path: '/hr',
    description: 'HR management with leave tracking, payroll, performance reviews, and disciplinary records.',
    features: ['Leave management', 'Payroll processing', 'Performance reviews', 'Overtime tracking'],
  },
];

// ── FAQ data ────────────────────────────────────────────────
interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How do I create a new call for service?',
    answer: 'Navigate to the Dispatch page (F2) and press "N" or click the "New Call" button. Fill in the call details including type, location, and priority, then save.',
  },
  {
    question: 'How do I dispatch a unit to a call?',
    answer: 'Select the call in the dispatch queue, then press "D" or click "Dispatch". Choose the unit(s) to assign and confirm. Units will receive notifications via WebSocket.',
  },
  {
    question: 'How do I use the CAD command line?',
    answer: 'Press "/" or F8 to focus the command line at the bottom of the Dispatch page. Type commands like 10-code lookups, premise alerts, or status changes. Type "HELP" in the command line for a list of available commands.',
  },
  {
    question: 'How do I search for a person or vehicle?',
    answer: 'Use Ctrl+K for global search, or navigate to Records (F6) for detailed search. The compound search supports wildcard name matching, DOB ranges, physical descriptions, and address radius searches.',
  },
  {
    question: 'How do I generate a report or PDF?',
    answer: 'Most pages have an Export button (or Ctrl+E) that generates a PDF of the current view. For custom reports, navigate to Reports > Report Builder.',
  },
  {
    question: 'How do I change my password or enable 2FA?',
    answer: 'Go to Admin (F12) and use the user settings panel. The Cloudflare-era stack ships JWT authentication today; multi-factor (TOTP / WebAuthn) was a VPS-era feature and has not yet been ported.',
  },
  {
    question: 'What do the priority levels mean?',
    answer: 'P1 (Emergency) — immediate threat to life. P2 (Urgent) — in-progress crime, injury. P3 (Routine) — standard response. P4 (Low) — report-only, information. P5 (Scheduled) — planned activity.',
  },
  {
    question: 'How does offline mode work?',
    answer: 'RMPG Flex uses a service worker to cache assets for offline use. The tactical map has pre-cached tiles for the Salt Lake City operational area. Data entered offline will sync when connectivity is restored.',
  },
  {
    question: 'How do I file a Use of Force report?',
    answer: 'Navigate to Use of Force from the sidebar or Records section. Click "New Report" and link it to the associated incident. Complete all required fields including force type, subject details, and justification.',
  },
  {
    question: 'How do I access the system from my phone?',
    answer: 'RMPG Flex is fully responsive and works on mobile browsers. For Android, a native app is available via Capacitor. The mobile interface includes a bottom navigation bar and swipe drawer.',
  },
];

// ── Kbd component ───────────────────────────────────────────
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-bold bg-surface-sunken text-rmpg-200 border border-rmpg-600"
      style={{ minWidth: '22px', textAlign: 'center' }}
    >
      {children}
    </kbd>
  );
}

// ── Search helpers (extracted so they can be unit-tested independently) ──
export interface SearchHit {
  kind: 'shortcut' | 'module' | 'faq';
  title: string;
  detail: string;
  groupOrPath: string;
  /** Section to navigate to when clicked. */
  section: SectionId;
  /** Optional FAQ index to expand. */
  faqIdx?: number;
}

const norm = (s: string) => s.toLowerCase();

export function searchHelpContent(query: string): SearchHit[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];

  for (const g of SHORTCUT_GROUPS) {
    for (const s of g.shortcuts) {
      const keys = s.keys.join('+');
      if (norm(keys).includes(q) || norm(s.description).includes(q) || norm(g.title).includes(q)) {
        hits.push({
          kind: 'shortcut',
          title: keys,
          detail: s.description,
          groupOrPath: g.title,
          section: 'shortcuts',
        });
      }
    }
  }

  for (const m of MODULES) {
    const haystack = `${m.name} ${m.description} ${m.path} ${m.features.join(' ')}`;
    if (norm(haystack).includes(q)) {
      hits.push({
        kind: 'module',
        title: m.name,
        detail: m.description,
        groupOrPath: m.path,
        section: 'modules',
      });
    }
  }

  FAQ_ITEMS.forEach((f, i) => {
    if (norm(f.question).includes(q) || norm(f.answer).includes(q)) {
      hits.push({
        kind: 'faq',
        title: f.question,
        detail: f.answer,
        groupOrPath: 'FAQ',
        section: 'faq',
        faqIdx: i,
      });
    }
  });

  return hits;
}

// ── Main Page ───────────────────────────────────────────────
export default function HelpPage() {
  const [params, setParams] = useSearchParams();

  // Hydrate active section + expanded FAQ + search from the URL so a link
  // like /help?topic=shortcuts or /help?faq=3 jumps straight to the right
  // place. We treat the URL as the source of truth — every state change
  // writes back via setParams.
  const topicParam = params.get('topic');
  const faqParam = params.get('faq');
  const searchParam = params.get('search') ?? '';

  const initialSection: SectionId = isSectionId(topicParam)
    ? topicParam
    : faqParam != null
      ? 'faq'
      : 'overview';
  const initialFaq = faqParam != null && /^\d+$/.test(faqParam)
    ? Math.min(Number(faqParam), FAQ_ITEMS.length - 1)
    : null;

  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(initialFaq);
  const [search, setSearch] = useState(searchParam);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthTick, setHealthTick] = useState(0);
  const [healthFailed, setHealthFailed] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch server health info for System section
  useEffect(() => {
    let cancelled = false;
    setHealthLoading(true);
    apiFetch<HealthData>('/api/health')
      .then((data) => { if (!cancelled) { setHealthData(data); setHealthFailed(false); } })
      .catch(() => { if (!cancelled) { setHealthData(null); setHealthFailed(true); } })
      .finally(() => { if (!cancelled) setHealthLoading(false); });
    return () => { cancelled = true; };
  }, [healthTick]);

  // Re-sync from URL when the back/forward buttons change ?topic / ?faq /
  // ?search out from under us. Without this, browser back from a deep link
  // would leave the visible tab pointed at the wrong section.
  useEffect(() => {
    const t = params.get('topic');
    const f = params.get('faq');
    const s = params.get('search') ?? '';
    setActiveSection(isSectionId(t) ? t : f != null ? 'faq' : 'overview');
    setExpandedFaq(f != null && /^\d+$/.test(f)
      ? Math.min(Number(f), FAQ_ITEMS.length - 1)
      : null);
    setSearch(s);
  }, [params]);

  // Push state changes back into the URL. We only write keys that have a
  // value so the URL stays clean (`/help` rather than `/help?topic=overview`).
  const updateUrl = useCallback((next: { topic?: SectionId | null; faq?: number | null; search?: string | null }) => {
    const merged: Record<string, string> = {};
    const topic = next.topic !== undefined ? next.topic : (isSectionId(params.get('topic')) ? params.get('topic') as SectionId : null);
    const faq = next.faq !== undefined ? next.faq : (params.get('faq') != null && /^\d+$/.test(params.get('faq')!) ? Number(params.get('faq')) : null);
    const s = next.search !== undefined ? next.search : params.get('search');
    if (topic && topic !== 'overview') merged.topic = topic;
    if (faq != null) merged.faq = String(faq);
    if (s && s.length > 0) merged.search = s;
    setParams(merged, { replace: true });
  }, [params, setParams]);

  const handleSectionChange = useCallback((id: SectionId) => {
    setActiveSection(id);
    updateUrl({ topic: id, faq: id === 'faq' ? expandedFaq : null });
  }, [expandedFaq, updateUrl]);

  const handleToggleFaq = useCallback((idx: number) => {
    const next = expandedFaq === idx ? null : idx;
    setExpandedFaq(next);
    updateUrl({ topic: 'faq', faq: next });
  }, [expandedFaq, updateUrl]);

  // Debounced URL write for the search box — typing in the field
  // shouldn't blow up router history.
  useEffect(() => {
    const t = setTimeout(() => {
      updateUrl({ search: search.trim() ? search.trim() : null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Keyboard: "/" focuses the search; Esc smart-cascades.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typingInField = t && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      );
      if (e.key === '/' && !typingInField) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === 'Escape') {
        // Smart cascade: smallest-open-first
        if (search) {
          setSearch('');
          updateUrl({ search: null });
          return;
        }
        if (expandedFaq != null) {
          setExpandedFaq(null);
          updateUrl({ faq: null });
          return;
        }
        if (activeSection !== 'overview') {
          setActiveSection('overview');
          updateUrl({ topic: null, faq: null });
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search, expandedFaq, activeSection, updateUrl]);

  // Search results — derived from `search`; the search section overrides
  // the active tab content when populated.
  const hits = useMemo(() => searchHelpContent(search), [search]);

  // PDF generation handlers (dynamic-imported so jsPDF doesn't bloat the
  // help-page route bundle when nobody clicks Print).
  const onPrintQuickRef = useCallback(async () => {
    try {
      const mod = await importWithRetry(() => import('../utils/helpQuickReferencePdf'));
      await mod.generateHelpQuickReferencePdfWithDefaults();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDF generation failed.');
    }
  }, []);

  const onDownloadDispatchGuide = useCallback(async () => {
    try {
      const mod = await importWithRetry(() => import('../utils/dispatchGuidePdfGenerator'));
      await mod.generateDispatchGuidePdf();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Dispatch guide PDF generation failed.');
    }
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── PDF error ConfirmDialog (replaces alert()) ─────── */}
      <ConfirmDialog
        isOpen={pdfError != null}
        onClose={() => setPdfError(null)}
        onConfirm={() => setPdfError(null)}
        title="PDF Generation Failed"
        message={pdfError ?? ''}
      />

      {/* ── Left Navigation ───────────────────────────── */}
      <nav
        className="flex-shrink-0 overflow-y-auto py-3"
        style={{
          width: 200,
          background: 'var(--surface-overlay)',
          borderRight: '1px solid var(--border-subtle)',
          scrollbarWidth: 'none',
        }}
      >
        <div className="px-3 pb-3 mb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Help Center</span>
          </div>
          <div className="text-[9px] text-rmpg-500 mt-1 font-mono">RMPG Flex v{APP_VERSION}</div>
        </div>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id && !search;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSectionChange(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!active ? 'hover:bg-surface-base' : ''}`}
              style={{
                background: active ? 'rgba(136,136,136,0.12)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderLeft: active ? '3px solid var(--text-secondary)' : '3px solid transparent',
              }}
            >
              <Icon style={{ width: 14, height: 14, flexShrink: 0, color: active ? 'var(--text-secondary)' : 'var(--text-muted)' }} />
              <span className="text-[11px] font-medium">{item.label}</span>
            </button>
          );
        })}

        {/* Print/export actions */}
        <div className="mt-3 pt-3 px-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-[9px] text-rmpg-500 uppercase tracking-wider mb-2">Print</div>
          <button
            type="button"
            onClick={onPrintQuickRef}
            className="w-full flex items-center gap-2 px-2 py-1.5 mb-1 text-[10px] text-rmpg-300 hover:bg-surface-base hover:text-rmpg-100 transition-colors"
            title="Two-page tear-off card with shortcuts, priorities, statuses, and CAD commands"
          >
            <Printer style={{ width: 12, height: 12, flexShrink: 0 }} />
            <span>Quick Reference Card</span>
          </button>
          <button
            type="button"
            onClick={onDownloadDispatchGuide}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-rmpg-300 hover:bg-surface-base hover:text-rmpg-100 transition-colors"
            title="Long-form dispatcher training PDF (loads live 10-codes)"
          >
            <Download style={{ width: 12, height: 12, flexShrink: 0 }} />
            <span>Dispatch Guide</span>
          </button>
        </div>
      </nav>

      {/* ── Content Area ──────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6" style={{ background:"var(--surface-sunken)" }}>
        <div className="max-w-4xl mx-auto space-y-6">

          {/* ── Search bar ──────────────────────────────── */}
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderTop: '2px solid var(--field-label-color)' }}
          >
            <Search className="w-4 h-4 text-rmpg-300 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shortcuts, modules, and FAQ — press / to focus"
              aria-label="Help content search"
              className="flex-1 bg-transparent text-[12px] text-rmpg-100 placeholder-rmpg-600 outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="text-rmpg-500 hover:text-rmpg-100 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <span className="text-[9px] text-rmpg-600 font-mono shrink-0">/ to focus</span>
            <button
              type="button"
              className="toolbar-btn shrink-0"
              onClick={() => downloadTextFile('help-topics.csv', helpTopicsToCsv([
                ...MODULES.map((m) => ({ id: m.path, title: m.name, category: 'module' })),
                ...FAQ_ITEMS.map((f, i) => ({ id: `faq-${i}`, title: f.question, category: 'faq' })),
              ]))}
            >CSV</button>
          </div>

          {/* ── Search results override the section content ── */}
          {search && (
            <>
              <PanelTitleBar
                title={`SEARCH RESULTS — ${hits.length} match${hits.length === 1 ? '' : 'es'} for "${search.trim()}"`}
                icon={Search}
              />
              {hits.length === 0 ? (
                <div
                  className="p-6 text-center text-[11px] text-rmpg-400"
                  style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}
                >
                  <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>No help content matches your search.</p>
                  <p className="text-[10px] text-rmpg-500 mt-1">Try a shortcut key (e.g. "Ctrl+K"), a module name, or a question keyword.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {hits.map((h, i) => (
                    <button
                      key={`${h.kind}-${i}-${h.title}`}
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setActiveSection(h.section);
                        if (h.faqIdx != null) setExpandedFaq(h.faqIdx);
                        updateUrl({ topic: h.section, faq: h.faqIdx ?? null, search: null });
                      }}
                      className="w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
                      style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}
                    >
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rmpg-200"
                        style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
                      >
                        {formatEnumValue(h.kind)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-rmpg-100">{h.title}</span>
                          <span className="text-[9px] text-rmpg-500">{h.groupOrPath}</span>
                        </div>
                        <p className="text-[10px] text-rmpg-400 truncate">{h.detail}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-rmpg-500 shrink-0 mt-0.5" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* When searching, suppress the static section content so the
              results don't double-render below them. */}
          {!search && activeSection === 'overview' && (
            <>
              <PanelTitleBar title="RMPG FLEX — SYSTEM OVERVIEW" icon={BookOpen} />
              <div className="p-4 space-y-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <p className="text-sm text-rmpg-200 leading-relaxed">
                  RMPG Flex is a full-featured Computer-Aided Dispatch (CAD) and Records Management System (RMS)
                  built for Rocky Mountain Protective Group. It provides real-time dispatch, incident management,
                  records tracking, and comprehensive reporting across all operational areas.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: 'Dispatch & CAD', desc: 'Real-time call management, unit tracking, and voice alerts', icon: Radio },
                    { label: 'Records (RMS)', desc: 'Individuals, vehicles, incidents, citations, and warrants', icon: Database },
                    { label: 'Tactical Map', desc: 'Live GPS, call markers, beat overlays, offline tiles', icon: Map },
                    { label: 'Investigations', desc: 'Case management, skip tracing, forensic lab', icon: Search },
                    { label: 'Communications', desc: 'Secure messaging, email, radio, and BOLO alerts', icon: MessageSquare },
                    { label: 'Reports & Analytics', desc: 'Custom reports, crime analysis, and PDF exports', icon: BarChart3 },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="p-3 space-y-1"
                      style={{ background:"var(--surface-sunken)", border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-2">
                        <card.icon className="w-3.5 h-3.5 text-brand-400" />
                        <span className="text-[11px] font-bold text-rmpg-100 uppercase">{card.label}</span>
                      </div>
                      <p className="text-[10px] text-rmpg-400 leading-relaxed">{card.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <PanelTitleBar title="GETTING STARTED" icon={Zap} />
              <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                {[
                  { step: '1', title: 'Navigate with F-Keys', desc: 'Use F1–F12 to quickly jump between modules. F2 opens Dispatch, F3 opens the Map, etc.' },
                  { step: '2', title: 'Global Search', desc: 'Press Ctrl+K to search across all records — persons, vehicles, incidents, and more.' },
                  { step: '3', title: 'Dispatch Console', desc: 'The dispatch page (F2) is the operational hub. Use N to create calls, J/K to navigate, and the command line (/ or F8) for CAD commands.' },
                  { step: '4', title: 'Menu Bar', desc: 'The File | View | Tools | Help menu bar at the top provides access to all tools, display settings, and quick references.' },
                  { step: '5', title: 'Sidebar Navigation', desc: 'The left sidebar organizes all modules by category. Click the collapse button at the bottom to minimize it.' },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{
                        width: 22,
                        height: 22,
                        background: 'rgba(212,160,23,0.15)',
                        border: '1px solid rgba(212,160,23,0.3)',
                        color: 'var(--accent-silver-400)',
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-rmpg-100">{item.title}</div>
                      <div className="text-[10px] text-rmpg-400 leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!search && activeSection === 'shortcuts' && (
            <>
              <PanelTitleBar title="KEYBOARD SHORTCUTS" icon={Keyboard} />
              <div className="text-[10px] text-rmpg-500 mb-2">
                Press <Kbd>?</Kbd> anywhere in the app to open the quick shortcuts overlay,
                or <Kbd>/</Kbd> on this page to search.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <div
                    key={group.title}
                    className="p-3"
                    style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}
                  >
                    <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2 pb-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {group.title}
                    </h3>
                    <div className="space-y-1.5">
                      {group.shortcuts.map((s, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-[11px] text-rmpg-200">{s.description}</span>
                          <div className="flex items-center gap-0.5 ml-2">
                            {s.keys.map((key, ki) => (
                              <React.Fragment key={ki}>
                                {ki > 0 && <span className="text-rmpg-600 text-[9px] mx-0.5">+</span>}
                                <Kbd>{key}</Kbd>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!search && activeSection === 'modules' && (
            <>
              <PanelTitleBar title="MODULE GUIDE" icon={Monitor} />
              <div className="text-[10px] text-rmpg-500 mb-2">
                Click any module for details. Use the sidebar or F-keys to navigate.
              </div>
              <div className="space-y-2">
                {MODULES.map((mod) => {
                  const Icon = mod.icon;
                  return (
                    <div
                      key={mod.path}
                      className="p-3"
                      style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-shrink-0 flex items-center justify-center"
                          style={{
                            width: 28,
                            height: 28,
                            background: 'rgba(136,136,136,0.1)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <Icon className="w-3.5 h-3.5 text-rmpg-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-rmpg-100">{mod.name}</span>
                            <span className="text-[9px] font-mono text-rmpg-600">{mod.path}</span>
                          </div>
                          <p className="text-[10px] text-rmpg-400 leading-relaxed mt-0.5">{mod.description}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {mod.features.map((f) => (
                              <span
                                key={f}
                                className="text-[9px] px-1.5 py-0.5 text-rmpg-300"
                                style={{ background:"var(--surface-sunken)", border: '1px solid var(--border-subtle)' }}
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!search && activeSection === 'dispatch' && (
            <>
              <PanelTitleBar title="DISPATCH QUICK REFERENCE" icon={Radio} />

              {/* Priority Levels */}
              <div className="p-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">Priority Levels</h3>
                <div className="space-y-1.5">
                  {PRIORITIES.map((p) => (
                    <div key={p.level} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono font-bold w-6" style={{ color: p.color }}>{formatEnumValue(p.level)}</span>
                      <span className="text-[10px] font-bold w-24" style={{ color: p.color }}>{p.label}</span>
                      <span className="text-[10px] text-rmpg-400">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unit Status Codes */}
              <div className="p-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">Unit Status Codes</h3>
                <div className="space-y-1.5">
                  {UNIT_STATUSES.map((s) => (
                    <div key={s.code} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono font-bold w-8" style={{ color: s.color }}>{s.code}</span>
                      <span className="text-[10px] font-bold w-28" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-[10px] text-rmpg-400">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CAD Command Line */}
              <div className="p-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-[10px] font-bold text-brand-400 uppercase tracking-wider mb-2">CAD Command Line</h3>
                <p className="text-[10px] text-rmpg-400 mb-2">
                  Press <Kbd>/</Kbd> or <Kbd>F8</Kbd> to focus the command line. Type <strong className="text-rmpg-200">HELP</strong> for a full list of commands.
                </p>
                <div className="space-y-1">
                  {CAD_COMMANDS.map((c) => (
                    <div key={c.cmd} className="flex items-center gap-3">
                      <code className="text-[10px] font-mono text-rmpg-200 w-48 flex-shrink-0">{c.cmd}</code>
                      <span className="text-[10px] text-rmpg-400">{c.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!search && activeSection === 'faq' && (
            <>
              <PanelTitleBar title="FREQUENTLY ASKED QUESTIONS" icon={HelpCircle} />
              <div className="space-y-1">
                {FAQ_ITEMS.map((faq, idx) => (
                  <div
                    key={idx}
                    style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleFaq(idx)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-raised transition-colors"
                    >
                      <span className="text-[11px] font-medium text-rmpg-200">{faq.question}</span>
                      <ChevronRight
                        className="w-3.5 h-3.5 text-rmpg-500 flex-shrink-0 transition-transform"
                        style={{ transform: expandedFaq === idx ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      />
                    </button>
                    {expandedFaq === idx && (
                      <div className="px-4 pb-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <p className="text-[10px] text-rmpg-400 leading-relaxed pt-2">{faq.answer}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!search && activeSection === 'system' && (
            <>
              <PanelTitleBar title="SYSTEM INFORMATION" icon={Settings} />
              <div className="p-4 space-y-3" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {[
                    { label: 'Application', value: 'RMPG Flex' },
                    { label: 'Client Version', value: APP_VERSION },
                    { label: 'Platform', value: 'Web / Electron / Capacitor' },
                    { label: 'Frontend', value: 'React + TypeScript + Vite' },
                    // Backend is Cloudflare-era now — the old VPS Express + SQLite
                    // stack was decommissioned 2026-06-15.
                    { label: 'Backend', value: 'Cloudflare Workers + Hono' },
                    { label: 'Database', value: 'Cloudflare D1 (rmpg-flex)' },
                    { label: 'Storage', value: 'Cloudflare R2 + KV' },
                    { label: 'Real-time', value: 'Durable Objects + WebSocket' },
                    { label: 'Maps', value: 'Mapbox GL JS' },
                    { label: 'Auth', value: 'JWT (TOTP/WebAuthn not yet ported)' },
                    ...(healthData ? [
                      { label: 'Server Version', value: healthData.version || 'N/A' },
                      { label: 'Server Status', value: healthData.status || 'N/A' },
                      ...(healthData.db ? [
                        { label: 'DB Schema', value: healthData.db.version || 'unknown' },
                        { label: 'DB Users', value: healthData.db.users != null ? String(healthData.db.users) : 'N/A' },
                      ] : []),
                    ] : [
                      { label: 'Server Status', value: 'unreachable' },
                    ]),
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-[10px] text-rmpg-500 uppercase">{row.label}</span>
                      <span className="text-[10px] font-mono text-rmpg-200">{row.value}</span>
                    </div>
                  ))}
                </div>
                {healthLoading && (
                  <p className="text-[10px] text-fg-muted mt-2" role="status">Checking server health…</p>
                )}
                {healthFailed && !healthLoading && (
                  <div className="mt-3 flex items-center gap-2" role="alert">
                    <span className="text-[10px] text-[color:var(--sev-critical)]">Live health probe failed.</span>
                    <button type="button" className="toolbar-btn" onClick={() => setHealthTick((n) => n + 1)}>Retry</button>
                  </div>
                )}
              </div>

              <PanelTitleBar title="BROWSER COMPATIBILITY" icon={Monitor} />
              <div className="p-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <div className="space-y-1.5">
                  {[
                    { browser: 'Chrome / Edge', version: '90+', status: 'Full support' },
                    { browser: 'Firefox', version: '90+', status: 'Full support' },
                    { browser: 'Safari', version: '15+', status: 'Full support' },
                    { browser: 'Electron Desktop', version: 'Latest', status: 'Full support + offline' },
                    { browser: 'Android (Capacitor)', version: 'Latest', status: 'Full support' },
                  ].map((b) => (
                    <div key={b.browser} className="flex items-center gap-4">
                      <span className="text-[10px] font-bold text-rmpg-200 w-36">{b.browser}</span>
                      <span className="text-[10px] font-mono text-rmpg-500 w-16">{b.version}</span>
                      <span className="text-[10px] text-rmpg-400">{toDisplayLabel(b.status)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <PanelTitleBar title="CONTACT & SUPPORT" icon={Shield} />
              <div className="p-4" style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)' }}>
                <p className="text-[10px] text-rmpg-400 leading-relaxed">
                  For technical issues, contact your system administrator. For application bugs, use the{' '}
                  <strong className="text-rmpg-200">Help → Report a Problem</strong> menu item.
                  Security issues should be reported to the admin team immediately.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
