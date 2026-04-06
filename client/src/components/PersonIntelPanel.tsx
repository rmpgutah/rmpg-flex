// client/src/components/PersonIntelPanel.tsx
import React, { useState, useCallback } from 'react';
import { Search, Loader2, User, ChevronDown, ChevronRight, Plus, ExternalLink } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { formatDate } from '../utils/dateUtils';

interface UtahWarrant {
  utah_warrant_id: string;
  court_name: string | null;
  case_id: string | null;
  charges: string | null;
  issue_date: string | null;
  bail_amount?: number | null;
}

interface CourtRecord {
  case_number: string;
  court_name: string;
  case_type: string;
  filing_date: string;
  disposition: string;
  disposition_date: string;
  charges?: string;
  defendant_name?: string;
}

interface PersonIntelResult {
  utahPersonId: string | null;
  searchName: string;
  age: number | null;
  city: string | null;
  localPersonMatch: { id: number; name: string; dob: string | null } | null;
  identityConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  utahWarrants: UtahWarrant[];
  courtRecords: CourtRecord[];
  localWarrants: any[];
  watchHistory: any[];
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'text-green-400 border-green-700/40 bg-green-950/20',
  medium: 'text-amber-400 border-amber-700/40 bg-amber-950/20',
  low: 'text-rmpg-400 border-rmpg-700/20 bg-transparent',
};

const CONFIDENCE_BAR: Record<string, string> = { high: '100%', medium: '60%', low: '30%' };

const DISPOSITION_STYLES: Record<string, string> = {
  active: 'bg-red-900/40 text-red-300 border-red-800/40',
  pending: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  closed: 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20',
  convicted: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
  dismissed: 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20',
};

function dispositionStyle(d: string): string {
  return DISPOSITION_STYLES[d?.toLowerCase()] || 'bg-rmpg-700/20 text-rmpg-400 border-rmpg-700/20';
}

interface Props {
  apiAvailable: boolean;
  onNavigatePerson?: (personId: number) => void;
}

export default function PersonIntelPanel({ apiAvailable, onNavigatePerson }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PersonIntelResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());
  const [ingestedIds, setIngestedIds] = useState<Set<string>>(new Set());

  const search = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await apiFetch<{ results: PersonIntelResult[]; apiAvailable: boolean; utahNull: boolean }>(
        '/warrants/person-intel',
        { method: 'POST', body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), dob: dob.trim() || undefined }) }
      );
      setResults(res.results || []);
      if (res.results?.length > 0) {
        setExpanded(new Set([res.results[0].utahPersonId || res.results[0].searchName]));
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, dob]);

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const ingestWarrant = async (result: PersonIntelResult, warrant: UtahWarrant) => {
    const key = warrant.utah_warrant_id;
    setIngestingIds(prev => new Set(prev).add(key));
    try {
      await apiFetch('/warrants/ingest-utah', {
        method: 'POST',
        body: JSON.stringify({
          utah_warrant_id: warrant.utah_warrant_id,
          utah_person_id: result.utahPersonId,
          first_name: result.searchName.split(' ')[0],
          last_name: result.searchName.split(' ').pop(),
          court_name: warrant.court_name,
          case_id: warrant.case_id,
          charges: warrant.charges,
          issue_date: warrant.issue_date,
          age: result.age,
          city: result.city,
          subject_person_id: result.localPersonMatch?.id || null,
        }),
      });
      setIngestedIds(prev => new Set(prev).add(key));
    } catch {
      // silently fail — user can retry
    } finally {
      setIngestingIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const ingestAll = async (result: PersonIntelResult) => {
    for (const w of result.utahWarrants) {
      if (!ingestedIds.has(w.utah_warrant_id)) await ingestWarrant(result, w);
    }
  };

  const parseCharges = (charges: string | null): string[] => {
    try { return JSON.parse(charges || '[]'); } catch { return charges ? [charges] : []; }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Search bar */}
      <div className="flex flex-wrap gap-2">
        <input
          className="input-dark w-32"
          placeholder="First name"
          value={firstName}
          onChange={e => setFirstName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <input
          className="input-dark w-40"
          placeholder="Last name"
          value={lastName}
          onChange={e => setLastName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <input
          className="input-dark w-32"
          placeholder="DOB (optional)"
          value={dob}
          onChange={e => setDob(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button
          onClick={search}
          disabled={loading || !firstName.trim() || !lastName.trim()}
          className="toolbar-btn-primary px-4"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="ml-1">{loading ? 'Searching...' : 'Search'}</span>
        </button>
      </div>

      {/* API status */}
      <div className="flex items-center gap-2 text-[10px] font-mono text-rmpg-400">
        <span className={`led-dot ${apiAvailable ? 'led-green' : 'led-red'}`} />
        <span>warrants.utah.gov: {apiAvailable ? 'ONLINE' : 'OFFLINE'}</span>
      </div>

      {error && <div className="panel-inset p-3 text-red-400 text-sm">{error}</div>}

      {/* Results */}
      {results !== null && results.length === 0 && (
        <div className="panel-inset p-6 text-center text-rmpg-400 text-sm">
          No results found for {firstName} {lastName}
        </div>
      )}

      {results?.map((r, idx) => {
        const key = r.utahPersonId || r.searchName;
        const isOpen = expanded.has(key);
        const isHighConf = r.identityConfidence === 'high';
        const isLowConf = r.identityConfidence === 'low';

        // Low-confidence results after index 0 collapse behind a reveal button
        if (isLowConf && idx > 0 && !isOpen) {
          return (
            <button key={key} onClick={() => toggleExpand(key)} className="w-full text-left panel-inset p-2 text-[11px] text-rmpg-400 hover:text-white">
              <ChevronRight className="w-3 h-3 inline mr-1" />
              {r.searchName} · {r.identityConfidence} confidence · {r.utahWarrants.length} warrant(s)
            </button>
          );
        }

        return (
          <div key={key} className={`panel-raised rounded-sm border ${isHighConf ? 'border-green-800/30' : 'border-rmpg-700/30'}`}>
            {/* Card header */}
            <button
              onClick={() => toggleExpand(key)}
              className="w-full flex items-center justify-between p-3 hover:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-rmpg-400 shrink-0" />
                <div className="text-left">
                  <div className="font-bold text-white text-sm">{r.searchName}</div>
                  <div className="text-[11px] text-rmpg-400">
                    {[r.age ? `Age ${r.age}` : null, r.city].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${CONFIDENCE_STYLES[r.identityConfidence]}`}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1 bg-rmpg-800 rounded">
                      <div
                        className={`h-full rounded ${r.identityConfidence === 'high' ? 'bg-green-500' : r.identityConfidence === 'medium' ? 'bg-amber-500' : 'bg-rmpg-500'}`}
                        style={{ width: CONFIDENCE_BAR[r.identityConfidence] }}
                      />
                    </div>
                    {r.identityConfidence.toUpperCase()}
                  </div>
                </div>
                {isOpen ? <ChevronDown className="w-4 h-4 text-rmpg-400" /> : <ChevronRight className="w-4 h-4 text-rmpg-400" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-rmpg-700/30 p-3 space-y-4">
                {/* Confidence factors + local person link */}
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-rmpg-400">
                    Match factors: <span className="text-white">{r.confidenceFactors.join(', ')}</span>
                  </div>
                  {r.localPersonMatch && (
                    <button
                      onClick={() => onNavigatePerson?.(r.localPersonMatch!.id)}
                      className="toolbar-btn text-[10px] flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      VIEW PERSON — {r.localPersonMatch.name}
                    </button>
                  )}
                </div>

                {/* Utah Warrants */}
                {r.utahWarrants.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider">
                        Utah Warrants ({r.utahWarrants.length})
                      </div>
                      <button
                        onClick={() => ingestAll(r)}
                        className="toolbar-btn-primary text-[10px] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> INGEST ALL
                      </button>
                    </div>
                    <div className="space-y-2">
                      {r.utahWarrants.map(w => {
                        const charges = parseCharges(w.charges);
                        const isIngesting = ingestingIds.has(w.utah_warrant_id);
                        const isIngested = ingestedIds.has(w.utah_warrant_id);
                        return (
                          <div key={w.utah_warrant_id} className="panel-inset p-2.5 rounded-sm border border-red-900/20">
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 flex-1">
                                <div className="flex flex-wrap gap-1">
                                  {charges.map((c, ci) => (
                                    <span key={ci} className="inline-block bg-red-900/30 text-red-300 text-[10px] px-1.5 py-0.5 rounded border border-red-800/30">{c}</span>
                                  ))}
                                </div>
                                <div className="text-[10px] text-rmpg-400 font-mono space-x-3">
                                  {w.court_name && <span>{w.court_name}</span>}
                                  {w.case_id && <span>Case: {w.case_id}</span>}
                                  {w.issue_date && <span>Issued: {formatDate(w.issue_date)}</span>}
                                  {w.bail_amount != null && <span className="text-amber-400">Bail: ${w.bail_amount.toLocaleString()}</span>}
                                </div>
                              </div>
                              <button
                                onClick={() => ingestWarrant(r, w)}
                                disabled={isIngesting || isIngested}
                                className={`toolbar-btn text-[10px] shrink-0 ${isIngested ? 'text-green-400' : ''}`}
                              >
                                {isIngesting ? <Loader2 className="w-3 h-3 animate-spin" /> : isIngested ? '✓ SAVED' : <><Plus className="w-3 h-3" /> SAVE</>}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Court Records */}
                {r.courtRecords.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider mb-2">
                      Court Records ({r.courtRecords.length})
                    </div>
                    <div className="space-y-2">
                      {r.courtRecords.map((cr, ci) => (
                        <div key={ci} className="panel-inset p-2.5 rounded-sm border border-rmpg-700/20">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10px] text-white">{cr.case_number}</span>
                                <span className="text-[10px] text-rmpg-400">{cr.court_name}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${dispositionStyle(cr.disposition)}`}>
                                  {(cr.disposition || 'UNKNOWN').toUpperCase()}
                                </span>
                              </div>
                              {cr.charges && <div className="text-[10px] text-rmpg-300">{cr.charges}</div>}
                              <div className="text-[10px] text-rmpg-400 font-mono space-x-3">
                                {cr.filing_date && <span>Filed: {formatDate(cr.filing_date)}</span>}
                                {cr.disposition_date && cr.disposition !== 'pending' && <span>Closed: {formatDate(cr.disposition_date)}</span>}
                              </div>
                            </div>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${CONFIDENCE_STYLES[r.identityConfidence]}`}>
                              {r.identityConfidence.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Watch History */}
                {r.watchHistory.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono text-rmpg-300 uppercase tracking-wider mb-1">Watch History</div>
                    {r.watchHistory.map((h, hi) => (
                      <div key={hi} className="text-[10px] text-rmpg-400">
                        {formatDate(h.created_at)} · {h.event} via {h.source || 'scanner'}
                      </div>
                    ))}
                  </div>
                )}

                {r.utahWarrants.length === 0 && r.courtRecords.length === 0 && r.localWarrants.length === 0 && (
                  <div className="text-[11px] text-rmpg-400 text-center py-2">
                    No warrants or court records found for this person
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
