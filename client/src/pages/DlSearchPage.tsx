// ============================================================
// RMPG Flex — Driver's License Search Page
// Standalone DL search against structured local records +
// live MicroBilt API. Split-panel layout with search form,
// results list, and detailed DL record view.
// ============================================================

import React, { useState, useCallback } from 'react';
import { Search, CreditCard, User, MapPin, ChevronRight, Shield, Calendar, Database, Wifi, Plus } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import ManualDlEntryModal, { type ManualDlFormData } from '../components/ManualDlEntryModal';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

interface DlSubject {
  id?: number;
  first_name: string;
  middle_name?: string;
  last_name: string;
  full_name?: string;
  suffix?: string;
  date_of_birth?: string;
  gender?: string;
  height?: string;
  weight?: string;
  eye_color?: string;
  hair_color?: string;
  race?: string;
  dl_number: string;
  dl_state: string;
  dl_class?: string;
  dl_status?: string;
  dl_expiration?: string;
  dl_issue_date?: string;
  dl_restrictions?: string;
  dl_endorsements?: string;
  addresses?: { address?: string; address2?: string; city?: string; state?: string; postal_code?: string; country?: string }[];
  source?: string;
  match_source?: string;
  match_score?: number;
  fetched_at?: string;
}

interface DlSearchResponse {
  hit: boolean;
  source: string;
  subjects: DlSubject[];
  searchId: number;
  resultCount: number;
}

export default function DlSearchPage() {
  const isMobile = useIsMobile();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [state, setState] = useState('');
  const [dob, setDob] = useState('');
  const [results, setResults] = useState<DlSubject[]>([]);
  const [selected, setSelected] = useState<DlSubject | null>(null);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!lastName.trim() && !dlNumber.trim()) return;
    setLoading(true);
    setSelected(null);
    try {
      const body: any = {};
      if (firstName.trim()) body.firstName = firstName.trim();
      if (lastName.trim()) body.lastName = lastName.trim();
      if (dlNumber.trim()) body.dlNumber = dlNumber.trim();
      if (state) body.state = state;
      if (dob) body.dob = dob;

      const data = await apiFetch<DlSearchResponse>('/microbilt/dl/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResults(data.subjects || []);
      setSource(data.source || 'NONE');
    } catch (err: any) {
      console.error('DL search error:', err);
      setResults([]);
      setSource('ERROR');
    }
    setLoading(false);
  }, [firstName, lastName, dlNumber, state, dob]);

  const handleManualSubmit = useCallback(async (data: ManualDlFormData) => {
    setIsManualSubmitting(true);
    try {
      await apiFetch('/dl-records', { method: 'POST', body: JSON.stringify(data) });
      setShowManualEntry(false);
      // Re-trigger search to show the new record
      if (lastName.trim() || dlNumber.trim()) handleSearch();
    } catch (err: any) {
      console.error('Manual DL save error:', err);
    }
    setIsManualSubmitting(false);
  }, [lastName, dlNumber, handleSearch]);

  const sourceBadge = (src: string) => {
    if (src === 'MICROBILT_API' || src === 'MICROBILT_DL') {
      return <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 inline-flex items-center gap-0.5"><Wifi className="w-2.5 h-2.5" />API</span>;
    }
    return <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-blue-900/50 text-blue-400 border border-blue-700/50 inline-flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />LOCAL</span>;
  };

  const statusBadge = (status: string) => {
    if (!status) return null;
    const s = status.toUpperCase();
    const isValid = s === 'VALID' || s === 'ACTIVE';
    return (
      <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${
        isValid ? 'bg-green-900/50 text-green-400 border-green-700/50' : 'bg-red-900/50 text-red-400 border-red-700/50'
      }`}>{s}</span>
    );
  };

  const formatDate = (d: string | undefined) => {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString();
    } catch { return d; }
  };

  // Desktop search bar
  const searchControls = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input className="input-dark text-[10px] w-28" placeholder="Last Name" value={lastName}
        onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input className="input-dark text-[10px] w-28" placeholder="First Name" value={firstName}
        onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input className="input-dark text-[10px] w-28" placeholder="DL Number" value={dlNumber}
        onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <select className="select-dark text-[10px] w-16" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="">State</option>
        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <input className="input-dark text-[10px] w-28" type="date" placeholder="DOB" value={dob}
        onChange={(e) => setDob(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <button onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[10px]">
        {loading ? 'Searching...' : 'Search'}
      </button>
      <button onClick={() => setShowManualEntry(true)} className="toolbar-btn text-[10px]">
        <Plus className="w-3 h-3" /> Manual Entry
      </button>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {!isMobile && <PanelTitleBar title="DL Search" icon={CreditCard}>{searchControls}</PanelTitleBar>}

      {/* Mobile search bar */}
      {isMobile && (
        <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: '#111', borderBottom: '1px solid #222' }}>
          <div className="flex items-center gap-1.5">
            <input className="input-dark text-[10px] flex-1" placeholder="Last Name" value={lastName}
              onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <input className="input-dark text-[10px] flex-1" placeholder="First Name" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <div className="flex items-center gap-1.5">
            <input className="input-dark text-[10px] flex-1" placeholder="DL Number" value={dlNumber}
              onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <select className="select-dark text-[10px] w-16" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">State</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[9px] px-2">
              {loading ? '...' : 'Go'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Results List */}
        <div className={`${isMobile ? (selected ? 'hidden' : 'w-full') : 'w-1/3'} border-r border-rmpg-700/50 overflow-auto`}>
          {results.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <CreditCard className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                <p>Search by name, DL number, or state</p>
                <p className="text-[9px] text-rmpg-600 mt-1">Searches local records + MicroBilt API</p>
              </div>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-full text-rmpg-400 text-[10px]">
              <div className="text-center">
                <Search className="w-6 h-6 mx-auto mb-2 animate-pulse text-brand-400" />
                <p>Searching...</p>
              </div>
            </div>
          )}
          {!loading && results.map((r, idx) => (
            <button
              key={`${r.dl_number}-${r.dl_state}-${idx}`}
              onClick={() => setSelected(r)}
              className={`w-full text-left px-3 py-2 border-b border-rmpg-800/30 hover:bg-rmpg-800/20 transition-colors ${
                selected?.dl_number === r.dl_number && selected?.dl_state === r.dl_state ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-white">
                  {r.last_name}, {r.first_name} {r.middle_name || ''}
                </span>
                <ChevronRight className="w-3 h-3 text-rmpg-500" />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-400">
                <span>DL: {r.dl_number || '—'}</span>
                <span>{r.dl_state || ''}</span>
                {r.date_of_birth && <span>DOB: {r.date_of_birth}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {statusBadge(r.dl_status || '')}
                {sourceBadge(r.source || source)}
              </div>
            </button>
          ))}
          {!loading && results.length > 0 && (
            <div className="text-center text-[9px] text-rmpg-500 py-2 border-t border-rmpg-800/30">
              {results.length} result{results.length !== 1 ? 's' : ''} — Source: {source}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className={`${isMobile ? (selected ? 'w-full' : 'hidden') : 'flex-1'} overflow-auto`}>
          {selected ? (
            <div className={`${isMobile ? 'p-3 space-y-3' : 'p-4 space-y-4'}`}>
              {/* Mobile back button */}
              {isMobile && (
                <button onClick={() => setSelected(null)}
                  className="text-rmpg-400 hover:text-white text-[10px] font-bold uppercase tracking-wider">
                  ◀ Back to Results
                </button>
              )}

              {/* DL Card */}
              <div className="panel-surface p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-black text-white`}>
                      {selected.last_name}, {selected.first_name} {selected.middle_name || ''} {selected.suffix || ''}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      {statusBadge(selected.dl_status || '')}
                      {sourceBadge(selected.source || source)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold">DL Number</span>
                    <p className="text-sm font-mono text-brand-400 font-bold">{selected.dl_number || '—'}</p>
                    <p className="text-[9px] text-rmpg-400">{selected.dl_state || ''}</p>
                  </div>
                </div>

                {/* DL Information */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 p-3 bg-rmpg-800/20 border border-rmpg-700/30">
                  <div>
                    <span className="field-label">Class</span>
                    <p className="text-[11px] font-bold text-white">{selected.dl_class || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Status</span>
                    <p className="text-[11px] font-bold text-white">{selected.dl_status || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Expiration</span>
                    <p className="text-[11px] font-bold text-white">{formatDate(selected.dl_expiration)}</p>
                  </div>
                  <div>
                    <span className="field-label">Issue Date</span>
                    <p className="text-[11px] font-bold text-white">{formatDate(selected.dl_issue_date)}</p>
                  </div>
                  {selected.dl_restrictions && (
                    <div className="col-span-2">
                      <span className="field-label">Restrictions</span>
                      <p className="text-[11px] font-bold text-white">{selected.dl_restrictions}</p>
                    </div>
                  )}
                  {selected.dl_endorsements && (
                    <div className="col-span-2">
                      <span className="field-label">Endorsements</span>
                      <p className="text-[11px] font-bold text-white">{selected.dl_endorsements}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Subject Information */}
              <div className="panel-surface p-4">
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <User className="w-3 h-3" /> Subject Information
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="field-label">Date of Birth</span>
                    <p className="text-[11px] font-bold text-white flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-rmpg-400" /> {formatDate(selected.date_of_birth)}
                    </p>
                  </div>
                  <div>
                    <span className="field-label">Gender</span>
                    <p className="text-[11px] font-bold text-white">{selected.gender || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Height</span>
                    <p className="text-[11px] font-bold text-white">{selected.height || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Weight</span>
                    <p className="text-[11px] font-bold text-white">{selected.weight || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Eye Color</span>
                    <p className="text-[11px] font-bold text-white">{selected.eye_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Hair Color</span>
                    <p className="text-[11px] font-bold text-white">{selected.hair_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Race</span>
                    <p className="text-[11px] font-bold text-white">{selected.race || '—'}</p>
                  </div>
                  {selected.fetched_at && (
                    <div>
                      <span className="field-label">Last Updated</span>
                      <p className="text-[11px] font-bold text-rmpg-300">{formatDate(selected.fetched_at)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Addresses */}
              {selected.addresses && selected.addresses.length > 0 && (
                <div className="panel-surface p-4">
                  <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" /> Addresses — {selected.addresses.length}
                  </h3>
                  <div className="space-y-2">
                    {selected.addresses.map((addr, i) => (
                      <div key={i} className="p-2 bg-rmpg-800/20 border border-rmpg-700/30">
                        <p className="text-[11px] text-white font-bold">{addr.address || '—'}</p>
                        {addr.address2 && <p className="text-[10px] text-rmpg-300">{addr.address2}</p>}
                        <p className="text-[10px] text-rmpg-300">
                          {[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}
                          {addr.country && addr.country !== 'US' ? ` ${addr.country}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <Shield className="w-10 h-10 mx-auto mb-2 text-rmpg-600" />
                <p>Select a record to view DL details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ManualDlEntryModal
        isOpen={showManualEntry}
        onClose={() => setShowManualEntry(false)}
        onSubmit={handleManualSubmit}
        isSubmitting={isManualSubmitting}
      />
    </div>
  );
}
