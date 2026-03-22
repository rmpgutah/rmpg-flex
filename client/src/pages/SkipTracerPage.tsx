// ============================================================
// RMPG Flex — Skip Tracer Page
// Standalone skip-tracing search against the RapidAPI Skip
// Tracing Working API. Supports search by name, address,
// phone, email, and combined name+address queries.
// All searches are logged server-side for audit trail.
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search, User, MapPin, Phone, Mail, Loader2, ChevronRight,
  AlertCircle, ExternalLink, Copy, CheckCircle2, Hash,
  ChevronLeft, ChevronDown,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';

// Search modes
type SearchMode = 'name' | 'address' | 'nameaddress' | 'phone' | 'email';

const SEARCH_MODES: { id: SearchMode; label: string; icon: React.ElementType; color: string; description: string }[] = [
  { id: 'name', label: 'By Name', icon: User, color: '#60a5fa', description: 'Search by full name (first and last)' },
  { id: 'address', label: 'By Address', icon: MapPin, color: '#34d399', description: 'Search by street address' },
  { id: 'nameaddress', label: 'Name + Address', icon: Search, color: '#a78bfa', description: 'Search by name and address combined' },
  { id: 'phone', label: 'By Phone', icon: Phone, color: '#f59e0b', description: 'Reverse phone lookup' },
  { id: 'email', label: 'By Email', icon: Mail, color: '#f472b6', description: 'Search by email address' },
];

// Clipboard copy helper
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

export default function SkipTracerPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { copied, copy } = useCopyToClipboard();

  // Search state
  const [mode, setMode] = useState<SearchMode>('name');
  const [nameQuery, setNameQuery] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [phoneQuery, setPhoneQuery] = useState('');
  const [emailQuery, setEmailQuery] = useState('');
  const [page, setPage] = useState(1);

  // Results
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [expandedPerson, setExpandedPerson] = useState<number | null>(null);

  // Person details via ID
  const [personDetail, setPersonDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleSearch = useCallback(async (overridePage?: number) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setPersonDetail(null);

    const pg = overridePage || page;

    try {
      let data: any;
      switch (mode) {
        case 'name':
          if (!nameQuery.trim()) throw new Error('Enter a name to search');
          data = await apiFetch(`/skiptracer/search/byname?name=${encodeURIComponent(nameQuery.trim())}&page=${pg}`);
          break;
        case 'address':
          if (!addressQuery.trim()) throw new Error('Enter an address to search');
          data = await apiFetch(`/skiptracer/search/byaddress?address=${encodeURIComponent(addressQuery.trim())}&page=${pg}`);
          break;
        case 'nameaddress':
          if (!nameQuery.trim() || !addressQuery.trim()) throw new Error('Enter both name and address');
          data = await apiFetch(`/skiptracer/search/bynameaddress?name=${encodeURIComponent(nameQuery.trim())}&address=${encodeURIComponent(addressQuery.trim())}&page=${pg}`);
          break;
        case 'phone':
          if (!phoneQuery.trim()) throw new Error('Enter a phone number');
          data = await apiFetch(`/skiptracer/search/byphone?phone=${encodeURIComponent(phoneQuery.trim())}&page=${pg}`);
          break;
        case 'email':
          if (!emailQuery.trim()) throw new Error('Enter an email address');
          data = await apiFetch(`/skiptracer/search/byemail?email=${encodeURIComponent(emailQuery.trim())}&page=${pg}`);
          break;
      }
      setResults(data);
    } catch (err: any) {
      setError(err?.message || 'Search failed');
      addToast(err?.message || 'Skip trace search failed', 'error');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [mode, nameQuery, addressQuery, phoneQuery, emailQuery, page]);

  // ── Search History (localStorage) ──
  const HISTORY_KEY = 'rmpg_skiptracer_history';
  const [searchHistory, setSearchHistory] = useState<{ query: string; mode: SearchMode; date: string; count: number }[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  });

  const saveSearchToHistory = useCallback((query: string, searchMode: SearchMode, resultCount: number) => {
    setSearchHistory(prev => {
      const entry = { query, mode: searchMode, date: new Date().toISOString(), count: resultCount };
      const updated = [entry, ...prev.filter(h => !(h.query === query && h.mode === searchMode))].slice(0, 20);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setSearchHistory([]);
  }, []);

  const rerunSearch = useCallback((entry: { query: string; mode: SearchMode }) => {
    setMode(entry.mode);
    switch (entry.mode) {
      case 'name': setNameQuery(entry.query); break;
      case 'address': setAddressQuery(entry.query); break;
      case 'phone': setPhoneQuery(entry.query); break;
      case 'email': setEmailQuery(entry.query); break;
      case 'nameaddress': setNameQuery(entry.query); break;
    }
    setPage(1);
    // Trigger search after state updates
    setTimeout(() => handleSearch(), 100);
  }, [handleSearch]);

  // Save to history after successful search
  useEffect(() => {
    if (results && !error) {
      const query = mode === 'name' ? nameQuery : mode === 'address' ? addressQuery : mode === 'phone' ? phoneQuery : mode === 'email' ? emailQuery : nameQuery;
      if (query.trim()) {
        const count = results?.PeopleDetails?.length || results?.data?.length || 0;
        saveSearchToHistory(query.trim(), mode, count);
      }
    }
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveSync('skiptracer', handleSearch);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    handleSearch(newPage);
  };

  const handleGetPersonDetails = async (id: string) => {
    setLoadingDetail(true);
    try {
      const data = await apiFetch(`/skiptracer/person/${encodeURIComponent(id)}`);
      setPersonDetail(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to get person details');
      addToast('Failed to load person details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  // Extract result items — API returns { PeopleDetails: [...] }
  const resultItems: any[] = results?.PeopleDetails || results?.data || results?.result || (Array.isArray(results) ? results : []);
  const totalRecords: number = results?.Records || resultItems.length;

  // ─── Render helpers ─────────────────────────────────────
  const renderCopyButton = (text: string, label: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); copy(text, label); }}
      className="ml-1 text-rmpg-600 hover:text-blue-400 transition-colors"
      title={`Copy ${label}`}
    >
      {copied === label ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );

  const renderFieldRow = (label: string, value: any, copyLabel?: string) => {
    if (!value) return null;
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return (
      <div className="flex items-baseline gap-2 py-0.5">
        <span className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold w-24 shrink-0">{label}</span>
        <span className="text-[11px] text-rmpg-200 font-mono">{strVal}</span>
        {copyLabel && renderCopyButton(strVal, copyLabel)}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="SKIP TRACER" icon={Search}>
        <ExportButton exportUrl="/api/skiptracer/export/csv" exportFilename="skip-traces.csv" />
      </PanelTitleBar>

      <div className={`flex-1 overflow-hidden ${isMobile ? 'flex flex-col' : 'flex'}`}>
        {/* ─── Left Panel: Search Form ──────────────────────── */}
        <div
          className={`${isMobile ? 'flex-shrink-0' : 'w-80'} overflow-y-auto border-r border-rmpg-700`}
          style={{ background: '#0d0d0d' }}
        >
          {/* Search Mode Selector */}
          <div className="p-3 space-y-3">
            <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Search Method</div>
            <div className="grid grid-cols-2 gap-1.5">
              {SEARCH_MODES.map(({ id, label, icon: Icon, color }) => (
                <button
                  key={id}
                  onClick={() => { setMode(id); setResults(null); setSelected(null); setPage(1); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${
                    mode === id
                      ? 'bg-surface-base border-rmpg-500 text-white'
                      : 'bg-transparent border-rmpg-700 text-rmpg-500 hover:border-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  <Icon className="w-3 h-3" style={{ color: mode === id ? color : undefined }} />
                  {label}
                </button>
              ))}
            </div>

            {/* Search Fields */}
            <div className="space-y-2 pt-2">
              {(mode === 'name' || mode === 'nameaddress') && (
                <div>
                  <label className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="e.g. John Smith"
                    className="w-full bg-surface-base border border-rmpg-600 text-white text-xs px-3 py-1.5 font-mono focus:border-blue-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              {(mode === 'address' || mode === 'nameaddress') && (
                <div>
                  <label className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={addressQuery}
                    onChange={(e) => setAddressQuery(e.target.value)}
                    placeholder="e.g. 123 Main St, Anytown, UT"
                    className="w-full bg-surface-base border border-rmpg-600 text-white text-xs px-3 py-1.5 font-mono focus:border-blue-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus={mode === 'address'}
                  />
                </div>
              )}

              {mode === 'phone' && (
                <div>
                  <label className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phoneQuery}
                    onChange={(e) => setPhoneQuery(e.target.value)}
                    placeholder="e.g. 801-555-1234"
                    className="w-full bg-surface-base border border-rmpg-600 text-white text-xs px-3 py-1.5 font-mono focus:border-blue-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              {mode === 'email' && (
                <div>
                  <label className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="text"
                    value={emailQuery}
                    onChange={(e) => setEmailQuery(e.target.value)}
                    placeholder="e.g. john@example.com"
                    className="w-full bg-surface-base border border-rmpg-600 text-white text-xs px-3 py-1.5 font-mono focus:border-blue-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              <button
                onClick={() => handleSearch()}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-wider bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 border border-blue-700"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs bg-red-900/20 text-red-400 border border-red-700/50">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Result count */}
            {results && !loading && (
              <div className="text-[10px] text-rmpg-400 pt-1">
                {resultItems.length > 0
                  ? `Found ${totalRecords} result${totalRecords !== 1 ? 's' : ''} — Page ${results?.Page || page}`
                  : 'No results found'}
              </div>
            )}

            {/* Pagination */}
            {results && resultItems.length >= 10 && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => page > 1 && handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-surface-base border border-rmpg-600 text-rmpg-400 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <span className="text-[10px] text-rmpg-500 tabular-nums">Page {page}</span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={loading}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-surface-base border border-rmpg-600 text-rmpg-400 hover:text-white disabled:opacity-30"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* ─── Recent Searches ────────────────────────────── */}
          {searchHistory.length > 0 && (
            <div className="border-t border-rmpg-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider">Recent Searches</span>
                <button onClick={clearSearchHistory} className="text-[8px] text-rmpg-600 hover:text-red-400 transition-colors">Clear</button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {searchHistory.slice(0, 10).map((entry, i) => (
                  <button key={i} onClick={() => rerunSearch(entry)}
                    className="w-full text-left px-2 py-1.5 text-[10px] bg-surface-sunken border border-rmpg-800 hover:bg-rmpg-800/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-rmpg-200 font-mono truncate">{entry.query}</span>
                      <span className="text-[8px] text-rmpg-600 ml-1 shrink-0">{entry.count} results</span>
                    </div>
                    <div className="flex items-center gap-2 text-[8px] text-rmpg-500">
                      <span className="uppercase">{entry.mode}</span>
                      <span>{new Date(entry.date).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Result List ────────────────────────────────── */}
          {resultItems.length > 0 && (
            <div className="border-t border-rmpg-700">
              {resultItems.map((person: any, idx: number) => {
                // API returns: Name, "Person ID", Age, "Lives in", "Used to live in", "Related to", Link
                const name = person.Name || person.name || person.fullName || `Result ${idx + 1}`;
                const age = person.Age || person.age;
                const livesIn = person['Lives in'] || person.livesIn || '';
                const personId = person['Person ID'] || person.personId || '';
                const isActive = selected === person;

                return (
                  <button
                    key={idx}
                    onClick={() => setSelected(person)}
                    className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-all ${
                      isActive
                        ? 'bg-blue-900/20 border-l-2 border-l-blue-500'
                        : 'hover:bg-surface-base border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-rmpg-100 truncate">{name}</div>
                          <div className="text-[9px] text-rmpg-500">
                            {age && `Age ${age}`}
                            {age && livesIn && ' · '}
                            {livesIn}
                          </div>
                          {personId && <div className="text-[8px] text-rmpg-600 font-mono">ID: {personId}</div>}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-rmpg-600 shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Right Panel: Detail View ─────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4" style={{ background: 'var(--surface-deep)' }}>
          {!selected && !personDetail && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Search className="w-12 h-12 text-rmpg-700 mb-3" />
              <p className="text-sm text-rmpg-500 font-bold uppercase tracking-wider">Skip Tracer</p>
              <p className="text-[10px] text-rmpg-600 mt-1 max-w-xs">
                Search for individuals by name, address, phone, or email.
                Select a result to view detailed information.
              </p>
            </div>
          )}

          {selected && (
            <div className="space-y-4 animate-fade-in">
              {/* Person Header */}
              <div className="panel-beveled bg-surface-base p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-sm" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                    <User className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-bold text-white tracking-wider uppercase truncate">
                      {selected.Name || selected.name || selected.fullName || 'Unknown'}
                    </h2>
                    <div className="flex items-center gap-2 text-[10px] text-rmpg-400 mt-0.5">
                      {(selected.Age || selected.age) && <span>Age {selected.Age || selected.age}</span>}
                      {selected['Lives in'] && <span>{selected['Lives in']}</span>}
                    </div>
                    {selected['Person ID'] && (
                      <div className="text-[9px] text-rmpg-500 font-mono mt-0.5">ID: {selected['Person ID']}</div>
                    )}
                  </div>
                  {selected['Person ID'] && (
                    <button
                      onClick={() => handleGetPersonDetails(selected['Person ID'])}
                      disabled={loadingDetail}
                      className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-blue-700/20 text-blue-400 border border-blue-700/50 hover:bg-blue-700/40 disabled:opacity-50"
                    >
                      {loadingDetail ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                      Full Details
                    </button>
                  )}
                </div>
              </div>

              {/* Render all available fields dynamically */}
              <div className="panel-beveled bg-surface-base p-4 space-y-1">
                <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Person Information</div>
                {renderAllFields(selected, renderFieldRow)}
              </div>

              {/* Phones */}
              {renderArraySection(selected, ['phones', 'phoneNumbers', 'phone_numbers', 'Phones'], 'Phone Numbers', Phone, '#f59e0b', renderFieldRow, copy, copied)}

              {/* Emails */}
              {renderArraySection(selected, ['emails', 'emailAddresses', 'email_addresses', 'Emails'], 'Email Addresses', Mail, '#f472b6', renderFieldRow, copy, copied)}

              {/* Addresses */}
              {renderArraySection(selected, ['addresses', 'Addresses', 'address_history'], 'Addresses', MapPin, '#34d399', renderFieldRow, copy, copied)}

              {/* Relatives / Associates */}
              {renderArraySection(selected, ['relatives', 'Relatives', 'associates', 'Associates'], 'Relatives / Associates', User, '#a78bfa', renderFieldRow, copy, copied)}

              {/* Raw JSON (collapsible) */}
              <details className="panel-beveled bg-surface-base">
                <summary className="flex items-center gap-2 p-3 cursor-pointer text-[10px] font-bold text-rmpg-400 uppercase tracking-wider hover:text-rmpg-200">
                  <Hash className="w-3.5 h-3.5" />
                  Raw API Response
                  <ChevronDown className="w-3 h-3 ml-auto" />
                </summary>
                <pre className="p-3 text-[9px] text-rmpg-400 font-mono overflow-x-auto border-t border-rmpg-700 max-h-64 overflow-y-auto">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Person Detail (from ID lookup) */}
          {personDetail && (
            <div className="mt-4 panel-beveled bg-surface-base p-4 space-y-1 animate-fade-in">
              <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider mb-2">Extended Person Details</div>
              {renderAllFields(personDetail, renderFieldRow)}
              <details className="mt-3">
                <summary className="text-[9px] text-rmpg-500 cursor-pointer hover:text-rmpg-300">Raw Response</summary>
                <pre className="mt-2 text-[9px] text-rmpg-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(personDetail, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Utility: Render all top-level fields of an object ───────
const SKIP_KEYS = new Set(['phones', 'phoneNumbers', 'phone_numbers', 'Phones', 'emails', 'emailAddresses', 'email_addresses', 'Emails', 'addresses', 'Addresses', 'address_history', 'relatives', 'Relatives', 'associates', 'Associates', 'Link']);

function renderAllFields(obj: any, renderFieldRow: (label: string, value: any, copyLabel?: string) => React.ReactNode): React.ReactNode {
  if (!obj || typeof obj !== 'object') return null;
  return Object.entries(obj)
    .filter(([key]) => !SKIP_KEYS.has(key))
    .map(([key, value]) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'object' && !Array.isArray(value)) return null; // skip nested objects
      if (Array.isArray(value) && value.length === 0) return null;
      const label = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
      const displayValue = Array.isArray(value) ? value.join(', ') : value;
      return <React.Fragment key={key}>{renderFieldRow(label, displayValue, key)}</React.Fragment>;
    });
}

// ─── Utility: Render an array section (phones, emails, etc.) ─
function renderArraySection(
  person: any,
  possibleKeys: string[],
  title: string,
  Icon: React.ElementType,
  color: string,
  renderFieldRow: (label: string, value: any, copyLabel?: string) => React.ReactNode,
  copy: (text: string, label: string) => void,
  copied: string | null,
): React.ReactNode {
  let items: any[] = [];
  for (const key of possibleKeys) {
    if (person[key] && Array.isArray(person[key]) && person[key].length > 0) {
      items = person[key];
      break;
    }
  }
  if (items.length === 0) return null;

  return (
    <div className="panel-beveled bg-surface-base p-4 space-y-2">
      <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider" style={{ color }}>
        <Icon className="w-3.5 h-3.5" />
        {title} ({items.length})
      </div>
      {items.map((item: any, idx: number) => (
        <div key={idx} className="pl-3 border-l-2 py-1 space-y-0.5" style={{ borderColor: color + '40' }}>
          {typeof item === 'string' ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-rmpg-200 font-mono">{item}</span>
              <button
                onClick={() => copy(item, `${title}-${idx}`)}
                className="text-rmpg-600 hover:text-blue-400"
              >
                {copied === `${title}-${idx}` ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          ) : typeof item === 'object' ? (
            Object.entries(item).map(([k, v]) => {
              if (!v) return null;
              return <React.Fragment key={k}>{renderFieldRow(k.replace(/_/g, ' '), v)}</React.Fragment>;
            })
          ) : (
            <span className="text-[11px] text-rmpg-200 font-mono">{String(item)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
