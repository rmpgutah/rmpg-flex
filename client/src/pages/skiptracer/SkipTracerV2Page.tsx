// ============================================================
// RMPG Flex — Skip Tracker 3.5 — Enhanced Dossier Builder
// Three-panel: Navigation tabs (top) + Search/Results (left) + Dossier/Content (right)
// Tabs: Search, Saved Dossiers, History, Sources, Stats
// ============================================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Search, User, MapPin, Phone, Mail, Users, Scale, Building2,
  AlertTriangle, ChevronDown, ChevronRight, Copy, CheckCircle2,
  Save, FileText, Plus, Loader2, Shield, Globe, History, Database,
  Settings, BarChart3, Download, Trash2, Eye, RefreshCw, Filter,
  X, Clock, Bookmark, Car, Home, Award, Fingerprint, Hash,
  ExternalLink, ArrowRight, Zap, Radio, UserCheck,
  List, Link2, PhoneCall, MapPinned, Calendar,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';
import IconButton from '../../components/IconButton';
import { useIsMobile } from '../../hooks/useIsMobile';

// ─── Types ───────────────────────────────────────────────────

interface SourceInfo {
  name: string;
  displayName: string;
  category: string;
  costPerLookup: number;
  configured: boolean;
  enabled: boolean;
  healthy: boolean;
}

interface ProfileAddress {
  address?: string;
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  source: string;
}

interface ProfilePhone {
  number: string;
  type?: string;
  carrier?: string;
  lineStatus?: string;
  source: string;
}

interface ProfileEmail {
  email?: string;
  address?: string;
  type?: string;
  source: string;
}

interface SocialProfile {
  platform: string;
  url: string;
  username: string;
  source?: string;
}

interface Associate {
  name: string;
  relationship?: string;
  phone?: string;
  source: string;
}

interface CourtRecord {
  caseNumber?: string;
  court?: string;
  caseType?: string;
  type?: string;
  charge?: string;
  charges?: string[];
  filingDate?: string;
  date?: string;
  status?: string;
  disposition?: string;
  state?: string;
  source: string;
  sourceUrl?: string;
}

interface BusinessRecord {
  name: string;
  role?: string;
  status?: string;
  registrationNumber?: string;
  entityNumber?: string;
  state?: string;
  jurisdiction?: string;
  source: string;
}

interface WatchlistFlag {
  listName?: string;
  type?: string;
  matchType?: string;
  matched?: boolean;
  confidence?: number;
  details?: string;
  source: string;
}

interface PropertyRecord {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  propertyType?: string;
  marketValue?: number;
  ownerName?: string;
  source: string;
}

interface LicenseRecord {
  type?: string;
  number?: string;
  state?: string;
  status?: string;
  expirationDate?: string;
  source: string;
}

interface VehicleRecord {
  year?: string;
  make?: string;
  model?: string;
  color?: string;
  plate?: string;
  plateState?: string;
  vin?: string;
  source: string;
}

interface CustodyRecord {
  facility?: string;
  facilityState?: string;
  status?: string;
  bookingDate?: string;
  charges?: string[];
  mugshot?: string;
  source: string;
}

interface SexOffenderRecord {
  registryState?: string;
  tier?: string;
  offenses?: string[];
  source: string;
}

interface Profile {
  id: string;
  fullName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  dob?: string;
  age?: number;
  gender?: string;
  ssn_last4?: string;
  aliases?: string[];
  city?: string;
  state?: string;
  photoUrl?: string;
  confidenceScore?: number;
  sources: string[];
  addresses?: ProfileAddress[];
  phones?: ProfilePhone[];
  emails?: ProfileEmail[];
  socialProfiles?: SocialProfile[];
  associates?: Associate[];
  courtRecords?: CourtRecord[];
  businesses?: BusinessRecord[];
  watchlistFlags?: WatchlistFlag[];
  propertyRecords?: PropertyRecord[];
  licenses?: LicenseRecord[];
  vehicles?: VehicleRecord[];
  custodyRecords?: CustodyRecord[];
  sexOffenderRecords?: SexOffenderRecord[];
}

interface SearchResult {
  profiles: Profile[];
  sourcesQueried: string[];
  sourcesResponded: string[];
  sourcesFailed?: Array<{ name: string; error: string }>;
  totalResults: number;
  totalCost: number;
  durationMs: number;
  searchId?: string;
}

interface Dossier {
  id: number;
  subject_name: string;
  profile_snapshot: string;
  notes?: string;
  tags?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

interface SearchHistory {
  id: number;
  search_type: string;
  query_params: string;
  sources_queried: string;
  sources_responded: string;
  total_results: number;
  searcher_name?: string;
  cost_total: number;
  duration_ms: number;
  created_at: string;
}

interface Stats {
  totalSearches: { today: number; week: number; allTime: number };
  totalCost: number;
  topSources: Array<{ name: string; count: number }>;
}

// ─── Input type detection ────────────────────────────────────

type InputType = 'Name' | 'Phone' | 'Email' | 'Address';

function detectInputType(q: string): InputType {
  const trimmed = q.trim();
  if (!trimmed) return 'Name';
  if (trimmed.replace(/\D/g, '').length >= 10) return 'Phone';
  if (trimmed.includes('@')) return 'Email';
  if (/\d/.test(trimmed) && /\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|pl|place|cir|circle|pkwy|parkway|hwy|highway)\b/i.test(trimmed)) return 'Address';
  return 'Name';
}

const INPUT_BADGE_COLORS: Record<InputType, string> = {
  Name: '#aaaaaa',
  Phone: '#f59e0b',
  Email: '#f472b6',
  Address: '#34d399',
};

// ─── Source category colors ──────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  people: '#888888',
  court: '#22c55e',
  property: '#f59e0b',
  business: '#8b5cf6',
  osint: '#a855f7',
  registry: '#ef4444',
};

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#666666';
}

function sourceColor(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes('court') || lower.includes('criminal') || lower.includes('arrest')) return CATEGORY_COLORS.court;
  if (lower.includes('property') || lower.includes('assessor')) return CATEGORY_COLORS.property;
  if (lower.includes('osint') || lower.includes('social') || lower.includes('username')) return CATEGORY_COLORS.osint;
  if (lower.includes('ofac') || lower.includes('registry') || lower.includes('sex') || lower.includes('fbi') || lower.includes('nsopw')) return CATEGORY_COLORS.registry;
  if (lower.includes('business') || lower.includes('corporate') || lower.includes('dopl') || lower.includes('fcc')) return CATEGORY_COLORS.business;
  return CATEGORY_COLORS.people;
}

// ─── Clipboard helper ────────────────────────────────────────

function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

// ─── Sub-components ──────────────────────────────────────────

function CopyBtn({ value, label, copied, copy }: {
  value: string; label: string;
  copied: string | null; copy: (t: string, l: string) => void;
}) {
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); copy(value, label); }}
      className="p-0.5 rounded-sm hover:bg-white/10 text-[#8899aa] hover:text-white transition-colors"
      title={`Copy ${label}`}
    >
      {copied === label ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

function SourceBadge({ source }: { source: string }) {
  const color = sourceColor(source);
  return (
    <span
      className="inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}33` }}
    >
      {source}
    </span>
  );
}

function DossierSection({ title, icon: Icon, count, defaultOpen, children }: {
  title: string; icon: React.ElementType; count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border border-[#1a1a1a] rounded-sm overflow-hidden">
      <button type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#181818] hover:bg-[#1a1a1a] transition-colors text-left"
      >
        <Chevron size={12} className="text-[#556677] flex-shrink-0" />
        <Icon size={13} className="text-[#8899aa] flex-shrink-0" />
        <span className="text-[11px] font-bold text-[#c0ccdd] uppercase tracking-wider flex-1">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[9px] font-mono bg-[#0c0c0c] text-[#8899aa] px-1.5 py-0.5 rounded-sm min-w-[20px] text-center">{count}</span>
        )}
      </button>
      {open && <div className="p-3 bg-[#0c0c0c]">{children}</div>}
    </div>
  );
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-[#1a1a1a]">
            {headers.map(h => (
              <th key={h} className="text-left text-[9px] font-bold text-[#556677] uppercase tracking-wider px-2 py-1.5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a1a1a]/50">{children}</tbody>
      </table>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="p-3 border border-[#1a1a1a] rounded-sm bg-[#181818] animate-pulse space-y-2">
      <div className="h-3 bg-[#0c0c0c] rounded-sm w-3/4" />
      <div className="h-2.5 bg-[#0c0c0c] rounded-sm w-1/2" />
      <div className="flex gap-1">
        <div className="h-2 bg-[#0c0c0c] rounded-sm w-10" />
        <div className="h-2 bg-[#0c0c0c] rounded-sm w-10" />
      </div>
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm" style={{ color, backgroundColor: color + '15' }}>
      {pct}%
    </span>
  );
}

// ─── Tab type ────────────────────────────────────────────────

type Tab = 'search' | 'dossiers' | 'history' | 'sources' | 'stats';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'dossiers', label: 'Saved Dossiers', icon: Bookmark },
  { id: 'history', label: 'History', icon: History },
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
];

// ═════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════

export default function SkipTracerV2Page() {
  const isMobile = useIsMobile();
  const { copied, copy } = useCopyToClipboard();

  // Active tab
  const [activeTab, setActiveTab] = useState<Tab>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedFields, setAdvancedFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Profile | null>(null);

  // Sources
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);

  // Dossiers
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [dossiersLoading, setDossiersLoading] = useState(false);
  const [dossierSearch, setDossierSearch] = useState('');

  // History
  const [history, setHistory] = useState<SearchHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Save dossier
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Search engine selection
  const [searchEngine, setSearchEngine] = useState<'microbilt' | 'rapidapi' | 'all'>('microbilt');

  // Load sources on mount
  useEffect(() => {
    loadSources();
  }, []);

  // Load tab-specific data when switching tabs
  useEffect(() => {
    if (activeTab === 'dossiers') loadDossiers();
    else if (activeTab === 'history') loadHistory();
    else if (activeTab === 'sources') loadSources();
    else if (activeTab === 'stats') loadStats();
  }, [activeTab]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const data = await apiFetch('/skiptracer-v2/sources');
      if (Array.isArray(data)) setSources(data);
    } catch { /* silent */ }
    setSourcesLoading(false);
  }, []);

  const loadDossiers = useCallback(async () => {
    setDossiersLoading(true);
    try {
      const params = dossierSearch ? `?q=${encodeURIComponent(dossierSearch)}` : '';
      const data = await apiFetch(`/skiptracer-v2/dossiers${params}`) as any;
      if (data && Array.isArray(data.dossiers)) setDossiers(data.dossiers);
    } catch { /* silent */ }
    setDossiersLoading(false);
  }, [dossierSearch]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await apiFetch('/skiptracer-v2/history') as any;
      if (data && Array.isArray(data.searches)) setHistory(data.searches);
    } catch { /* silent */ }
    setHistoryLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch('/skiptracer-v2/stats') as Stats;
      if (data) setStats(data);
    } catch { /* silent */ }
    setStatsLoading(false);
  }, []);

  // ─── Search ───────────────────────────────────────────────

  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    const hasAdvanced = Object.values(advancedFields).some(v => v.trim());
    if (!q && !hasAdvanced) return;

    setLoading(true);
    setError(null);
    setSelected(null);
    setResult(null);

    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      for (const [key, val] of Object.entries(advancedFields)) {
        if (val.trim()) params.set(key, val.trim());
      }
      if (selectedCategories.size > 0) {
        params.set('categories', Array.from(selectedCategories).join(','));
      }
      params.set('engine', searchEngine);
      const data = await apiFetch<SearchResult>(`/skiptracer-v2/search?${params.toString()}`);
      setResult(data);
      if (data.profiles?.length === 1) setSelected(data.profiles[0]);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, advancedFields, searchEngine]);

  const searchAssociate = useCallback((name: string) => {
    setQuery(name);
    setActiveTab('search');
    setTimeout(() => handleSearch(name), 0);
  }, [handleSearch]);

  // ─── Save dossier ─────────────────────────────────────────

  const handleSaveDossier = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const name = selected.fullName || [selected.firstName, selected.lastName].filter(Boolean).join(' ') || 'Unknown';
      const resp = await apiFetch('/skiptracer-v2/dossiers', {
        method: 'POST',
        body: JSON.stringify({ subjectName: name, profileSnapshot: selected, notes: '', tags: [] }),
      }) as any;
      const id = resp?.id || resp?.dossierId;
      if (id) {
        setActiveDossierId(id);
        setDossierNotes('');
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch { /* silent */ }
    setSaving(false);
  }, [selected]);

  // ─── Export PDF ────────────────────────────────────────────

  const handleExportPdf = useCallback(async (dossierId: number) => {
    try {
      const resp = await fetch(`/api/skiptracer-v2/dossiers/${dossierId}/pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('rmpg_token')}` },
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dossier_${dossierId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }, []);

  // ─── Open saved dossier ───────────────────────────────────

  const openDossier = useCallback((dossier: Dossier) => {
    try {
      const profile = JSON.parse(dossier.profile_snapshot);
      setSelected(profile);
      setActiveDossierId(dossier.id);
      setDossierNotes(dossier.notes || '');
      setActiveTab('search');
    } catch { /* silent */ }
  }, []);

  // ─── Re-run history search ────────────────────────────────

  const rerunSearch = useCallback((item: SearchHistory) => {
    try {
      const params = JSON.parse(item.query_params);
      const q = params.name || params.phone || params.email || params.address || '';
      if (q) {
        setQuery(q);
        setActiveTab('search');
        setTimeout(() => handleSearch(q), 0);
      }
    } catch { /* silent */ }
  }, [handleSearch]);

  const inputType = detectInputType(query);

  const getDisplayName = useCallback((p: Profile) => {
    return p.fullName || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || 'Unknown';
  }, []);

  // ─── Batch Search ─────────────────────────────────────────

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchResults, setBatchResults] = useState<Profile[]>([]);

  const handleBatchSearch = useCallback(async () => {
    const names = batchText.split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return;

    setLoading(true);
    setError(null);
    setSelected(null);
    setResult(null);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: names.length });

    const allProfiles: Profile[] = [];
    const allSourcesQueried = new Set<string>();
    const allSourcesResponded = new Set<string>();
    let totalCost = 0;
    let totalDuration = 0;

    const promises = names.map(async (name, idx) => {
      try {
        const params = new URLSearchParams();
        params.set('q', name);
        if (selectedCategories.size > 0) {
          params.set('categories', Array.from(selectedCategories).join(','));
        }
        params.set('engine', searchEngine);
        const data = await apiFetch<SearchResult>(`/skiptracer-v2/search?${params.toString()}`);
        if (data.profiles) allProfiles.push(...data.profiles);
        data.sourcesQueried.forEach(s => allSourcesQueried.add(s));
        data.sourcesResponded.forEach(s => allSourcesResponded.add(s));
        totalCost += data.totalCost || 0;
        totalDuration = Math.max(totalDuration, data.durationMs || 0);
      } catch { /* silent */ }
      setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
    });

    await Promise.all(promises);

    setBatchResults(allProfiles);
    setResult({
      profiles: allProfiles,
      sourcesQueried: Array.from(allSourcesQueried),
      sourcesResponded: Array.from(allSourcesResponded),
      totalResults: allProfiles.length,
      totalCost,
      durationMs: totalDuration,
    });
    setBatchProgress(null);
    setLoading(false);
    setBatchOpen(false);
  }, [batchText]);

  // ─── Source Category Filters ─────────────────────────────

  const ALL_CATEGORIES = ['people', 'court', 'property', 'business', 'osint', 'registry'] as const;
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // ─── Dossier Notes ───────────────────────────────────────

  const [dossierNotes, setDossierNotes] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeDossierId, setActiveDossierId] = useState<number | null>(null);

  const handleNotesChange = useCallback((value: string, dossierId: number) => {
    setDossierNotes(value);
    setNotesSaveStatus('idle');
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(async () => {
      setNotesSaveStatus('saving');
      try {
        await apiFetch(`/skiptracer-v2/dossiers/${dossierId}`, {
          method: 'PUT',
          body: JSON.stringify({ notes: value }),
        });
        setNotesSaveStatus('saved');
        setTimeout(() => setNotesSaveStatus('idle'), 2000);
      } catch {
        setNotesSaveStatus('idle');
      }
    }, 1000);
  }, []);

  useEffect(() => () => { if (notesTimerRef.current) clearTimeout(notesTimerRef.current); }, []);

  // ─── Link to Incident/Case ──────────────────────────────

  const [linkDropdownOpen, setLinkDropdownOpen] = useState(false);
  const [linkType, setLinkType] = useState<'incident' | 'case'>('incident');
  const [linkValue, setLinkValue] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const linkDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (linkDropdownRef.current && !linkDropdownRef.current.contains(e.target as Node)) {
        setLinkDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLinkDossier = useCallback(async () => {
    if (!activeDossierId || !linkValue.trim()) return;
    setLinkSaving(true);
    try {
      const body: any = {};
      if (linkType === 'incident') body.linkedIncidentId = linkValue.trim();
      else body.linkedCaseId = linkValue.trim();
      await apiFetch('/skiptracer-v2/dossiers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLinkDropdownOpen(false);
      setLinkValue('');
    } catch { /* silent */ }
    setLinkSaving(false);
  }, [activeDossierId, linkType, linkValue]);

  // ─── Export PDF from Search ──────────────────────────────

  const [exporting, setExporting] = useState(false);

  const handleExportFromSearch = useCallback(async () => {
    if (!selected) return;
    setExporting(true);
    try {
      const name = selected.fullName || [selected.firstName, selected.lastName].filter(Boolean).join(' ') || 'Unknown';
      const resp = await apiFetch('/skiptracer-v2/dossiers', {
        method: 'POST',
        body: JSON.stringify({ subjectName: name, profileSnapshot: selected, notes: '', tags: [] }),
      }) as any;
      const dossierId = resp?.id || resp?.dossierId;
      if (dossierId) {
        await handleExportPdf(dossierId);
      }
    } catch { /* silent */ }
    setExporting(false);
  }, [selected, handleExportPdf]);

  // ─── Timeline builder ───────────────────────────────────

  const buildTimeline = useCallback((profile: Profile) => {
    const events: Array<{ date: string; label: string; detail: string; category: string }> = [];
    profile.courtRecords?.forEach(c => {
      const d = c.filingDate || c.date;
      if (d) events.push({ date: d, label: 'Court Filing', detail: `${c.caseType || c.type || 'Case'}: ${c.charge || c.charges?.join('; ') || c.caseNumber || ''}`, category: 'court' });
    });
    profile.custodyRecords?.forEach(c => {
      if (c.bookingDate) events.push({ date: c.bookingDate, label: 'Booking', detail: `${c.facility || 'Facility'} — ${c.charges?.join('; ') || ''}`, category: 'registry' });
    });
    profile.addresses?.forEach(a => {
      if (a.type?.toLowerCase() === 'current') return;
      const addr = a.address || a.street || '';
      if (addr) events.push({ date: '', label: 'Address', detail: [addr, a.city, a.state].filter(Boolean).join(', '), category: 'property' });
    });
    profile.licenses?.forEach(l => {
      if (l.expirationDate) events.push({ date: l.expirationDate, label: 'License Expires', detail: `${l.type || 'License'} — ${l.state || ''}`, category: 'business' });
    });
    profile.businesses?.forEach(b => {
      events.push({ date: '', label: 'Business', detail: `${b.name} (${b.role || 'Unknown role'})`, category: 'business' });
    });
    // Sort: dated events first (chronological), undated last
    events.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    return events;
  }, []);

  // ─── Source counts by category ─────────────────────────────

  const sourceSummary = useMemo(() => {
    const byCategory: Record<string, { total: number; enabled: number; healthy: number }> = {};
    for (const s of sources) {
      if (!byCategory[s.category]) byCategory[s.category] = { total: 0, enabled: 0, healthy: 0 };
      byCategory[s.category].total++;
      if (s.enabled) byCategory[s.category].enabled++;
      if (s.healthy) byCategory[s.category].healthy++;
    }
    return byCategory;
  }, [sources]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  // ─── Tab bar ──────────────────────────────────────────────
  const tabBar = (
    <div className="flex items-center gap-0 border-b border-[#1a1a1a] bg-[#0c0c0c] overflow-x-auto flex-shrink-0">
      {TABS.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? 'border-[#888888] text-[#a0a0a0] bg-[#141414]'
                : 'border-transparent text-[#556677] hover:text-[#8899aa] hover:bg-[#141414]/50'
            }`}
          >
            <Icon size={13} />
            {tab.label}
          </button>
        );
      })}
      <div className="ml-auto flex items-center gap-2 px-3 text-[9px] font-mono text-[#556677]">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          {sources.filter(s => s.healthy).length}/{sources.length} sources
        </span>
      </div>
    </div>
  );

  // ─── Search Panel (left side for search tab) ──────────────
  const searchPanel = (
    <div className={`flex flex-col ${isMobile ? 'w-full' : 'w-[380px] min-w-[380px]'} border-r border-[#1a1a1a] bg-[#141414]`}>
      <PanelTitleBar title="MicroBilt" icon={Search} statusLed="blue" ledPulse={loading}>
        {result && (
          <span className="text-[9px] font-mono text-[#556677]">
            {result.totalResults} result{result.totalResults !== 1 ? 's' : ''} &middot; {result.durationMs}ms
            {result.totalCost > 0 && <> &middot; ${result.totalCost.toFixed(4)}</>}
          </span>
        )}
      </PanelTitleBar>

      {/* Search bar */}
      <div className="p-2 border-b border-[#1a1a1a] space-y-2">
        <div className="relative flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#556677] pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Name, phone, email, or address..."
              className="w-full pl-8 pr-24 py-2 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm text-[12px] text-white placeholder-[#525252] focus:outline-none focus:border-[#888888] font-mono"
            />
            {query.trim() && (
              <>
                <span
                  className="absolute right-16 top-1/2 -translate-y-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                  style={{ backgroundColor: INPUT_BADGE_COLORS[inputType] + '22', color: INPUT_BADGE_COLORS[inputType] }}
                >
                  {inputType}
                </span>
                <IconButton onClick={() => setQuery('')} className="absolute right-10 top-1/2 -translate-y-1/2 p-0.5 text-[#556677] hover:text-white" aria-label="Clear query">
                  <X size={12} />
                </IconButton>
              </>
            )}
            <button type="button"
              onClick={() => handleSearch()}
              disabled={loading || (!query.trim() && !Object.values(advancedFields).some(v => v.trim()))}
              className="absolute right-1 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-[#888888] hover:bg-[#5a5a5a] disabled:opacity-40 rounded-sm text-[10px] font-bold text-white transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : 'GO'}
            </button>
          </div>
          <button type="button"
            onClick={() => setBatchOpen(!batchOpen)}
            className={`px-2 py-2 rounded-sm text-[10px] font-bold transition-colors flex items-center gap-1 ${
              batchOpen ? 'bg-[#888888] text-white' : 'bg-[#181818] text-[#8899aa] hover:text-white hover:bg-[#1a1a1a] border border-[#1a1a1a]'
            }`}
            title="Batch search multiple names"
          >
            <List size={12} />
          </button>
        </div>

        {/* Engine selector */}
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[8px] font-bold text-[#556677] uppercase tracking-wider mr-1">Engine:</span>
          {([
            { id: 'microbilt' as const, label: 'MicroBilt', desc: 'Primary — Full background + SSN trace', color: '#22c55e' },
            { id: 'rapidapi' as const, label: 'RapidAPI', desc: 'Secondary — Basic skip trace', color: '#f59e0b' },
            { id: 'all' as const, label: 'All Sources', desc: 'Query all enabled engines', color: '#8b5cf6' },
          ]).map(eng => (
            <button
              key={eng.id}
              type="button"
              onClick={() => setSearchEngine(eng.id)}
              className={`px-2 py-1 rounded-sm text-[9px] font-bold uppercase tracking-wider transition-all ${
                searchEngine === eng.id
                  ? 'text-white shadow-sm'
                  : 'text-[#556677] hover:text-[#8899aa] bg-[#0c0c0c] border border-[#1a1a1a]'
              }`}
              style={searchEngine === eng.id ? { backgroundColor: eng.color + '33', color: eng.color, border: `1px solid ${eng.color}55` } : undefined}
              title={eng.desc}
            >
              {eng.label}
            </button>
          ))}
        </div>

        {/* Batch search textarea */}
        {batchOpen && (
          <div className="p-2 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm space-y-2">
            <div className="text-[9px] text-[#8899aa] uppercase tracking-wider font-bold">Batch Search — one name per line</div>
            <textarea
              value={batchText}
              onChange={e => setBatchText(e.target.value)}
              placeholder={"John Smith\nJane Doe\nBob Johnson"}
              rows={5}
              className="w-full px-2 py-1.5 bg-[#141414] border border-[#1a1a1a] rounded-sm text-[11px] text-white font-mono placeholder-[#525252] focus:outline-none focus:border-[#888888] resize-y"
            />
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#556677] font-mono">
                {batchText.split('\n').filter(l => l.trim()).length} name(s)
              </span>
              <button type="button"
                onClick={handleBatchSearch}
                disabled={loading || !batchText.trim()}
                className="px-3 py-1.5 bg-[#888888] hover:bg-[#5a5a5a] disabled:opacity-40 rounded-sm text-[10px] font-bold text-white transition-colors flex items-center gap-1.5"
              >
                {batchProgress ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Searching {batchProgress.done}/{batchProgress.total}...
                  </>
                ) : (
                  <>
                    <Search size={12} />
                    Search All
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Advanced search toggle */}
        <div className="flex items-center gap-3">
          <button type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1 text-[9px] text-[#556677] hover:text-[#8899aa] uppercase tracking-wider"
          >
            <Filter size={10} />
            Advanced Search
            {advancedOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        </div>

        {advancedOpen && (
          <div className="grid grid-cols-2 gap-1.5 p-2 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm">
            {[
              { key: 'firstName', label: 'First Name', icon: User },
              { key: 'lastName', label: 'Last Name', icon: User },
              { key: 'dob', label: 'DOB (YYYY-MM-DD)', icon: Hash },
              { key: 'ssn_last4', label: 'SSN Last 4', icon: Fingerprint },
              { key: 'city', label: 'City', icon: MapPin },
              { key: 'state', label: 'State', icon: MapPin },
            ].map(field => (
              <div key={field.key}>
                <label className="text-[8px] text-[#556677] uppercase tracking-wider block mb-0.5">{field.label}</label>
                <input
                  type="text"
                  value={advancedFields[field.key] || ''}
                  onChange={e => setAdvancedFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full px-2 py-1 bg-[#141414] border border-[#1a1a1a] rounded-sm text-[11px] text-white font-mono focus:outline-none focus:border-[#888888]"
                />
              </div>
            ))}
          </div>
        )}

        {/* Source category filters */}
        <div className="flex items-center gap-1.5 px-0.5 flex-wrap">
          <span className="text-[8px] text-[#525252] uppercase tracking-wider mr-0.5">Filter:</span>
          {ALL_CATEGORIES.map(cat => {
            const isActive = selectedCategories.has(cat);
            const color = categoryColor(cat);
            return (
              <button type="button"
                key={cat}
                onClick={() => toggleCategory(cat)}
                className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border transition-colors"
                style={{
                  backgroundColor: isActive ? color + '33' : 'transparent',
                  color: isActive ? color : '#555555',
                  borderColor: isActive ? color + '55' : '#1e1e1e',
                }}
              >
                {cat}
              </button>
            );
          })}
          {selectedCategories.size > 0 && (
            <button type="button"
              onClick={() => setSelectedCategories(new Set())}
              className="text-[8px] text-[#556677] hover:text-white uppercase tracking-wider px-1 py-0.5"
            >
              Clear
            </button>
          )}
        </div>

        {/* Source status row */}
        {sources.length > 0 && (
          <div className="flex items-center gap-1.5 px-0.5 flex-wrap">
            <span className="text-[8px] text-[#525252] uppercase tracking-wider">Sources:</span>
            {sources.map(s => (
              <span
                key={s.name}
                title={`${s.displayName || s.name} — ${s.healthy ? 'OK' : s.enabled ? 'Error' : 'Disabled'}`}
                className="w-2 h-2 rounded-full flex-shrink-0 cursor-help"
                style={{ backgroundColor: s.healthy ? '#22c55e' : s.enabled ? '#f59e0b' : '#444444' }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading && <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>}

        {error && (
          <div className="p-3 border border-red-900/50 rounded-sm bg-red-950/30 text-red-300 text-[11px] flex items-center gap-2">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <IconButton onClick={() => handleSearch()} className="text-red-400 hover:text-red-300" aria-label="Retry search"><RefreshCw size={12} /></IconButton>
          </div>
        )}

        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-3">
            <Shield size={32} className="text-[#1a1a1a]" />
            <div className="text-[11px] text-[#556677] max-w-[220px]">
              Enter a name, phone, email, or address. Use Advanced Search for precise field-level queries.
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              {['John Smith', '801-555-1234', 'Salt Lake City, UT'].map(ex => (
                <button type="button"
                  key={ex}
                  onClick={() => setQuery(ex)}
                  className="text-[9px] text-[#888888] hover:text-[#a0a0a0] bg-[#888888]/10 px-2 py-0.5 rounded-sm"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && result && result.profiles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
            <Search size={24} className="text-[#1a1a1a]" />
            <div className="text-[11px] text-[#556677]">No results found</div>
            <div className="text-[9px] text-[#525252]">
              {result.sourcesFailed && result.sourcesFailed.length > 0
                ? `${result.sourcesFailed.length} source(s) failed — try again or check source config`
                : 'Try a different query or use Advanced Search'}
            </div>
          </div>
        )}

        {!loading && result && result.profiles.map(profile => {
          const isSelected = selected?.id === profile.id;
          const name = getDisplayName(profile);
          const dataPoints = [
            profile.addresses?.length || 0,
            profile.phones?.length || 0,
            profile.courtRecords?.length || 0,
          ].reduce((a, b) => a + b, 0);

          return (
            <button type="button"
              key={profile.id}
              onClick={() => setSelected(profile)}
              className={`w-full text-left p-2.5 border rounded-sm transition-all ${
                isSelected
                  ? 'border-[#888888] bg-[#888888]/15 shadow-lg shadow-[#888888]/10'
                  : 'border-[#1a1a1a] bg-[#181818] hover:bg-[#1a1a1a] hover:border-[#393939]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-bold text-white truncate">{name}</span>
                    {profile.confidenceScore !== undefined && <ConfidenceBadge score={profile.confidenceScore} />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#8899aa]">
                    {profile.age && <span>Age {profile.age}</span>}
                    {(profile.city || profile.state) && (
                      <span>{[profile.city, profile.state].filter(Boolean).join(', ')}</span>
                    )}
                    {dataPoints > 0 && <span className="text-[#556677]">{dataPoints} data points</span>}
                  </div>
                </div>
                {isSelected && <ArrowRight size={14} className="text-[#888888] flex-shrink-0 mt-0.5" />}
              </div>
              {profile.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {profile.sources.slice(0, 5).map(s => <SourceBadge key={s} source={s} />)}
                  {profile.sources.length > 5 && (
                    <span className="text-[8px] text-[#556677] self-center">+{profile.sources.length - 5}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}

        {!loading && result && result.profiles.length > 0 && (
          <div className="text-[9px] text-[#525252] text-center pt-2 font-mono space-y-0.5">
            <div>
              {result.sourcesResponded.length}/{result.sourcesQueried.length} sources responded
              {result.totalCost > 0 && <> &middot; ${result.totalCost.toFixed(4)}</>}
            </div>
            {result.sourcesFailed && result.sourcesFailed.length > 0 && (
              <div className="text-amber-600">
                {result.sourcesFailed.length} failed: {result.sourcesFailed.map(f => f.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Dossier Detail Panel ─────────────────────────────────

  const dossierDetail = (
    <div className={`flex-1 flex flex-col bg-[#141414] overflow-y-auto ${isMobile ? 'w-full' : ''}`}>
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 p-8">
          <FileText size={40} className="text-[#1a1a1a]" />
          <div className="text-[13px] text-[#556677]">Select a person from search results</div>
          <div className="text-[10px] text-[#525252] max-w-[280px]">
            Search for a subject and click a result to build their dossier with data from {sources.filter(s => s.healthy).length} active sources
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="border border-[#1a1a1a] rounded-sm bg-[#181818] p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#888888]/20 border border-[#888888]/30 flex items-center justify-center flex-shrink-0">
                    <User size={20} className="text-[#888888]" />
                  </div>
                  <div>
                    <h2 className="text-[18px] font-bold text-white leading-tight">{getDisplayName(selected)}</h2>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#8899aa] flex-wrap">
                      {selected.age !== undefined && <span className="flex items-center gap-1"><User size={10} /> Age {selected.age}</span>}
                      {selected.dob && <span className="font-mono">DOB: {selected.dob}</span>}
                      {selected.gender && <span>{selected.gender}</span>}
                      {selected.confidenceScore !== undefined && <ConfidenceBadge score={selected.confidenceScore} />}
                    </div>
                  </div>
                </div>
                {selected.aliases && selected.aliases.length > 0 && (
                  <div className="text-[10px] text-[#556677] mt-2 ml-[60px]">
                    AKA: {selected.aliases.join(' | ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Export PDF from search */}
                <button type="button"
                  onClick={handleExportFromSearch}
                  disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0c0c0c] hover:bg-[#1a1a1a] border border-[#1a1a1a] rounded-sm text-[10px] font-bold text-[#8899aa] hover:text-white transition-colors"
                  title="Save & export as PDF"
                >
                  {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Export
                </button>

                {/* Link to Incident/Case */}
                <div className="relative" ref={linkDropdownRef}>
                  <button type="button"
                    onClick={() => setLinkDropdownOpen(!linkDropdownOpen)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-bold transition-colors border ${
                      linkDropdownOpen
                        ? 'bg-[#888888] text-white border-[#888888]'
                        : 'bg-[#0c0c0c] text-[#8899aa] hover:text-white border-[#1a1a1a] hover:bg-[#1a1a1a]'
                    }`}
                  >
                    <Link2 size={12} />
                    Link
                    <ChevronDown size={10} />
                  </button>
                  {linkDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 w-64 bg-[#181818] border border-[#1a1a1a] rounded-sm shadow-xl z-50 p-3 space-y-2">
                      <div className="text-[9px] font-bold text-[#8899aa] uppercase tracking-wider">Link to Record</div>
                      <div className="flex gap-1">
                        {(['incident', 'case'] as const).map(t => (
                          <button type="button"
                            key={t}
                            onClick={() => setLinkType(t)}
                            className={`flex-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm transition-colors ${
                              linkType === t ? 'bg-[#888888] text-white' : 'bg-[#0c0c0c] text-[#556677] hover:text-white'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={linkValue}
                        onChange={e => setLinkValue(e.target.value)}
                        placeholder={linkType === 'incident' ? 'Incident number...' : 'Case number...'}
                        className="w-full px-2 py-1.5 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm text-[11px] text-white font-mono placeholder-[#525252] focus:outline-none focus:border-[#888888]"
                        onKeyDown={e => e.key === 'Enter' && handleLinkDossier()}
                      />
                      <button type="button"
                        onClick={handleLinkDossier}
                        disabled={linkSaving || !linkValue.trim()}
                        className="w-full px-2 py-1.5 bg-[#888888] hover:bg-[#5a5a5a] disabled:opacity-40 rounded-sm text-[10px] font-bold text-white transition-colors flex items-center justify-center gap-1.5"
                      >
                        {linkSaving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                        Link
                      </button>
                    </div>
                  )}
                </div>

                <button type="button"
                  onClick={handleSaveDossier}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#888888] hover:bg-[#5a5a5a] disabled:opacity-50 rounded-sm text-[10px] font-bold text-white transition-colors"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : saveSuccess ? <CheckCircle2 size={12} /> : <Save size={12} />}
                  {saveSuccess ? 'Saved!' : 'Save Dossier'}
                </button>
              </div>
            </div>

            {/* Dossier Notes */}
            {activeDossierId && (
              <div className="mt-3 pt-3 border-t border-[#1a1a1a]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-bold text-[#556677] uppercase tracking-wider">Notes</span>
                  <span className="text-[9px] font-mono text-[#525252]">
                    {notesSaveStatus === 'saving' && <span className="text-amber-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Saving...</span>}
                    {notesSaveStatus === 'saved' && <span className="text-green-500 flex items-center gap-1"><CheckCircle2 size={9} /> Saved</span>}
                  </span>
                </div>
                <textarea
                  value={dossierNotes}
                  onChange={e => handleNotesChange(e.target.value, activeDossierId)}
                  placeholder="Add investigative notes..."
                  rows={3}
                  className="w-full px-2 py-1.5 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm text-[11px] text-white font-mono placeholder-[#525252] focus:outline-none focus:border-[#888888] resize-y"
                />
              </div>
            )}
          </div>

          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Addresses', count: selected.addresses?.length || 0, icon: MapPin, color: '#f59e0b' },
              { label: 'Phones', count: selected.phones?.length || 0, icon: Phone, color: '#888888' },
              { label: 'Court', count: selected.courtRecords?.length || 0, icon: Scale, color: '#22c55e' },
              { label: 'Sources', count: selected.sources.length, icon: Database, color: '#a855f7' },
            ].map(item => {
              const I = item.icon;
              return (
                <div key={item.label} className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c] p-2 text-center">
                  <I size={14} className="mx-auto mb-1" style={{ color: item.color }} />
                  <div className="text-[14px] font-bold text-white font-mono">{item.count}</div>
                  <div className="text-[8px] text-[#556677] uppercase tracking-wider">{item.label}</div>
                </div>
              );
            })}
          </div>

          {/* Identity */}
          <DossierSection title="Identity" icon={User} defaultOpen>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
              {[
                { label: 'Full Name', value: getDisplayName(selected) },
                { label: 'Date of Birth', value: selected.dob },
                { label: 'Age', value: selected.age?.toString() },
                { label: 'Gender', value: selected.gender },
                { label: 'SSN Last 4', value: selected.ssn_last4 },
              ].filter(f => f.value).map(f => (
                <div key={f.label}>
                  <span className="text-[9px] text-[#556677] uppercase tracking-wider block">{f.label}</span>
                  <span className="text-white font-mono">{f.value}</span>
                </div>
              ))}
              {selected.aliases && selected.aliases.length > 0 && (
                <div className="col-span-2">
                  <span className="text-[9px] text-[#556677] uppercase tracking-wider block">Aliases</span>
                  <span className="text-[#c0ccdd] font-mono">{selected.aliases.join(', ')}</span>
                </div>
              )}
            </div>
            {selected.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {selected.sources.map(s => <SourceBadge key={s} source={s} />)}
              </div>
            )}
          </DossierSection>

          {/* Addresses */}
          {(selected.addresses?.length ?? 0) > 0 && (
            <DossierSection title="Addresses" icon={MapPin} count={selected.addresses!.length}>
              <DataTable headers={['Address', 'City', 'State', 'ZIP', 'Type', 'Source', '']}>
                {selected.addresses!.map((a, i) => {
                  const addr = a.address || a.street || '';
                  const fullAddr = [addr, a.city, a.state, a.zip].filter(Boolean).join(', ');
                  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullAddr)}`;
                  return (
                    <tr key={`addr-${addr}-${i}`} className="hover:bg-surface-raised/50">
                      <td className="px-2 py-1.5 text-white">{addr}</td>
                      <td className="px-2 py-1.5 text-[#c0ccdd]">{a.city || '—'}</td>
                      <td className="px-2 py-1.5 text-[#c0ccdd]">{a.state || '—'}</td>
                      <td className="px-2 py-1.5 text-[#c0ccdd]">{a.zip || '—'}</td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[9px] uppercase ${(a.type || '').toLowerCase() === 'current' ? 'text-green-400' : 'text-[#556677]'}`}>{a.type || '—'}</span>
                      </td>
                      <td className="px-2 py-1.5"><SourceBadge source={a.source} /></td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          {fullAddr && (
                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="p-0.5 rounded-sm hover:bg-white/10 text-[#f59e0b] hover:text-[#fbbf24] transition-colors" title="Open in Maps">
                              <MapPinned size={12} />
                            </a>
                          )}
                          <CopyBtn value={fullAddr} label={`addr-${i}`} copied={copied} copy={copy} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </DossierSection>
          )}

          {/* Phone Numbers */}
          {(selected.phones?.length ?? 0) > 0 && (
            <DossierSection title="Phone Numbers" icon={Phone} count={selected.phones!.length}>
              <DataTable headers={['Number', 'Type', 'Carrier', 'Status', 'Source', '']}>
                {selected.phones!.map((p, i) => (
                  <tr key={`phone-${p.number}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white font-mono">{p.number}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd] text-[9px] uppercase">{p.type || '—'}</td>
                    <td className="px-2 py-1.5 text-[#8899aa]">{p.carrier || '—'}</td>
                    <td className="px-2 py-1.5">
                      {p.lineStatus && (
                        <span className={`text-[9px] uppercase font-bold ${p.lineStatus === 'active' ? 'text-green-400' : 'text-[#556677]'}`}>{p.lineStatus}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5"><SourceBadge source={p.source} /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <a href={`tel:${p.number.replace(/\D/g, '')}`} className="p-0.5 rounded-sm hover:bg-white/10 text-[#888888] hover:text-[#a0a0a0] transition-colors" title="Call">
                          <PhoneCall size={12} />
                        </a>
                        <CopyBtn value={p.number} label={`phone-${i}`} copied={copied} copy={copy} />
                      </div>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Email & Online */}
          {((selected.emails?.length ?? 0) > 0 || (selected.socialProfiles?.length ?? 0) > 0) && (
            <DossierSection title="Email & Online" icon={Mail} count={(selected.emails?.length ?? 0) + (selected.socialProfiles?.length ?? 0)}>
              {(selected.emails?.length ?? 0) > 0 && (
                <div className="space-y-1 mb-3">
                  <div className="text-[9px] font-bold text-[#556677] uppercase tracking-wider mb-1">Email Addresses</div>
                  {selected.emails!.map((e, i) => {
                    const emailAddr = e.email || e.address || '';
                    return (
                      <div key={`email-${emailAddr}-${i}`} className="flex items-center gap-2 text-[11px] font-mono">
                        <Mail size={11} className="text-[#556677]" />
                        <span className="text-white">{emailAddr}</span>
                        <SourceBadge source={e.source} />
                        {emailAddr && (
                          <>
                            <a href={`mailto:${emailAddr}`} className="p-0.5 rounded-sm hover:bg-white/10 text-[#f472b6] hover:text-[#f9a8d4] transition-colors" title="Send email">
                              <ExternalLink size={11} />
                            </a>
                            <CopyBtn value={emailAddr} label={`email-${i}`} copied={copied} copy={copy} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {(selected.socialProfiles?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] font-bold text-[#556677] uppercase tracking-wider mb-1">Social Profiles</div>
                  {selected.socialProfiles!.map((sp, i) => (
                    <div key={`social-${sp.platform}-${sp.username}-${i}`} className="flex items-center gap-2 text-[11px]">
                      <Globe size={11} className="text-[#556677]" />
                      <span className="text-[#8899aa] font-bold text-[10px] uppercase">{sp.platform}</span>
                      <a href={sp.url} target="_blank" rel="noopener noreferrer" className="text-[#a0a0a0] hover:underline font-mono truncate">
                        {sp.username}
                      </a>
                      <ExternalLink size={10} className="text-[#525252]" />
                    </div>
                  ))}
                </div>
              )}
            </DossierSection>
          )}

          {/* Associates */}
          {(selected.associates?.length ?? 0) > 0 && (
            <DossierSection title="Associates & Relatives" icon={Users} count={selected.associates!.length}>
              <DataTable headers={['Name', 'Relationship', 'Phone', 'Source', '']}>
                {selected.associates!.map((a, i) => (
                  <tr key={`assoc-${a.name}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5">
                      <button type="button" onClick={() => searchAssociate(a.name)} className="text-[#a0a0a0] hover:underline font-mono flex items-center gap-1">
                        {a.name} <Search size={9} className="text-[#525252]" />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{a.relationship || '—'}</td>
                    <td className="px-2 py-1.5 text-[#8899aa] font-mono">{a.phone || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={a.source} /></td>
                    <td className="px-2 py-1.5">
                      {a.phone && <CopyBtn value={a.phone} label={`assoc-phone-${i}`} copied={copied} copy={copy} />}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Court & Criminal */}
          {(selected.courtRecords?.length ?? 0) > 0 && (
            <DossierSection title="Court & Criminal" icon={Scale} count={selected.courtRecords!.length}>
              <DataTable headers={['Case #', 'Court', 'Type', 'Charge', 'Date', 'Status', 'Source', '']}>
                {selected.courtRecords!.map((c, i) => (
                  <tr key={`court-${c.caseNumber}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white font-mono">{c.caseNumber || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd] max-w-[120px] truncate" title={c.court}>{c.court || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{c.caseType || c.type || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd] max-w-[150px] truncate" title={c.charge || c.charges?.join('; ')}>
                      {c.charge || c.charges?.join('; ') || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-[#8899aa] font-mono">{c.filingDate || c.date || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase font-bold ${
                        (c.status || '').toLowerCase() === 'active' || (c.status || '').toLowerCase() === 'open'
                          ? 'text-red-400' : 'text-[#556677]'
                      }`}>{c.status || '—'}</span>
                    </td>
                    <td className="px-2 py-1.5"><SourceBadge source={c.source} /></td>
                    <td className="px-2 py-1.5">
                      {c.sourceUrl && (
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#a0a0a0] hover:text-gray-300">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Custody */}
          {(selected.custodyRecords?.length ?? 0) > 0 && (
            <DossierSection title="Custody / Booking" icon={Shield} count={selected.custodyRecords!.length}>
              <div className="space-y-2">
                {selected.custodyRecords!.map((c, i) => (
                  <div key={`custody-${c.facility}-${i}`} className="p-2 border border-red-900/30 bg-red-950/10 rounded-sm text-[11px]">
                    <div className="flex items-center gap-2 text-red-300 font-bold">
                      <Shield size={12} /> {c.facility || 'Unknown Facility'}
                      {c.facilityState && <span className="text-[9px] text-[#8899aa] font-normal">({c.facilityState})</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-[#c0ccdd]">
                      {c.status && <div><span className="text-[#556677]">Status:</span> {c.status.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())}</div>}
                      {c.bookingDate && <div><span className="text-[#556677]">Booked:</span> {c.bookingDate}</div>}
                    </div>
                    {c.charges && c.charges.length > 0 && (
                      <div className="mt-1 text-[10px] text-[#8899aa]">Charges: {c.charges.join('; ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </DossierSection>
          )}

          {/* Property */}
          {(selected.propertyRecords?.length ?? 0) > 0 && (
            <DossierSection title="Property Records" icon={Home} count={selected.propertyRecords!.length}>
              <DataTable headers={['Address', 'Type', 'Value', 'Owner', 'Source']}>
                {selected.propertyRecords!.map((p, i) => (
                  <tr key={`prop-${p.address}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white">{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{p.propertyType || '—'}</td>
                    <td className="px-2 py-1.5 text-green-400 font-mono">{p.marketValue ? `$${p.marketValue.toLocaleString()}` : '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{p.ownerName || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={p.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Business */}
          {(selected.businesses?.length ?? 0) > 0 && (
            <DossierSection title="Business & Employment" icon={Building2} count={selected.businesses!.length}>
              <DataTable headers={['Business', 'Role', 'Status', 'Reg #', 'Jurisdiction', 'Source']}>
                {selected.businesses!.map((b, i) => (
                  <tr key={`biz-${b.name}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white">{b.name}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{b.role || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase font-bold ${
                        (b.status || '').toLowerCase() === 'active' ? 'text-green-400' : 'text-[#556677]'
                      }`}>{b.status || '—'}</span>
                    </td>
                    <td className="px-2 py-1.5 text-[#8899aa] font-mono">{b.registrationNumber || b.entityNumber || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{b.jurisdiction || b.state || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={b.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Licenses */}
          {(selected.licenses?.length ?? 0) > 0 && (
            <DossierSection title="Licenses" icon={Award} count={selected.licenses!.length}>
              <DataTable headers={['Type', 'Number', 'State', 'Status', 'Expires', 'Source']}>
                {selected.licenses!.map((l, i) => (
                  <tr key={`${l.type}-${l.number}-${l.state}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white">{l.type || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd] font-mono">{l.number || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd]">{l.state || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase font-bold ${
                        (l.status || '').toLowerCase() === 'active' ? 'text-green-400' : 'text-[#556677]'
                      }`}>{l.status || '—'}</span>
                    </td>
                    <td className="px-2 py-1.5 text-[#8899aa] font-mono">{l.expirationDate || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={l.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Vehicles */}
          {(selected.vehicles?.length ?? 0) > 0 && (
            <DossierSection title="Vehicles" icon={Car} count={selected.vehicles!.length}>
              <DataTable headers={['Vehicle', 'Plate', 'VIN', 'Source']}>
                {selected.vehicles!.map((v, i) => (
                  <tr key={`${v.vin || ''}-${v.plate || ''}-${i}`} className="hover:bg-surface-raised/50">
                    <td className="px-2 py-1.5 text-white">{[v.year, v.make, v.model, v.color].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-2 py-1.5 text-[#c0ccdd] font-mono">{v.plate ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ''}` : '—'}</td>
                    <td className="px-2 py-1.5 text-[#8899aa] font-mono">{v.vin || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={v.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* Registries & Watchlists */}
          {((selected.watchlistFlags?.length ?? 0) > 0 || (selected.sexOffenderRecords?.length ?? 0) > 0) && (
            <DossierSection
              title="Registries & Watchlists"
              icon={AlertTriangle}
              count={(selected.watchlistFlags?.length ?? 0) + (selected.sexOffenderRecords?.length ?? 0)}
              defaultOpen
            >
              <div className="space-y-2">
                {selected.watchlistFlags?.map((w, i) => {
                  const matched = w.matched !== false;
                  return (
                    <div
                      key={`wl-${i}`}
                      className={`flex items-center justify-between p-2.5 rounded-sm border ${
                        matched ? 'border-red-900/50 bg-red-950/20' : 'border-green-900/50 bg-green-950/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {matched ? <AlertTriangle size={14} className="text-red-400" /> : <CheckCircle2 size={14} className="text-green-400" />}
                        <div>
                          <div className={`text-[11px] font-bold ${matched ? 'text-red-300' : 'text-green-300'}`}>
                            {w.listName || w.type || 'Watchlist'}: {matched ? 'MATCH' : 'CLEAR'}
                          </div>
                          {w.details && <div className="text-[10px] text-[#8899aa] mt-0.5">{w.details}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {w.confidence !== undefined && (
                          <span className="text-[9px] font-mono text-[#556677]">{(w.confidence * 100).toFixed(0)}%</span>
                        )}
                        <SourceBadge source={w.source} />
                      </div>
                    </div>
                  );
                })}
                {selected.sexOffenderRecords?.map((so, i) => (
                  <div key={`so-${i}`} className="p-2.5 rounded-sm border border-red-900/50 bg-red-950/20">
                    <div className="flex items-center gap-2 text-red-300 font-bold text-[11px]">
                      <AlertTriangle size={14} /> Sex Offender Registry — {so.registryState || 'Unknown State'}
                    </div>
                    {so.tier && <div className="text-[10px] text-[#8899aa] mt-1">Tier: {so.tier}</div>}
                    {so.offenses && so.offenses.length > 0 && (
                      <div className="text-[10px] text-[#8899aa] mt-0.5">Offenses: {so.offenses.join('; ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </DossierSection>
          )}

          {/* Timeline */}
          {(() => {
            const events = buildTimeline(selected);
            if (events.length === 0) return null;
            return (
              <DossierSection title="Timeline" icon={Calendar} count={events.length}>
                <div className="relative pl-6">
                  {/* Vertical line */}
                  <div className="absolute left-[9px] top-0 bottom-0 w-[2px] bg-[#1a1a1a]" />
                  <div className="space-y-3">
                    {events.map((ev, i) => {
                      const color = categoryColor(ev.category);
                      return (
                        <div key={`${ev.category}-${ev.label}-${ev.date}-${i}`} className="relative">
                          {/* Dot on the line */}
                          <div
                            className="absolute -left-6 top-1 w-[12px] h-[12px] rounded-full border-2 flex-shrink-0"
                            style={{ backgroundColor: color + '33', borderColor: color }}
                          />
                          <div className="pb-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-white">{ev.label}</span>
                              <span
                                className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                                style={{ backgroundColor: color + '22', color }}
                              >
                                {(ev.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                              </span>
                              {ev.date && (
                                <span className="text-[9px] font-mono text-[#8899aa]">{ev.date}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-[#c0ccdd] mt-0.5">{ev.detail}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </DossierSection>
            );
          })()}
        </div>
      )}
    </div>
  );

  // ─── Saved Dossiers Tab ───────────────────────────────────

  const dossiersTab = (
    <div className="flex-1 overflow-y-auto p-4 bg-[#141414]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-bold text-white flex items-center gap-2">
          <Bookmark size={16} className="text-[#888888]" /> Saved Dossiers
        </h2>
        <IconButton onClick={loadDossiers} className="text-[#556677] hover:text-white p-1" aria-label="Refresh dossiers"><RefreshCw size={14} /></IconButton>
      </div>

      <div className="relative mb-3">
        <Search size={14} className="absolute left-2.5 top-2 text-[#556677]" />
        <input
          type="text"
          value={dossierSearch}
          onChange={e => setDossierSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadDossiers()}
          placeholder="Search saved dossiers..." aria-label="Search saved dossiers..."
          className="w-full pl-8 pr-3 py-1.5 bg-[#0c0c0c] border border-[#1a1a1a] rounded-sm text-[12px] text-white placeholder-[#525252] focus:outline-none focus:border-[#888888] font-mono"
        />
      </div>

      {dossiersLoading ? (
        <div className="space-y-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : dossiers.length === 0 ? (
        <div className="text-center text-[#556677] text-[11px] py-12">No saved dossiers yet</div>
      ) : (
        <div className="space-y-2">
          {dossiers.map(d => (
            <div key={d.id} className="border border-[#1a1a1a] rounded-sm bg-[#181818] p-3 hover:bg-[#1a1a1a] transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-white">{d.subject_name}</div>
                  <div className="text-[9px] text-[#556677] mt-0.5 font-mono">
                    {d.created_at} {d.created_by_name && `by ${d.created_by_name}`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton onClick={() => openDossier(d)} className="p-1.5 text-[#556677] hover:text-white hover:bg-surface-raised/50 rounded-sm" title="View" aria-label="View dossier">
                    <Eye size={13} />
                  </IconButton>
                  <IconButton onClick={() => handleExportPdf(d.id)} className="p-1.5 text-[#556677] hover:text-white hover:bg-surface-raised/50 rounded-sm" title="Export PDF" aria-label="Export dossier PDF">
                    <Download size={13} />
                  </IconButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── History Tab ──────────────────────────────────────────

  const historyTab = (
    <div className="flex-1 overflow-y-auto p-4 bg-[#141414]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-bold text-white flex items-center gap-2">
          <History size={16} className="text-[#888888]" /> Search History
        </h2>
        <IconButton onClick={loadHistory} className="text-[#556677] hover:text-white p-1" aria-label="Refresh history"><RefreshCw size={14} /></IconButton>
      </div>

      {historyLoading ? (
        <div className="space-y-2"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : history.length === 0 ? (
        <div className="text-center text-[#556677] text-[11px] py-12">No search history yet</div>
      ) : (
        <div className="space-y-1.5">
          {history.map(h => {
            let queryDisplay = '';
            try {
              const params = JSON.parse(h.query_params);
              queryDisplay = params.name || params.phone || params.email || params.address || JSON.stringify(params);
            } catch { queryDisplay = h.query_params; }

            const badgeType = h.search_type === 'name' ? 'Name' : h.search_type === 'phone' ? 'Phone' : h.search_type === 'email' ? 'Email' : 'Address';

            return (
              <div key={h.id} className="border border-[#1a1a1a] rounded-sm bg-[#181818] p-2.5 hover:bg-[#1a1a1a] transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
                        style={{ backgroundColor: INPUT_BADGE_COLORS[badgeType] + '22', color: INPUT_BADGE_COLORS[badgeType] }}
                      >
                        {h.search_type}
                      </span>
                      <span className="text-[11px] text-white font-mono truncate">{queryDisplay}</span>
                    </div>
                    <div className="text-[9px] text-[#556677] mt-0.5 font-mono flex items-center gap-2 flex-wrap">
                      <Clock size={9} /> {h.created_at}
                      <span>&middot; {h.total_results} results</span>
                      <span>&middot; {h.duration_ms}ms</span>
                      {h.cost_total > 0 && <span>&middot; ${h.cost_total.toFixed(4)}</span>}
                      {h.searcher_name && <span>&middot; {h.searcher_name}</span>}
                    </div>
                  </div>
                  <IconButton onClick={() => rerunSearch(h)} className="p-1.5 text-[#556677] hover:text-[#a0a0a0] hover:bg-surface-raised/50 rounded-sm" title="Re-run" aria-label="Re-run search">
                    <RefreshCw size={13} />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── Sources Tab ──────────────────────────────────────────

  const sourcesTab = (
    <div className="flex-1 overflow-y-auto p-4 bg-[#141414]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-bold text-white flex items-center gap-2">
          <Database size={16} className="text-[#888888]" /> Data Sources ({sources.length})
        </h2>
        <IconButton onClick={loadSources} disabled={sourcesLoading} className="text-[#556677] hover:text-white p-1" aria-label="Refresh sources">
          <RefreshCw size={14} className={sourcesLoading ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {Object.entries(sourceSummary).map(([cat, counts]) => (
          <div key={cat} className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c] p-2 text-center">
            <div className="text-[8px] font-bold uppercase tracking-wider mb-1" style={{ color: categoryColor(cat) }}>{cat}</div>
            <div className="text-[12px] font-bold text-white">{counts.healthy}/{counts.total}</div>
            <div className="text-[8px] text-[#556677]">healthy</div>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {sources.map(s => (
          <div key={s.name} className="border border-[#1a1a1a] rounded-sm bg-[#181818] p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.healthy ? '#22c55e' : s.enabled ? '#f59e0b' : '#444444' }}
                />
                <div>
                  <div className="text-[11px] font-bold text-white">{s.displayName || s.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded-sm"
                      style={{ backgroundColor: categoryColor(s.category) + '22', color: categoryColor(s.category) }}
                    >{(s.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                    {s.costPerLookup > 0
                      ? <span className="text-[9px] text-[#556677] font-mono">${s.costPerLookup.toFixed(4)}/lookup</span>
                      : <span className="text-[9px] text-green-600 font-mono">FREE</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] uppercase font-bold ${s.configured ? 'text-green-500' : 'text-amber-500'}`}>
                  {s.configured ? 'Configured' : 'Needs Key'}
                </span>
                <span className={`text-[9px] uppercase font-bold ${s.enabled ? 'text-green-500' : 'text-[#556677]'}`}>
                  {s.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ─── Stats Tab ────────────────────────────────────────────

  const statsTab = (
    <div className="flex-1 overflow-y-auto p-4 bg-[#141414]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[14px] font-bold text-white flex items-center gap-2">
          <BarChart3 size={16} className="text-[#888888]" /> Usage Statistics
        </h2>
        <IconButton onClick={loadStats} disabled={statsLoading} className="text-[#556677] hover:text-white p-1" aria-label="Refresh stats">
          <RefreshCw size={14} className={statsLoading ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      {statsLoading ? (
        <div className="space-y-2"><SkeletonCard /><SkeletonCard /></div>
      ) : !stats ? (
        <div className="text-center text-[#556677] text-[11px] py-12">No statistics available</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Today', value: stats.totalSearches.today, color: '#888888' },
              { label: 'This Week', value: stats.totalSearches.week, color: '#22c55e' },
              { label: 'All Time', value: stats.totalSearches.allTime, color: '#a855f7' },
            ].map(item => (
              <div key={item.label} className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c] p-4 text-center">
                <div className="text-[24px] font-bold font-mono" style={{ color: item.color }}>{item.value}</div>
                <div className="text-[10px] text-[#556677] uppercase tracking-wider mt-1">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c] p-4 text-center">
            <div className="text-[9px] text-[#556677] uppercase tracking-wider mb-1">Total API Cost</div>
            <div className="text-[20px] font-bold text-[#f59e0b] font-mono">${stats.totalCost.toFixed(2)}</div>
          </div>

          {stats.topSources.length > 0 && (
            <div className="border border-[#1a1a1a] rounded-sm bg-[#181818]">
              <div className="px-3 py-2 border-b border-[#1a1a1a] text-[10px] font-bold text-[#8899aa] uppercase tracking-wider">
                Top Sources by Usage
              </div>
              <div className="p-2 space-y-1">
                {stats.topSources.map((s, i) => {
                  const maxCount = stats.topSources[0]?.count || 1;
                  const pct = (s.count / maxCount) * 100;
                  return (
                    <div key={s.name} className="flex items-center gap-2">
                      <span className="text-[9px] text-[#556677] w-4 text-right font-mono">{i + 1}</span>
                      <div className="flex-1 h-5 bg-[#0c0c0c] rounded-sm overflow-hidden relative">
                        <div className="h-full rounded-sm transition-all" style={{ width: `${pct}%`, backgroundColor: '#888888' }} />
                        <span className="absolute left-2 top-0.5 text-[10px] text-white font-mono">{s.name}</span>
                      </div>
                      <span className="text-[10px] text-[#8899aa] font-mono w-8 text-right">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── Main Layout ──────────────────────────────────────────

  // Set document title
  useEffect(() => { document.title = 'MicroBilt \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0c0c0c]">
      {tabBar}
      <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} flex-1 overflow-hidden`}>
        {activeTab === 'search' && (
          <>
            {searchPanel}
            {dossierDetail}
          </>
        )}
        {activeTab === 'dossiers' && dossiersTab}
        {activeTab === 'history' && historyTab}
        {activeTab === 'sources' && sourcesTab}
        {activeTab === 'stats' && statsTab}
      </div>
    </div>
  );
}
