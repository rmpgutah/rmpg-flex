// ============================================================
// RMPG Flex — Criminal History Standalone Page
// Search persons by name/DOB/DL, view caution flags, and display
// chronological criminal history timeline.
// ============================================================

import {useState, useCallback, useEffect} from 'react';
import { Search, AlertTriangle, User, Shield, Calendar, MapPin, FileText, ChevronRight, Scale, List, Clock, Loader2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { toDisplayLabel } from '../utils/formatters';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { formatAddressDisplay } from '../utils/statusLabels';

interface PersonResult {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  date_of_birth?: string;
  sex?: string;
  race?: string;
  drivers_license?: string;
  dl_state?: string;
  caution_flags?: string;
  is_sex_offender?: boolean;
  has_active_warrants?: boolean;
  address?: string;
  phone?: string;
}

interface HistoryEntry {
  id: string;
  type: 'incident' | 'citation' | 'field_interview' | 'warrant' | 'trespass';
  date: string;
  reference_number: string;
  description: string;
  status: string;
  officer_name?: string;
  location?: string;
}

export default function CriminalHistoryPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'name' | 'dob' | 'dl'>('name');
  const [persons, setPersons] = useState<PersonResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setFetchError('');
    try {
      const params = new URLSearchParams({ [searchType]: searchQuery.trim() });
      const data = await apiFetch<any[]>(`/records/persons?${params}`);
      setPersons(data || []);
      setSelectedPerson(null);
      setHistory([]);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
      console.error('Person search error:', err);
      addToast('Failed to search persons', 'error');
      setPersons([]);
    }
    setLoading(false);
  }, [searchQuery, searchType]);

  const selectPerson = useCallback(async (person: PersonResult) => {
    setSelectedPerson(person);
    setHistoryLoading(true);
    try {
      // Fetch all related records for this person
      const [incidents, citations, fis] = await Promise.all([
        apiFetch<any>(`/records/persons/${person.id}/incidents`).catch(() => ({ data: [] })),
        apiFetch<any>(`/citations?q=${encodeURIComponent(`${person.first_name} ${person.last_name}`)}`).catch(() => ({ data: [] })),
        apiFetch<any>(`/field-interviews?search=${encodeURIComponent(`${person.first_name} ${person.last_name}`)}`).catch(() => ({ data: [] })),
      ]);

      const entries: HistoryEntry[] = [];

      // Incidents
      const incData = Array.isArray(incidents) ? incidents : (incidents?.data || []);
      incData.forEach((inc: any) => {
        entries.push({
          id: String(inc.id),
          type: 'incident',
          date: inc.occurred_date || inc.created_at || '',
          reference_number: inc.incident_number || '',
          description: `${inc.incident_type?.replace(/_/g, ' ').toUpperCase()} — ${inc.location_address || 'N/A'}`,
          status: inc.status || '',
          officer_name: inc.officer_name,
          location: inc.location_address,
        });
      });

      // Citations — API returns { data: [...], pagination: {...} }
      const citData = Array.isArray(citations?.data) ? citations.data : Array.isArray(citations) ? citations : [];
      citData.forEach((cit: any) => {
        entries.push({
          id: String(cit.id),
          type: 'citation',
          date: cit.created_at || '',
          reference_number: cit.citation_number || '',
          description: cit.violation_description || 'Citation',
          status: cit.status || '',
          location: cit.location,
        });
      });

      // Field Interviews — API returns { data: [...], pagination: {...} }
      const fiData = Array.isArray(fis?.data) ? fis.data : Array.isArray(fis) ? fis : [];
      fiData.forEach((fi: any) => {
        entries.push({
          id: String(fi.id),
          type: 'field_interview',
          date: fi.created_at || '',
          reference_number: fi.fi_number || `FI-${fi.id}`,
          description: fi.contact_reason || fi.narrative || 'Field Interview',
          status: 'completed',
          location: fi.location,
        });
      });

      entries.sort((a, b) => (new Date(b.date || 0).getTime() || 0) - (new Date(a.date || 0).getTime() || 0));
      setHistory(entries);
    } catch (err) {
      console.error('History fetch error:', err);
      addToast('Failed to load criminal history', 'error');
      setHistory([]);
    }
    setHistoryLoading(false);
  }, []);

  const openUtahCourts = useCallback((person?: PersonResult | null) => {
    const base = 'https://www.utcourts.gov/xchange/CaseSearch';
    const params = new URLSearchParams();
    if (person) {
      if (person.last_name) params.set('lastName', person.last_name);
      if (person.first_name) params.set('firstName', person.first_name);
    }
    const url = params.toString() ? `${base}?${params}` : base;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const cautionFlags = selectedPerson?.caution_flags ? selectedPerson.caution_flags.split(',').map(f => f.trim()).filter(Boolean) : [];

  const typeIcon = (type: string) => {
    switch (type) {
      case 'incident': return <FileText className="w-3 h-3 text-brand-400" />;
      case 'citation': return <Shield className="w-3 h-3 text-amber-400" />;
      case 'field_interview': return <User className="w-3 h-3 text-purple-400" />;
      case 'warrant': return <AlertTriangle className="w-3 h-3 text-red-400" />;
      default: return <FileText className="w-3 h-3 text-rmpg-400" />;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'incident': return 'text-brand-400 bg-brand-900/30 border-brand-700/50';
      case 'citation': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
      case 'field_interview': return 'text-purple-400 bg-purple-900/30 border-purple-700/50';
      case 'warrant': return 'text-red-400 bg-red-900/30 border-red-700/50';
      default: return 'text-rmpg-400 bg-rmpg-700/30 border-rmpg-600/50';
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Criminal History \u2014 RMPG Flex'; }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 text-[10px]" aria-label="Dismiss error">dismiss</button>
        </div>
      )}
      {!isMobile && <PanelTitleBar title="Criminal History" icon={Shield}>
        <div className="flex items-center gap-2">
          <select
            className="select-dark text-[10px] w-24 min-h-[36px]"
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as any)}
          >
            <option value="name">Name</option>
            <option value="dob">DOB</option>
            <option value="dl">DL #</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
            <input
              type="text"
              className="input-dark pl-7 text-[11px] w-64 min-h-[36px]"
              placeholder={searchType === 'name' ? 'Last, First...' : searchType === 'dob' ? 'YYYY-MM-DD...' : 'DL Number...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary print:hidden">
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button type="button" onClick={() => openUtahCourts()} className="toolbar-btn" title="Search Utah Courts Xchange (opens in new tab)">
            <Scale className="w-3 h-3" /> Utah Courts
          </button>
        </div>
      </PanelTitleBar>}

      {/* Mobile search bar */}
      {isMobile && (
        <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: '#050505', borderBottom: '1px solid #2b2b2b' }}>
          <select className="select-dark text-[10px] w-16 min-h-[36px]" value={searchType} onChange={(e) => setSearchType(e.target.value as any)}>
            <option value="name">Name</option>
            <option value="dob">DOB</option>
            <option value="dl">DL #</option>
          </select>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-400" />
            <input
              type="text"
              className="input-dark pl-6 text-[10px] w-full min-h-[36px]"
              placeholder={searchType === 'name' ? 'Last, First...' : searchType === 'dob' ? 'YYYY-MM-DD...' : 'DL Number...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[9px] px-2">
            {loading ? '...' : 'Go'}
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Person Results List */}
        <div className={`${isMobile ? (selectedPerson ? 'hidden' : 'w-full') : 'w-1/3'} border-r border-rmpg-700/50 overflow-auto`}>
          {persons.length === 0 && !loading && (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <Search className="w-7 h-7 mx-auto mb-2 text-rmpg-600" />
                <p className="font-mono uppercase tracking-wider">Search for a person to view criminal history</p>
              </div>
            </div>
          )}
          {persons.map(p => (
            <button type="button"
              key={p.id}
              onClick={() => selectPerson(p)}
              className={`w-full text-left px-3 py-2 border-b border-rmpg-800/30 transition-all duration-150 ${
                selectedPerson?.id === p.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/20 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-white">
                  {p.last_name}, {p.first_name} {p.middle_name || ''}
                </span>
                <ChevronRight className="w-3 h-3 text-rmpg-500" />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-400">
                {p.date_of_birth && <span>DOB: {p.date_of_birth}</span>}
                {p.sex && <span>{p.sex}</span>}
                {p.race && <span>{p.race}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {p.has_active_warrants && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-red-900/50 text-red-400 border border-red-700/50">WARRANTS</span>
                )}
                {p.is_sex_offender && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-red-900/50 text-red-400 border border-red-700/50">SEX OFFENDER</span>
                )}
                {p.caution_flags && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-amber-900/50 text-amber-400 border border-amber-700/50">CAUTION</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Person Detail + History */}
        <div className={`${isMobile ? (selectedPerson ? 'w-full' : 'hidden') : 'flex-1'} overflow-auto`}>
          {selectedPerson ? (
            <div className={`${isMobile ? 'p-3 space-y-3' : 'p-4 space-y-4'}`}>
              {/* Mobile back button */}
              {isMobile && (
                <button type="button" onClick={() => { setSelectedPerson(null); setHistory([]); }}
                  className="text-rmpg-400 hover:text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 rotate-180" /> Back to Results
                </button>
              )}
              {/* Person Card */}
              <div className="panel-surface p-4">
                <div className={`${isMobile ? '' : 'flex items-start justify-between'}`}>
                  <div>
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-black text-white`}>
                      {selectedPerson.last_name}, {selectedPerson.first_name} {selectedPerson.middle_name || ''}
                    </h2>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-rmpg-300 flex-wrap">
                      {selectedPerson.date_of_birth && (
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> DOB: {selectedPerson.date_of_birth}</span>
                      )}
                      {selectedPerson.sex && <span>Sex: {selectedPerson.sex}</span>}
                      {selectedPerson.race && <span>Race: {selectedPerson.race}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-rmpg-400">
                      {selectedPerson.drivers_license && <span>DL: {selectedPerson.drivers_license} ({selectedPerson.dl_state || 'UT'})</span>}
                      {selectedPerson.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedPerson.address}</span>}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold">Record ID</span>
                    <p className="text-sm font-mono text-brand-400 font-bold">{selectedPerson.id}</p>
                    <button type="button"
                      onClick={() => openUtahCourts(selectedPerson)}
                      className="toolbar-btn text-[9px] gap-1"
                      title="Search Utah Courts Xchange for this person"
                    >
                      <Scale className="w-3 h-3" /> Utah Courts
                    </button>
                  </div>
                </div>

                {/* Caution Flags */}
                {cautionFlags.length > 0 && (
                  <div className="mt-3 p-2 bg-red-900/20 border border-red-700/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">Caution Flags</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cautionFlags.map((flag, i) => (
                        <span key={i} className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-red-900/50 text-red-300 border border-red-700/50">
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* History Timeline */}
              <div className="panel-surface p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
                    Criminal History — {history.length} records
                  </h3>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setViewMode('table')}
                      className={`text-[9px] px-2 py-0.5 border ${viewMode === 'table' ? 'bg-brand-900/30 text-brand-300 border-brand-600/50' : 'text-rmpg-500 border-rmpg-700 hover:text-rmpg-300'}`}>
                      <List className="w-3 h-3 inline mr-0.5" />Table
                    </button>
                    <button type="button" onClick={() => setViewMode('timeline')}
                      className={`text-[9px] px-2 py-0.5 border ${viewMode === 'timeline' ? 'bg-brand-900/30 text-brand-300 border-brand-600/50' : 'text-rmpg-500 border-rmpg-700 hover:text-rmpg-300'}`}>
                      <Clock className="w-3 h-3 inline mr-0.5" />Timeline
                    </button>
                  </div>
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                    <span className="text-rmpg-400 text-[10px] font-mono uppercase tracking-wider animate-pulse">Loading history...</span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-6">
                    <Shield className="w-6 h-6 mx-auto mb-2 text-rmpg-600" />
                    <p className="text-rmpg-500 text-[10px] font-mono uppercase tracking-wider">No criminal history on file</p>
                  </div>
                ) : viewMode === 'table' ? (
                  <div className="space-y-1">
                    {history.map((entry) => (
                      <div key={`${entry.type}-${entry.id}`} className="flex items-start gap-3 py-2 border-b border-rmpg-800/30">
                        <div className="mt-0.5">{typeIcon(entry.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${typeColor(entry.type)}`}>
                              {entry.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-rmpg-200">{entry.reference_number}</span>
                            <span className="text-[9px] text-rmpg-500">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</span>
                          </div>
                          <p className="text-[10px] text-rmpg-300 mt-0.5 truncate">{entry.description}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                            {entry.status && <span>Status: {toDisplayLabel(entry.status)}</span>}
                            {entry.officer_name && <span>Officer: {entry.officer_name}</span>}
                            {entry.location && <span><MapPin className="w-2.5 h-2.5 inline" /> {formatAddressDisplay(entry.location)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Visual Timeline View */
                  <div className="relative pl-6">
                    {/* Vertical line */}
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-rmpg-700" />
                    {history.map((entry, idx) => {
                      const isExpanded = expandedEntry === `${entry.type}-${entry.id}`;
                      const dotColor = entry.type === 'incident' ? 'bg-brand-500' : entry.type === 'citation' ? 'bg-amber-500' :
                        entry.type === 'field_interview' ? 'bg-purple-500' : entry.type === 'warrant' ? 'bg-red-500' : 'bg-rmpg-500';
                      return (
                        <div key={`${entry.type}-${entry.id}`} className="relative mb-4">
                          {/* Dot on timeline */}
                          <div className={`absolute -left-[15px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface-base ${dotColor}`} />
                          {/* Date label */}
                          <div className="text-[9px] font-mono text-rmpg-500 mb-0.5">
                            {entry.date ? new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
                          </div>
                          {/* Card */}
                          <button type="button" onClick={() => setExpandedEntry(isExpanded ? null : `${entry.type}-${entry.id}`)}
                            className={`w-full text-left p-2.5 border transition-colors ${isExpanded ? 'bg-rmpg-800/60 border-rmpg-600' : 'bg-surface-sunken border-rmpg-800/50 hover:bg-rmpg-800/30'}`}>
                            <div className="flex items-center gap-2">
                              {typeIcon(entry.type)}
                              <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${typeColor(entry.type)}`}>
                                {entry.type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] font-mono font-bold text-rmpg-200">{entry.reference_number}</span>
                            </div>
                            <p className="text-[10px] text-rmpg-300 mt-1">{entry.description}</p>
                            {isExpanded && (
                              <div className="mt-2 pt-2 border-t border-rmpg-700 space-y-1">
                                {entry.status && <div className="text-[9px] text-rmpg-400">Status: <span className="text-white">{toDisplayLabel(entry.status)}</span></div>}
                                {entry.officer_name && <div className="text-[9px] text-rmpg-400">Officer: <span className="text-white">{entry.officer_name}</span></div>}
                                {entry.location && <div className="text-[9px] text-rmpg-400 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{formatAddressDisplay(entry.location)}</div>}
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <User className="w-10 h-10 mx-auto mb-2 text-rmpg-600" />
                <p>Select a person to view their criminal history</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
