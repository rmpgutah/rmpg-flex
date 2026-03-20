// ============================================================
// RMPG Flex — Skip Tracer v2 — Dossier Builder
// Two-panel layout: search/results (left) + dossier view (right).
// Smart search auto-detects input type (name, phone, email, address).
// All searches hit /api/skiptracer-v2/* endpoints.
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search, User, MapPin, Phone, Mail, Users, Scale, Building2,
  AlertTriangle, ChevronDown, ChevronRight, Copy, CheckCircle2,
  Save, FileText, Plus, Loader2, Shield, Globe,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';
import { useIsMobile } from '../../hooks/useIsMobile';

// ─── Types ───────────────────────────────────────────────────

interface SourceInfo {
  name: string;
  type: 'people' | 'court' | 'property' | 'osint' | 'registry';
  enabled: boolean;
  status: string;
}

interface ProfileAddress {
  address: string;
  city: string;
  state: string;
  zip: string;
  type: string;
  source: string;
}

interface ProfilePhone {
  number: string;
  type: string;
  carrier?: string;
  source: string;
}

interface ProfileEmail {
  email: string;
  source: string;
}

interface SocialProfile {
  platform: string;
  url: string;
  username: string;
}

interface Associate {
  name: string;
  relationship: string;
  source: string;
}

interface CourtRecord {
  caseNumber: string;
  court: string;
  type: string;
  charge: string;
  date: string;
  status: string;
  source: string;
  sourceUrl?: string;
}

interface BusinessRecord {
  name: string;
  role: string;
  status: string;
  registrationNumber?: string;
  state: string;
  source: string;
}

interface RegistryMatch {
  type: 'ofac' | 'sex_offender' | 'fbi_wanted';
  matched: boolean;
  confidence?: number;
  details?: string;
  source: string;
}

interface Profile {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  age?: number;
  aliases?: string[];
  city?: string;
  state?: string;
  sources: string[];
  addresses?: ProfileAddress[];
  phones?: ProfilePhone[];
  emails?: ProfileEmail[];
  socialProfiles?: SocialProfile[];
  associates?: Associate[];
  courtRecords?: CourtRecord[];
  businesses?: BusinessRecord[];
  registries?: RegistryMatch[];
}

interface SearchResult {
  profiles: Profile[];
  sourcesQueried: number;
  sourcesResponded: number;
  totalResults: number;
  totalCost: number;
  durationMs: number;
}

// ─── Input type detection ────────────────────────────────────

type InputType = 'Name' | 'Phone' | 'Email' | 'Address';

function detectInputType(q: string): InputType {
  const trimmed = q.trim();
  if (!trimmed) return 'Name';
  // 10+ digits → phone
  if (trimmed.replace(/\D/g, '').length >= 10) return 'Phone';
  // Contains @ → email
  if (trimmed.includes('@')) return 'Email';
  // Numbers + street words → address
  if (/\d/.test(trimmed) && /\b(st|ave|rd|blvd|dr|ln|ct|way|pl|cir|pkwy|hwy)\b/i.test(trimmed)) return 'Address';
  return 'Name';
}

const INPUT_BADGE_COLORS: Record<InputType, string> = {
  Name: '#60a5fa',
  Phone: '#f59e0b',
  Email: '#f472b6',
  Address: '#34d399',
};

// ─── Source badge colors ─────────────────────────────────────

const SOURCE_TYPE_COLORS: Record<string, string> = {
  people: '#3b82f6',
  court: '#22c55e',
  property: '#f59e0b',
  osint: '#a855f7',
  registry: '#ef4444',
};

function sourceColor(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes('court') || lower.includes('criminal')) return SOURCE_TYPE_COLORS.court;
  if (lower.includes('property') || lower.includes('deed')) return SOURCE_TYPE_COLORS.property;
  if (lower.includes('osint') || lower.includes('social')) return SOURCE_TYPE_COLORS.osint;
  if (lower.includes('ofac') || lower.includes('registry') || lower.includes('sex') || lower.includes('fbi')) return SOURCE_TYPE_COLORS.registry;
  return SOURCE_TYPE_COLORS.people;
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

// ─── Copy button ─────────────────────────────────────────────

function CopyBtn({ value, label, copied, copy }: {
  value: string; label: string;
  copied: string | null; copy: (t: string, l: string) => void;
}) {
  const isCopied = copied === label;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copy(value, label); }}
      className="p-0.5 rounded-sm hover:bg-white/10 text-rmpg-400 hover:text-white transition-colors"
      title={`Copy ${label}`}
    >
      {isCopied ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Collapsible section ─────────────────────────────────────

function DossierSection({ title, icon: Icon, count, defaultOpen, children }: {
  title: string;
  icon: React.ElementType;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border border-rmpg-700 rounded-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#1a2636] hover:bg-[#1e2d40] transition-colors text-left"
      >
        <Chevron size={12} className="text-rmpg-400 flex-shrink-0" />
        <Icon size={13} className="text-rmpg-300 flex-shrink-0" />
        <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider flex-1">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[9px] font-mono bg-rmpg-700 text-rmpg-300 px-1.5 py-0.5 rounded-sm">{count}</span>
        )}
      </button>
      {open && (
        <div className="p-3 bg-[#0d1520]">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="p-3 border border-rmpg-700 rounded-sm bg-[#1a2636] animate-pulse space-y-2">
      <div className="h-3 bg-rmpg-700 rounded-sm w-3/4" />
      <div className="h-2.5 bg-rmpg-700 rounded-sm w-1/2" />
      <div className="flex gap-1">
        <div className="h-2 bg-rmpg-700 rounded-sm w-10" />
        <div className="h-2 bg-rmpg-700 rounded-sm w-10" />
      </div>
    </div>
  );
}

// ─── Source badge ─────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className="inline-block text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm text-white/90"
      style={{ backgroundColor: sourceColor(source) + '33', color: sourceColor(source), border: `1px solid ${sourceColor(source)}44` }}
    >
      {source}
    </span>
  );
}

// ─── Data table ──────────────────────────────────────────────

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-rmpg-700">
            {headers.map(h => (
              <th key={h} className="text-left text-[9px] font-bold text-rmpg-400 uppercase tracking-wider px-2 py-1.5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rmpg-700/50">{children}</tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════

export default function SkipTracerV2Page() {
  const isMobile = useIsMobile();
  const { copied, copy } = useCopyToClipboard();

  // Search
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  // Selection
  const [selected, setSelected] = useState<Profile | null>(null);

  // Sources
  const [sources, setSources] = useState<SourceInfo[]>([]);

  // Save dossier
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load sources on mount
  useEffect(() => {
    apiFetch<SourceInfo[]>('/skiptracer-v2/sources').then(setSources).catch(() => {});
  }, []);

  // ─── Search handler ────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setResult(null);
    try {
      const data = await apiFetch<SearchResult>(`/skiptracer-v2/search?q=${encodeURIComponent(q)}`);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query]);

  // ─── Save dossier ─────────────────────────────────────────
  const handleSaveDossier = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await apiFetch('/skiptracer-v2/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectName: selected.fullName,
          profileSnapshot: selected,
          notes: '',
          tags: [],
        }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // silently fail — user can retry
    } finally {
      setSaving(false);
    }
  }, [selected]);

  // ─── Search on associate click ─────────────────────────────
  const searchAssociate = useCallback((name: string) => {
    setQuery(name);
    // Trigger search after state update
    setTimeout(async () => {
      setLoading(true);
      setError(null);
      setSelected(null);
      setResult(null);
      try {
        const data = await apiFetch<SearchResult>(`/skiptracer-v2/search?q=${encodeURIComponent(name)}`);
        setResult(data);
      } catch (err: any) {
        setError(err.message || 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 0);
  }, []);

  const inputType = detectInputType(query);

  // ─── Left Panel: Search + Results ──────────────────────────
  const leftPanel = (
    <div className={`flex flex-col ${isMobile ? 'w-full' : 'w-[350px] min-w-[350px]'} border-r border-rmpg-700 bg-[#141e2b]`}>
      <PanelTitleBar title="Skip Tracer v2" icon={Search} statusLed="blue" ledPulse={loading}>
        {result && (
          <span className="text-[9px] font-mono text-rmpg-400">
            {result.totalResults} result{result.totalResults !== 1 ? 's' : ''} &middot; {result.durationMs}ms
          </span>
        )}
      </PanelTitleBar>

      {/* Search bar */}
      <div className="p-2 border-b border-rmpg-700">
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-rmpg-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Name, phone, email, or address..."
            className="w-full pl-8 pr-20 py-1.5 bg-[#0d1520] border border-rmpg-700 rounded-sm text-[12px] text-white placeholder-rmpg-500 focus:outline-none focus:border-[#1a5a9e] font-mono"
          />
          {/* Input type badge */}
          {query.trim() && (
            <span
              className="absolute right-12 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{ backgroundColor: INPUT_BADGE_COLORS[inputType] + '22', color: INPUT_BADGE_COLORS[inputType] }}
            >
              {inputType}
            </span>
          )}
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="absolute right-1 px-2 py-1 bg-[#1a5a9e] hover:bg-[#1e6ab8] disabled:opacity-40 rounded-sm text-[10px] font-bold text-white transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : 'GO'}
          </button>
        </div>

        {/* Source status dots */}
        {sources.length > 0 && (
          <div className="flex items-center gap-2 mt-1.5 px-0.5">
            <span className="text-[8px] text-rmpg-500 uppercase tracking-wider">Sources:</span>
            {sources.map(s => (
              <span
                key={s.name}
                title={`${s.name} — ${s.status}`}
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: s.enabled && s.status === 'ok'
                    ? '#22c55e'
                    : s.enabled
                      ? '#f59e0b'
                      : '#6b7280',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {/* Loading skeleton */}
        {loading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 border border-red-900/50 rounded-sm bg-red-950/30 text-red-300 text-[11px] flex items-center gap-2">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-3">
            <Shield size={32} className="text-rmpg-600" />
            <div className="text-[11px] text-rmpg-400 max-w-[200px]">
              Enter a name, phone, email, or address to search
            </div>
          </div>
        )}

        {/* No results */}
        {!loading && result && result.profiles.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
            <Search size={24} className="text-rmpg-600" />
            <div className="text-[11px] text-rmpg-400">No results found</div>
            <div className="text-[9px] text-rmpg-500">Try a different search query</div>
          </div>
        )}

        {/* Result cards */}
        {!loading && result && result.profiles.map(profile => {
          const isSelected = selected?.id === profile.id;
          return (
            <button
              key={profile.id}
              onClick={() => setSelected(profile)}
              className={`w-full text-left p-2.5 border rounded-sm transition-colors ${
                isSelected
                  ? 'border-[#1a5a9e] bg-[#1a5a9e]/15'
                  : 'border-rmpg-700 bg-[#1a2636] hover:bg-[#1e2d40] hover:border-rmpg-600'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-bold text-white truncate">{profile.fullName}</span>
                {profile.age && (
                  <span className="text-[10px] text-rmpg-400 font-mono flex-shrink-0">Age {profile.age}</span>
                )}
              </div>
              {(profile.city || profile.state) && (
                <div className="text-[10px] text-rmpg-400 mt-0.5">
                  {[profile.city, profile.state].filter(Boolean).join(', ')}
                </div>
              )}
              {profile.sources.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {profile.sources.slice(0, 4).map(s => (
                    <SourceBadge key={s} source={s} />
                  ))}
                  {profile.sources.length > 4 && (
                    <span className="text-[8px] text-rmpg-500">+{profile.sources.length - 4}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}

        {/* Search meta */}
        {!loading && result && result.profiles.length > 0 && (
          <div className="text-[9px] text-rmpg-500 text-center pt-2 font-mono">
            {result.sourcesResponded}/{result.sourcesQueried} sources responded
            {result.totalCost > 0 && <> &middot; ${result.totalCost.toFixed(4)}</>}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Right Panel: Dossier View ─────────────────────────────
  const rightPanel = (
    <div className={`flex-1 flex flex-col bg-[#141e2b] overflow-y-auto ${isMobile ? 'w-full' : ''}`}>
      {!selected ? (
        /* Empty dossier state */
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 p-8">
          <FileText size={40} className="text-rmpg-700" />
          <div className="text-[13px] text-rmpg-400">Select a person from search results</div>
          <div className="text-[10px] text-rmpg-500 max-w-[280px]">
            Search for a subject and click a result to build their dossier
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="border border-rmpg-700 rounded-sm bg-[#1a2636] p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-[18px] font-bold text-white leading-tight">{selected.fullName}</h2>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-rmpg-300">
                  {selected.age && <span>Age {selected.age}</span>}
                  {selected.dob && <span className="font-mono">DOB: {selected.dob}</span>}
                </div>
                {selected.aliases && selected.aliases.length > 0 && (
                  <div className="text-[10px] text-rmpg-500 mt-1">
                    AKA: {selected.aliases.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSaveDossier}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a5a9e] hover:bg-[#1e6ab8] disabled:opacity-50 rounded-sm text-[10px] font-bold text-white transition-colors"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : saveSuccess ? <CheckCircle2 size={12} /> : <Save size={12} />}
                  {saveSuccess ? 'Saved' : 'Save Dossier'}
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-rmpg-700 hover:bg-rmpg-600 rounded-sm text-[10px] font-bold text-rmpg-200 transition-colors">
                  <FileText size={12} />
                  Export PDF
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-rmpg-700 hover:bg-rmpg-600 rounded-sm text-[10px] font-bold text-rmpg-200 transition-colors">
                  <Plus size={12} />
                  Add to Local DB
                </button>
              </div>
            </div>
          </div>

          {/* 1. Identity */}
          <DossierSection title="Identity" icon={User} defaultOpen>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
              <div>
                <span className="text-[9px] text-rmpg-400 uppercase tracking-wider block">Full Name</span>
                <span className="text-white font-mono">{selected.fullName}</span>
              </div>
              {selected.dob && (
                <div>
                  <span className="text-[9px] text-rmpg-400 uppercase tracking-wider block">Date of Birth</span>
                  <span className="text-white font-mono">{selected.dob}</span>
                </div>
              )}
              {selected.age !== undefined && (
                <div>
                  <span className="text-[9px] text-rmpg-400 uppercase tracking-wider block">Age</span>
                  <span className="text-white font-mono">{selected.age}</span>
                </div>
              )}
              {selected.aliases && selected.aliases.length > 0 && (
                <div className="col-span-2">
                  <span className="text-[9px] text-rmpg-400 uppercase tracking-wider block">Aliases</span>
                  <span className="text-rmpg-200 font-mono">{selected.aliases.join(', ')}</span>
                </div>
              )}
            </div>
            {selected.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {selected.sources.map(s => <SourceBadge key={s} source={s} />)}
              </div>
            )}
          </DossierSection>

          {/* 2. Addresses */}
          {(selected.addresses?.length ?? 0) > 0 && (
            <DossierSection title="Addresses" icon={MapPin} count={selected.addresses!.length}>
              <DataTable headers={['Address', 'City', 'State', 'ZIP', 'Type', 'Source', '']}>
                {selected.addresses!.map((a, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5 text-white">{a.address}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{a.city}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{a.state}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{a.zip}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase ${a.type === 'current' ? 'text-green-400' : 'text-rmpg-400'}`}>{a.type}</span>
                    </td>
                    <td className="px-2 py-1.5"><SourceBadge source={a.source} /></td>
                    <td className="px-2 py-1.5">
                      <CopyBtn value={`${a.address}, ${a.city}, ${a.state} ${a.zip}`} label={`addr-${i}`} copied={copied} copy={copy} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* 3. Phone Numbers */}
          {(selected.phones?.length ?? 0) > 0 && (
            <DossierSection title="Phone Numbers" icon={Phone} count={selected.phones!.length}>
              <DataTable headers={['Number', 'Type', 'Carrier', 'Source', '']}>
                {selected.phones!.map((p, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5 text-white">{p.number}</td>
                    <td className="px-2 py-1.5 text-rmpg-200 text-[9px] uppercase">{p.type}</td>
                    <td className="px-2 py-1.5 text-rmpg-300">{p.carrier || '—'}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={p.source} /></td>
                    <td className="px-2 py-1.5">
                      <CopyBtn value={p.number} label={`phone-${i}`} copied={copied} copy={copy} />
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* 4. Email & Online */}
          {((selected.emails?.length ?? 0) > 0 || (selected.socialProfiles?.length ?? 0) > 0) && (
            <DossierSection
              title="Email & Online"
              icon={Mail}
              count={(selected.emails?.length ?? 0) + (selected.socialProfiles?.length ?? 0)}
            >
              {(selected.emails?.length ?? 0) > 0 && (
                <div className="space-y-1 mb-3">
                  <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Email Addresses</div>
                  {selected.emails!.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                      <Mail size={11} className="text-rmpg-400" />
                      <span className="text-white">{e.email}</span>
                      <SourceBadge source={e.source} />
                      <CopyBtn value={e.email} label={`email-${i}`} copied={copied} copy={copy} />
                    </div>
                  ))}
                </div>
              )}
              {(selected.socialProfiles?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Social Profiles</div>
                  {selected.socialProfiles!.map((sp, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <Globe size={11} className="text-rmpg-400" />
                      <span className="text-rmpg-300 font-bold text-[10px] uppercase">{sp.platform}</span>
                      <a href={sp.url} target="_blank" rel="noopener noreferrer" className="text-[#60a5fa] hover:underline font-mono truncate">
                        {sp.username}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </DossierSection>
          )}

          {/* 5. Associates & Relatives */}
          {(selected.associates?.length ?? 0) > 0 && (
            <DossierSection title="Associates & Relatives" icon={Users} count={selected.associates!.length}>
              <DataTable headers={['Name', 'Relationship', 'Source']}>
                {selected.associates!.map((a, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => searchAssociate(a.name)}
                        className="text-[#60a5fa] hover:underline font-mono"
                      >
                        {a.name}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-rmpg-200">{a.relationship}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={a.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* 6. Court & Criminal */}
          {(selected.courtRecords?.length ?? 0) > 0 && (
            <DossierSection title="Court & Criminal" icon={Scale} count={selected.courtRecords!.length}>
              <DataTable headers={['Case #', 'Court', 'Type', 'Charge', 'Date', 'Status', 'Source', '']}>
                {selected.courtRecords!.map((c, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5 text-white">{c.caseNumber}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{c.court}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{c.type}</td>
                    <td className="px-2 py-1.5 text-rmpg-200 max-w-[150px] truncate" title={c.charge}>{c.charge}</td>
                    <td className="px-2 py-1.5 text-rmpg-300">{c.date}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase font-bold ${
                        c.status.toLowerCase() === 'active' ? 'text-red-400' : 'text-rmpg-400'
                      }`}>{c.status}</span>
                    </td>
                    <td className="px-2 py-1.5"><SourceBadge source={c.source} /></td>
                    <td className="px-2 py-1.5">
                      {c.sourceUrl && (
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[#60a5fa] hover:text-blue-300">
                          <Globe size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* 7. Business & Employment */}
          {(selected.businesses?.length ?? 0) > 0 && (
            <DossierSection title="Business & Employment" icon={Building2} count={selected.businesses!.length}>
              <DataTable headers={['Business Name', 'Role', 'Status', 'Reg #', 'State', 'Source']}>
                {selected.businesses!.map((b, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-2 py-1.5 text-white">{b.name}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{b.role}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[9px] uppercase font-bold ${
                        b.status.toLowerCase() === 'active' ? 'text-green-400' : 'text-rmpg-400'
                      }`}>{b.status}</span>
                    </td>
                    <td className="px-2 py-1.5 text-rmpg-300">{b.registrationNumber || '—'}</td>
                    <td className="px-2 py-1.5 text-rmpg-200">{b.state}</td>
                    <td className="px-2 py-1.5"><SourceBadge source={b.source} /></td>
                  </tr>
                ))}
              </DataTable>
            </DossierSection>
          )}

          {/* 8. Registries & Watchlists */}
          {(selected.registries?.length ?? 0) > 0 && (
            <DossierSection title="Registries & Watchlists" icon={AlertTriangle} count={selected.registries!.length}>
              <div className="space-y-2">
                {selected.registries!.map((r, i) => {
                  const label = r.type === 'ofac' ? 'OFAC SDN'
                    : r.type === 'sex_offender' ? 'Sex Offender Registry'
                    : 'FBI Most Wanted';
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-2.5 rounded-sm border ${
                        r.matched
                          ? 'border-red-900/50 bg-red-950/20'
                          : 'border-green-900/50 bg-green-950/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {r.matched
                          ? <AlertTriangle size={14} className="text-red-400" />
                          : <CheckCircle2 size={14} className="text-green-400" />}
                        <div>
                          <div className={`text-[11px] font-bold ${r.matched ? 'text-red-300' : 'text-green-300'}`}>
                            {label}: {r.matched ? 'MATCH' : 'CLEAR'}
                          </div>
                          {r.details && (
                            <div className="text-[10px] text-rmpg-400 mt-0.5">{r.details}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.confidence !== undefined && (
                          <span className="text-[9px] font-mono text-rmpg-400">{(r.confidence * 100).toFixed(0)}%</span>
                        )}
                        <SourceBadge source={r.source} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </DossierSection>
          )}
        </div>
      )}
    </div>
  );

  // ─── Layout ────────────────────────────────────────────────
  return (
    <div className={`flex ${isMobile ? 'flex-col' : 'flex-row'} h-full overflow-hidden`}>
      {leftPanel}
      {rightPanel}
    </div>
  );
}
