// ============================================================
// RMPG Flex — Person Intelligence Panel
// Unified search across Utah warrants, court records, and local DB
// Replaces the old Utah Search tab on WarrantsPage
// ============================================================

import { useState, useCallback } from 'react';
import {
  Search,
  Loader2,
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  User,
  Scale,
  FileText,
  CheckCircle,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ────────────────────────────────────────────────────

interface PersonIntelResult {
  utahPersonId: string;
  searchName: string;
  age?: number;
  city?: string;
  localPersonMatch: { id: number; name: string; dob?: string } | null;
  identityConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  utahWarrants: any[];
  courtRecords: any[];
  localWarrants: any[];
}

interface IntelResponse {
  results: PersonIntelResult[];
  apiAvailable: boolean;
  utahNull: boolean;
}

// ── Severity badge colors ────────────────────────────────────

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-900/40 text-green-400 border-green-700/50',
  medium: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  low: 'bg-red-900/40 text-red-400 border-red-700/50',
};

const SEVERITY_STYLES: Record<string, string> = {
  felony: 'bg-red-900/50 text-red-300 border-red-600',
  misdemeanor: 'bg-amber-900/50 text-amber-300 border-amber-600',
  bench: 'bg-orange-900/50 text-orange-300 border-orange-600',
  civil: 'bg-gray-900/50 text-gray-300 border-gray-600',
};

// ── Component ────────────────────────────────────────────────

export default function PersonIntelPanel() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PersonIntelResult[] | null>(null);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [error, setError] = useState('');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState<Set<string>>(new Set());
  const [ingested, setIngested] = useState<Set<string>>(new Set());

  // Feature 21: Person duplicates
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [merging, setMerging] = useState(false);

  // Feature 31: Alias search
  const [aliasQuery, setAliasQuery] = useState('');
  const [aliasResults, setAliasResults] = useState<any[]>([]);
  const [aliasLoading, setAliasLoading] = useState(false);

  const fetchDuplicates = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/records/persons/duplicates');
      setDuplicates(Array.isArray(data) ? data : []);
    } catch { setDuplicates([]); }
  }, []);

  const handleMerge = useCallback(async (keepId: number, mergeId: number) => {
    setMerging(true);
    try {
      await apiFetch('/records/persons/merge', {
        method: 'POST',
        body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
      });
      setDuplicates(prev => prev.filter(d => !(d.id1 === keepId && d.id2 === mergeId) && !(d.id1 === mergeId && d.id2 === keepId)));
    } catch { /* ignore */ }
    finally { setMerging(false); }
  }, []);

  const searchAliases = useCallback(async () => {
    if (aliasQuery.trim().length < 2) return;
    setAliasLoading(true);
    try {
      const data = await apiFetch<any[]>(`/records/persons/alias-search?q=${encodeURIComponent(aliasQuery.trim())}`);
      setAliasResults(Array.isArray(data) ? data : []);
    } catch { setAliasResults([]); }
    finally { setAliasLoading(false); }
  }, [aliasQuery]);

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const search = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    setError('');
    setResults(null);
    try {
      const data = await apiFetch<IntelResponse>('/warrants/person-intel', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dob: dob.trim() || undefined,
        }),
      });
      setResults(data.results);
      setApiAvailable(data.apiAvailable);
      // Auto-expand first result
      if (data.results.length > 0) {
        setExpandedCards(new Set([data.results[0].utahPersonId]));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, dob]);

  const ingestWarrant = useCallback(async (warrant: any, result: PersonIntelResult) => {
    const key = warrant.utah_warrant_id || warrant.id;
    setIngesting(prev => new Set(prev).add(key));
    try {
      await apiFetch('/warrants/ingest-utah', {
        method: 'POST',
        body: JSON.stringify({
          utah_warrant_id: warrant.utah_warrant_id || warrant.id,
          utah_person_id: result.utahPersonId,
          first_name: warrant.first_name,
          last_name: warrant.last_name,
          court_name: warrant.court_name,
          case_id: warrant.case_id,
          charges: JSON.stringify(warrant.charges || []),
          issue_date: warrant.issue_date,
          age: result.age,
          city: result.city,
          subject_person_id: result.localPersonMatch?.id || null,
        }),
      });
      setIngested(prev => new Set(prev).add(key));
    } catch { /* ignore */ }
    setIngesting(prev => { const n = new Set(prev); n.delete(key); return n; });
  }, []);

  return (
    <div className="space-y-4">
      {/* Search form */}
      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-brand-400">Person Intelligence Search</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-[9px] uppercase text-rmpg-400 font-bold">First Name *</label>
            <input
              type="text"
              className="input-dark w-full text-sm"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="John"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase text-rmpg-400 font-bold">Last Name *</label>
            <input
              type="text"
              className="input-dark w-full text-sm"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Doe"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase text-rmpg-400 font-bold">DOB (optional)</label>
            <input
              type="date"
              className="input-dark w-full text-sm"
              value={dob}
              onChange={e => setDob(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button type="button"
              onClick={search}
              disabled={loading || !firstName.trim() || !lastName.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2 h-[34px]"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Searching...' : 'Search Intel'}
            </button>
          </div>
        </div>
        {!apiAvailable && (
          <div className="mt-2 text-xs text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Utah API temporarily unavailable — showing cached/local results only
          </div>
        )}
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      </div>

      {/* Results */}
      {results !== null && (
        <div className="space-y-3">
          {results.length === 0 ? (
            <div className="text-center py-8 text-rmpg-400 text-sm">
              No results found for <span className="font-bold text-white">{firstName} {lastName}</span>
            </div>
          ) : (
            <>
              <div className="text-xs text-rmpg-400">
                {results.length} person record{results.length !== 1 ? 's' : ''} found
              </div>
              {results.map(result => {
                const expanded = expandedCards.has(result.utahPersonId);
                const totalWarrants = result.utahWarrants.length + result.localWarrants.length;
                return (
                  <div key={result.utahPersonId} className="bg-surface-raised border border-rmpg-600 rounded-sm overflow-hidden">
                    {/* Card header */}
                    <button type="button"
                      onClick={() => toggleCard(result.utahPersonId)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-rmpg-700/30 transition-colors text-left"
                    >
                      {expanded ? <ChevronDown className="w-4 h-4 text-rmpg-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-rmpg-400 shrink-0" />}
                      <User className="w-4 h-4 text-rmpg-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-bold text-white text-sm">{result.searchName}</span>
                        {result.age && <span className="text-rmpg-400 text-xs ml-2">Age {result.age}</span>}
                        {result.city && <span className="text-rmpg-400 text-xs ml-2">{result.city}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Confidence badge */}
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-sm border ${CONFIDENCE_STYLES[result.identityConfidence]}`}>
                          {result.identityConfidence} conf
                        </span>
                        {/* Warrant count */}
                        {totalWarrants > 0 && (
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-sm border bg-red-900/40 text-red-400 border-red-700/50">
                            {totalWarrants} warrant{totalWarrants !== 1 ? 's' : ''}
                          </span>
                        )}
                        {result.courtRecords.length > 0 && (
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-sm border bg-gray-900/40 text-gray-400 border-gray-700/50">
                            {result.courtRecords.length} court
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-rmpg-600">
                        {/* Identity match info */}
                        <div className="flex items-center gap-2 mt-3 text-xs text-rmpg-400">
                          <span className="font-bold">Match factors:</span>
                          {result.confidenceFactors.map(f => (
                            <span key={f} className="px-1.5 py-0.5 bg-rmpg-700 rounded-sm text-[9px]">{f}</span>
                          ))}
                          {result.localPersonMatch && (
                            <span className="text-green-400 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Local match: {result.localPersonMatch.name}
                            </span>
                          )}
                        </div>

                        {/* Utah Warrants */}
                        {result.utahWarrants.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-xs font-bold uppercase text-red-400">Utah Warrants ({result.utahWarrants.length})</span>
                            </div>
                            <div className="space-y-2">
                              {result.utahWarrants.map((w: any, i: number) => {
                                const wKey = w.utah_warrant_id || w.id || `uw-${i}`;
                                const isIngested = ingested.has(wKey);
                                const isIngesting = ingesting.has(wKey);
                                return (
                                  <div key={wKey} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <span className="font-bold text-white">{w.court_name || 'Unknown Court'}</span>
                                        {w.case_id && <span className="text-rmpg-400 ml-2">Case: {w.case_id}</span>}
                                      </div>
                                      {isIngested ? (
                                        <span className="text-green-400 text-[9px] flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Ingested</span>
                                      ) : (
                                        <button type="button"
                                          onClick={() => ingestWarrant(w, result)}
                                          disabled={isIngesting}
                                          className="text-[9px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
                                        >
                                          {isIngesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                          {isIngesting ? 'Saving...' : 'Ingest to Local'}
                                        </button>
                                      )}
                                    </div>
                                    {w.charges && w.charges.length > 0 && (
                                      <div className="mt-1 text-rmpg-300">
                                        {(Array.isArray(w.charges) ? w.charges : [w.charges]).map((c: string, ci: number) => (
                                          <div key={ci} className="flex items-center gap-1">
                                            <Scale className="w-2.5 h-2.5 text-rmpg-500 shrink-0" /> {c}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {w.issue_date && <div className="mt-1 text-rmpg-400">Issued: {w.issue_date}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Court Records */}
                        {result.courtRecords.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="w-3.5 h-3.5 text-gray-400" />
                              <span className="text-xs font-bold uppercase text-gray-400">Court Records ({result.courtRecords.length})</span>
                            </div>
                            <div className="space-y-1">
                              {result.courtRecords.slice(0, 10).map((cr: any, i: number) => (
                                <div key={`court-${cr.case_number || i}`} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-3 py-1.5 text-xs flex items-center justify-between">
                                  <div>
                                    <span className="font-bold text-white">{cr.case_number || 'N/A'}</span>
                                    <span className="text-rmpg-400 ml-2">{cr.court_name || ''}</span>
                                    {cr.charge && <span className="text-rmpg-300 ml-2">{cr.charge}</span>}
                                  </div>
                                  {cr.filing_date && <span className="text-rmpg-400 text-[9px]">{cr.filing_date}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Local Warrants */}
                        {result.localWarrants.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Shield className="w-3.5 h-3.5 text-green-400" />
                              <span className="text-xs font-bold uppercase text-green-400">Local Warrants ({result.localWarrants.length})</span>
                            </div>
                            <div className="space-y-1">
                              {result.localWarrants.map((lw: any, i: number) => (
                                <div key={lw.id || i} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-3 py-1.5 text-xs flex items-center justify-between">
                                  <div>
                                    <span className="font-bold text-white">{lw.warrant_number}</span>
                                    <span className="text-rmpg-400 ml-2">{lw.charge_description || ''}</span>
                                  </div>
                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${SEVERITY_STYLES[lw.offense_level || ''] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
                                    {lw.offense_level || lw.status || 'active'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Empty state */}
                        {result.utahWarrants.length === 0 && result.courtRecords.length === 0 && result.localWarrants.length === 0 && (
                          <div className="text-center py-4 text-rmpg-400 text-xs">
                            No warrants or court records found for this person
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Feature 31: Alias Search ── */}
      <div className="mt-4 pt-4 border-t border-rmpg-600">
        <div className="text-xs font-bold text-rmpg-300 uppercase mb-2">Alias / AKA Search</div>
        <div className="flex gap-2">
          <input
            type="text"
            className="input-dark flex-1 text-xs"
            placeholder="Search by alias, nickname, AKA..."
            value={aliasQuery}
            onChange={(e) => setAliasQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') searchAliases(); }}
          />
          <button type="button" onClick={searchAliases} disabled={aliasLoading || aliasQuery.trim().length < 2} className="toolbar-btn text-[10px]">
            {aliasLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Search
          </button>
        </div>
        {aliasResults.length > 0 && (
          <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {aliasResults.map((p: any) => (
              <div key={p.id} className="text-xs px-2 py-1.5 bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm">
                <span className="font-bold text-white">{p.first_name} {p.last_name}</span>
                {p.dob && <span className="text-rmpg-400 ml-2">DOB: {p.dob}</span>}
                {p.aliases && <div className="text-rmpg-300 text-[10px] mt-0.5">AKA: {p.aliases}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Feature 21: Person Merge Tool ── */}
      <div className="mt-4 pt-4 border-t border-rmpg-600">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-rmpg-300 uppercase">Duplicate Detection</span>
          <button type="button"
            onClick={() => { setShowDuplicates(!showDuplicates); if (!showDuplicates) fetchDuplicates(); }}
            className="toolbar-btn text-[9px]"
          >
            {showDuplicates ? 'Hide' : 'Scan for Duplicates'}
          </button>
        </div>
        {showDuplicates && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {duplicates.length === 0 ? (
              <div className="text-[10px] text-rmpg-500 text-center py-3">No duplicate persons detected</div>
            ) : (
              duplicates.map((d: any, idx: number) => (
                <div key={idx} className="text-xs p-2 bg-amber-950/20 border border-amber-700/30 rounded-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-white font-bold">#{d.id1}</span>
                      <span className="text-rmpg-300 ml-1">{d.first_name1} {d.last_name1}</span>
                      {d.dob1 && <span className="text-rmpg-500 ml-1">({d.dob1})</span>}
                    </div>
                    <span className="text-amber-400 text-[9px] font-bold">POSSIBLE DUPLICATE</span>
                  </div>
                  <div className="mt-1">
                    <span className="text-white font-bold">#{d.id2}</span>
                    <span className="text-rmpg-300 ml-1">{d.first_name2} {d.last_name2}</span>
                    {d.dob2 && <span className="text-rmpg-500 ml-1">({d.dob2})</span>}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button type="button"
                      onClick={() => handleMerge(d.id1, d.id2)}
                      disabled={merging}
                      className="toolbar-btn text-[8px] bg-green-900/30 text-green-400 border-green-700/30"
                    >
                      Keep #{d.id1}, Merge #{d.id2}
                    </button>
                    <button type="button"
                      onClick={() => handleMerge(d.id2, d.id1)}
                      disabled={merging}
                      className="toolbar-btn text-[8px] bg-gray-900/30 text-gray-400 border-gray-700/30"
                    >
                      Keep #{d.id2}, Merge #{d.id1}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
