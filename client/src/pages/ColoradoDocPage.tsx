// ============================================================
// RMPG Flex — Colorado DOC Offender Search
// ============================================================
// Search the Colorado Department of Corrections offender
// database by name or DOC number. Results are cached locally
// for 24 hours after initial lookup.
// ============================================================

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, X, User, Building2, Calendar, Hash,
  AlertCircle, ChevronRight, Shield, FileText, Link2, Plus, UserCheck,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';

// ── Types ────────────────────────────────────────────────────

interface CdocOffender {
  doc_number: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  dob: string | null;
  gender: string | null;
  race: string | null;
  facility: string | null;
  status: string | null;
  parole_eligibility: string | null;
  release_date: string | null;
  photo_url: string | null;
  offenses: string | null;
  source: string;
  fetched_at: string;
}

// ── Status badge colors ──────────────────────────────────────

function statusClass(status: string | null): string {
  if (!status) return 'bg-rmpg-800/60 text-rmpg-400 border-rmpg-600/40';
  const s = status.toLowerCase();
  if (s.includes('incarcerat') || s.includes('prison') || s.includes('confined'))
    return 'bg-red-900/60 text-red-300 border-red-600/50';
  if (s.includes('parole') || s.includes('community'))
    return 'bg-amber-900/50 text-amber-400 border-amber-700/50';
  if (s.includes('discharged') || s.includes('released') || s.includes('completed'))
    return 'bg-green-900/50 text-green-400 border-green-700/50';
  if (s.includes('escape') || s.includes('abscond'))
    return 'bg-rose-900/60 text-rose-300 border-rose-600/50';
  return 'bg-gray-900/50 text-gray-400 border-gray-700/50';
}

// ── Main Component ───────────────────────────────────────────

export default function ColoradoDocPage() {
  const navigate = useNavigate();
  // Search state
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [searchMode, setSearchMode] = useState<'name' | 'doc'>('name');

  // Results
  const [results, setResults] = useState<CdocOffender[]>([]);
  const [selected, setSelected] = useState<CdocOffender | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  // Local person matching
  const [localMatch, setLocalMatch] = useState<{ id: number; full_name: string; dob?: string } | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);

  // When an offender is selected, check for local person match
  useEffect(() => {
    if (!selected) { setLocalMatch(null); return; }
    setMatchLoading(true);
    setLocalMatch(null);
    const params = new URLSearchParams({ last_name: selected.last_name });
    if (selected.first_name) params.set('first_name', selected.first_name);
    apiFetch<any[]>(`/records/persons?${params}&limit=5`)
      .then(persons => {
        const match = (persons || []).find((p: any) => {
          const nameMatch = p.last_name?.toLowerCase() === selected.last_name.toLowerCase()
            && p.first_name?.toLowerCase() === selected.first_name.toLowerCase();
          if (!nameMatch) return false;
          if (selected.dob && p.dob) return p.dob === selected.dob;
          return true;
        });
        setLocalMatch(match ? { id: match.id, full_name: match.full_name || `${match.first_name} ${match.last_name}`, dob: match.dob } : null);
      })
      .catch(() => setLocalMatch(null))
      .finally(() => setMatchLoading(false));
  }, [selected]);

  // ── Search by name ───────────────────────────────────────
  const searchByName = useCallback(async () => {
    if (!lastName.trim() || lastName.trim().length < 2) {
      setError('Last name is required (minimum 2 characters)');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    setSelected(null);
    try {
      const params = new URLSearchParams({ lastName: lastName.trim() });
      if (firstName.trim()) params.set('firstName', firstName.trim());
      const resp = await apiFetch<{ data: CdocOffender[]; total: number }>(
        `/colorado-doc/search?${params.toString()}`
      );
      setResults(resp.data || []);
    } catch (err: any) {
      setError(err.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [lastName, firstName]);

  // ── Search by DOC number ─────────────────────────────────
  const searchByDoc = useCallback(async () => {
    if (!docNumber.trim()) {
      setError('DOC number is required');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    setResults([]);
    try {
      const offender = await apiFetch<CdocOffender>(
        `/colorado-doc/offender/${encodeURIComponent(docNumber.trim())}`
      );
      setResults([offender]);
      setSelected(offender);
    } catch (err: any) {
      if (err.message?.includes('404') || err.message?.includes('not found')) {
        setError('No offender found with that DOC number');
      } else {
        setError(err.message || 'Lookup failed');
      }
      setResults([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [docNumber]);

  // ── Submit handler ───────────────────────────────────────
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchMode === 'name') searchByName();
    else searchByDoc();
  };

  // ── Clear ────────────────────────────────────────────────
  const clearSearch = () => {
    setLastName('');
    setFirstName('');
    setDocNumber('');
    setResults([]);
    setSelected(null);
    setError('');
    setSearched(false);
  };

  // ── Parse offenses JSON ──────────────────────────────────
  const parseOffenses = (offenses: string | null): string[] => {
    if (!offenses) return [];
    try {
      const parsed = JSON.parse(offenses);
      if (Array.isArray(parsed)) {
        return parsed.map((o: any) =>
          typeof o === 'string' ? o : (o.description || o.offense || o.charge || JSON.stringify(o))
        );
      }
      return [];
    } catch {
      return [offenses];
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Colorado DOC \u2014 RMPG Flex'; }, []);

  return (
    <div className="app-grid-bg h-full flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────── */}
      <PanelTitleBar
        title="Colorado DOC Offender Search"
        icon={Shield}
        statusLed={loading ? 'amber' : results.length > 0 ? 'green' : 'off'}
        ledPulse={loading}
      >
        <span className="text-[9px] uppercase tracking-wider text-rmpg-500 mr-2">
          Colorado Department of Corrections
        </span>
      </PanelTitleBar>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Search + Results ──────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Search Form */}
          <form onSubmit={handleSearch} className="card-glass m-2 p-3 space-y-2">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 mb-1">
              <button
                type="button"
                onClick={() => setSearchMode('name')}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-colors ${
                  searchMode === 'name'
                    ? 'bg-[#888888]/30 text-gray-300 border border-[#888888]/50'
                    : 'text-rmpg-500 hover:text-rmpg-300 border border-transparent'
                }`}
              >
                Name Search
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('doc')}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-colors ${
                  searchMode === 'doc'
                    ? 'bg-[#888888]/30 text-gray-300 border border-[#888888]/50'
                    : 'text-rmpg-500 hover:text-rmpg-300 border border-transparent'
                }`}
              >
                DOC Number
              </button>
            </div>

            {searchMode === 'name' ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Last Name *"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="flex-1 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2.5 py-1.5 text-xs text-white placeholder:text-rmpg-600 focus:border-[#888888] focus:outline-none"
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="First Name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="flex-1 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2.5 py-1.5 text-xs text-white placeholder:text-rmpg-600 focus:border-[#888888] focus:outline-none"
                />
              </div>
            ) : (
              <input
                type="text"
                placeholder="DOC Number (e.g. 123456)"
                value={docNumber}
                onChange={e => setDocNumber(e.target.value)}
                className="w-full bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm px-2.5 py-1.5 text-xs text-white placeholder:text-rmpg-600 focus:border-[#888888] focus:outline-none font-mono"
                autoFocus
              />
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#888888]/20 border border-[#888888]/40 text-gray-300 text-[10px] uppercase tracking-wider font-bold rounded-sm hover:bg-[#888888]/30 transition-colors disabled:opacity-40"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                Search
              </button>
              {searched && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-rmpg-500 text-[10px] uppercase tracking-wider hover:text-rmpg-300 transition-colors"
                >
                  <X size={12} />
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Error */}
          {error && (
            <div className="mx-2 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-sm flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Results Table */}
          <div className="flex-1 overflow-auto mx-2 mb-2">
            {results.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#141414] border-b border-[#2b2b2b]">
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">DOC #</th>
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Name</th>
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">DOB</th>
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Status</th>
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Facility</th>
                    <th className="text-left px-2.5 py-1.5 text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Gender</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.doc_number}
                      onClick={() => setSelected(r)}
                      className={`cursor-pointer border-b border-[#2b2b2b]/50 transition-colors ${
                        selected?.doc_number === r.doc_number
                          ? 'bg-[#888888]/15 text-white'
                          : 'hover:bg-[#181818] text-rmpg-300'
                      }`}
                    >
                      <td className="px-2.5 py-1.5 font-mono text-gray-400">{r.doc_number}</td>
                      <td className="px-2.5 py-1.5 font-medium">
                        {r.last_name}, {r.first_name}
                        {r.middle_name ? ` ${r.middle_name}` : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-rmpg-400">{r.dob || '--'}</td>
                      <td className="px-2.5 py-1.5">
                        {r.status ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wider font-bold border ${statusClass(r.status)}`}>
                            {(r.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </span>
                        ) : (
                          <span className="text-rmpg-600">--</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-rmpg-400">{r.facility || '--'}</td>
                      <td className="px-2.5 py-1.5 text-rmpg-400">{r.gender || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : searched && !loading && !error ? (
              <div className="flex flex-col items-center justify-center h-full text-rmpg-600">
                <Search size={32} className="mb-2 opacity-30" />
                <p className="text-xs">No results found</p>
              </div>
            ) : !searched ? (
              <div className="flex flex-col items-center justify-center h-full text-rmpg-600">
                <Shield size={32} className="mb-2 opacity-20" />
                <p className="text-xs">Enter a name or DOC number to search</p>
                <p className="text-[10px] mt-1 text-rmpg-700">Colorado Department of Corrections public records</p>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          {results.length > 0 && (
            <div className="mx-2 mb-2 px-2.5 py-1 bg-[#141414] border border-[#2b2b2b] rounded-sm flex items-center justify-between text-[9px] text-rmpg-500">
              <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
              {results[0]?.source && (
                <span className="uppercase tracking-wider">
                  Source: {results[0].source === 'cache' ? 'Local Cache' : 'CDOC API'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Detail Panel ──────────────────────────── */}
        {selected && (
          <div className="w-[380px] border-l border-[#2b2b2b] bg-[#141414] overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-[#2b2b2b] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User size={14} className="text-gray-400" />
                <span className="text-xs font-bold text-white">Offender Detail</span>
              </div>
              <button type="button"
                onClick={() => setSelected(null)}
                className="text-rmpg-500 hover:text-rmpg-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-3 space-y-3">
              {/* Photo */}
              {selected.photo_url && (
                <div className="flex justify-center">
                  <img
                    src={selected.photo_url}
                    alt={`${selected.first_name} ${selected.last_name}`}
                    className="w-24 h-28 object-cover rounded-sm border border-[#2b2b2b]"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              {/* Name */}
              <div className="text-center">
                <h2 className="text-sm font-bold text-white">
                  {selected.last_name}, {selected.first_name}
                  {selected.middle_name ? ` ${selected.middle_name}` : ''}
                </h2>
                <p className="text-[10px] text-rmpg-500 font-mono mt-0.5">
                  DOC# {selected.doc_number}
                </p>
              </div>

              {/* Status Badge */}
              {selected.status && (
                <div className="flex justify-center">
                  <span className={`px-2.5 py-1 rounded-sm text-[10px] uppercase tracking-wider font-bold border ${statusClass(selected.status)}`}>
                    {selected.status}
                  </span>
                </div>
              )}

              {/* Detail Fields */}
              <div className="space-y-1.5">
                <DetailRow icon={Calendar} label="Date of Birth" value={selected.dob} />
                <DetailRow icon={User} label="Gender" value={selected.gender} />
                <DetailRow icon={User} label="Race" value={selected.race} />
                <DetailRow icon={Building2} label="Facility" value={selected.facility} />
                <DetailRow icon={Calendar} label="Parole Eligibility" value={selected.parole_eligibility} />
                <DetailRow icon={Calendar} label="Release Date" value={selected.release_date} />
                <DetailRow icon={Hash} label="Source" value={selected.source === 'cache' ? 'Local Cache' : 'CDOC API'} />
                <DetailRow icon={Calendar} label="Last Fetched" value={selected.fetched_at} />
              </div>

              {/* Offenses */}
              {selected.offenses && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <FileText size={12} className="text-rmpg-500" />
                    <span className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Offenses / Charges</span>
                  </div>
                  <div className="space-y-1">
                    {parseOffenses(selected.offenses).map((offense, i) => (
                      <div
                        key={i}
                        className="px-2 py-1 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm text-[10px] text-rmpg-300 flex items-start gap-1.5"
                      >
                        <ChevronRight size={10} className="text-rmpg-600 mt-0.5 flex-shrink-0" />
                        <span>{offense}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Local Person Match */}
              <div className="border-t border-[#2b2b2b] pt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Link2 size={12} className="text-rmpg-500" />
                  <span className="text-[9px] uppercase tracking-wider text-rmpg-500 font-bold">Local Records Match</span>
                </div>
                {matchLoading ? (
                  <div className="flex items-center gap-2 text-[10px] text-rmpg-400">
                    <Loader2 size={12} className="animate-spin" /> Checking local records...
                  </div>
                ) : localMatch ? (
                  <div className="px-2.5 py-2 bg-green-900/20 border border-green-700/40 rounded-sm">
                    <div className="flex items-center gap-2">
                      <UserCheck size={14} className="text-green-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-green-300 font-bold">Match Found in Local Records</div>
                        <div className="text-[10px] text-green-400/80 mt-0.5">{localMatch.full_name} (Person #{localMatch.id})</div>
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => navigate(`/records?person=${localMatch.id}`)}
                      className="mt-2 w-full text-[10px] py-1.5 bg-green-900/40 text-green-400 border border-green-700/50 hover:bg-green-800/50 transition-colors text-center font-bold uppercase tracking-wider"
                    >
                      View Person Record
                    </button>
                  </div>
                ) : (
                  <div className="px-2.5 py-2 bg-[#0c0c0c] border border-[#2b2b2b] rounded-sm">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={14} className="text-rmpg-500 flex-shrink-0" />
                      <div className="text-[10px] text-rmpg-400">No local match found</div>
                    </div>
                    <button type="button"
                      onClick={() => navigate(`/records?action=new-person&first_name=${encodeURIComponent(selected.first_name)}&last_name=${encodeURIComponent(selected.last_name)}${selected.dob ? `&dob=${encodeURIComponent(selected.dob)}` : ''}`)}
                      className="mt-2 w-full text-[10px] py-1.5 bg-brand-900/30 text-brand-400 border border-brand-700/50 hover:bg-brand-800/40 transition-colors text-center font-bold uppercase tracking-wider flex items-center justify-center gap-1"
                    >
                      <Plus size={10} /> Create Person Record
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail Row Component ───────────────────────────────────

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 px-2 py-1 bg-[#0c0c0c]/60 border border-[#2b2b2b]/50 rounded-sm">
      <Icon size={12} className="text-rmpg-600 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[8px] uppercase tracking-wider text-rmpg-600 font-bold">{label}</div>
        <div className="text-[11px] text-rmpg-300 break-words">{value}</div>
      </div>
    </div>
  );
}
