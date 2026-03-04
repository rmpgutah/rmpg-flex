import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, ExternalLink, AlertTriangle, Shield, User,
  MapPin, Calendar, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SearchBugStatus {
  configured: boolean;
  has_account_number: boolean;
  has_api_key: boolean;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  balance?: string;
  rate?: string;
}

interface CrimeRecord {
  source_state: string;
  case_number: string;
  crime_type: string;
  case_type: string;
  offense_code: string;
  offense_description: string;
  offense_description_2: string;
  disposition: string;
  disposition_date: string;
  offense_date: string;
  charges_filed_date: string;
  court: string;
  county: string;
  sentence: string;
  probation: string;
  fines: string;
  plea: string;
  arresting_agency: string;
  warrant: string;
  warrant_date: string;
}

interface CriminalResult {
  name: { first: string; middle: string; last: string; suffix: string };
  dob: string;
  age: string;
  gender: string;
  race: string;
  hair: string;
  eyes: string;
  height: string;
  weight: string;
  scars_marks: string;
  is_sex_offender: string;
  address: { line1: string; city: string; county: string; state: string; zip: string };
  crimes: CrimeRecord[];
}

export default function AdminSearchBugTab({ LoadingSpinner, setError }: Props) {
  const [status, setStatus] = useState<SearchBugStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountNumber, setAccountNumber] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search state
  const [searchFirstName, setSearchFirstName] = useState('');
  const [searchLastName, setSearchLastName] = useState('');
  const [searchCity, setSearchCity] = useState('');
  const [searchState, setSearchState] = useState('');
  const [searchDob, setSearchDob] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CriminalResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SearchBugStatus>('/searchbug/status');
      setStatus(data);
    } catch { setError('Failed to load SearchBug status'); }
    finally { setLoading(false); }
  }, [setError]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/searchbug/credentials', {
        method: 'PUT',
        body: JSON.stringify({ account_number: accountNumber, api_key: apiKey }),
      });
      setAccountNumber('');
      setApiKey('');
      await fetchStatus();
    } catch (err: any) { setError(err.message || 'Failed to save credentials'); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/searchbug/test', { method: 'POST' });
      setTestResult(result);
    } catch (err: any) { setTestResult({ success: false, error: err.message }); }
    finally { setTesting(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch('/searchbug/credentials', { method: 'DELETE' });
      setTestResult(null);
      await fetchStatus();
    } catch (err: any) { setError(err.message || 'Failed to remove credentials'); }
    finally { setDeleting(false); }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchLastName.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults(null);
    setExpandedIdx(null);
    try {
      const data = await apiFetch<{ found: boolean; count: number; criminals: CriminalResult[] }>('/searchbug/criminal-search', {
        method: 'POST',
        body: JSON.stringify({
          first_name: searchFirstName.trim(),
          last_name: searchLastName.trim(),
          city: searchCity.trim(),
          state: searchState.trim(),
          dob: searchDob.trim(),
        }),
      });
      setSearchResults(data.criminals || []);
    } catch (err: any) {
      setSearchError(err.message || 'Search failed');
    } finally { setSearching(false); }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-brand-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">SearchBug Criminal Records</h2>
            <p className="text-[10px] text-rmpg-400 mt-0.5">200M+ federal, state & county records — $1.75/search</p>
          </div>
        </div>
        <a
          href="https://www.searchbug.com/api/criminal-background-check.aspx"
          target="_blank"
          rel="noopener noreferrer"
          className="toolbar-btn text-[10px] gap-1"
        >
          <ExternalLink className="w-3 h-3" /> API Docs
        </a>
      </div>

      {/* Credentials Card */}
      <div className="border border-rmpg-600 p-4 space-y-4" style={{ background: '#1a1a1a' }}>
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">API Credentials</span>
          {status?.configured ? (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-rmpg-400">
              <XCircle className="w-3 h-3" /> Not configured
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Account Number (CO_CODE)</label>
            <input
              type="text"
              className="input-dark"
              placeholder={status?.has_account_number ? '••••••••' : 'e.g. 12345678'}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">API Key (PASS)</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                className="input-dark pr-8"
                placeholder={status?.has_api_key ? '••••••••••••••••' : 'Your API key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white"
              >
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving || (!accountNumber && !apiKey)} className="toolbar-btn toolbar-btn-primary text-[10px]">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
          {status?.configured && (
            <>
              <button onClick={handleTest} disabled={testing} className="toolbar-btn text-[10px]">
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleDelete} disabled={deleting} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Remove
              </button>
            </>
          )}
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 p-2 text-xs ${testResult.success ? 'bg-green-900/30 border border-green-700/30 text-green-400' : 'bg-red-900/30 border border-red-700/30 text-red-400'}`}>
            {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {testResult.message || testResult.error}
          </div>
        )}
      </div>

      {/* Criminal Records Search */}
      {status?.configured && (
        <div className="border border-rmpg-600 p-4 space-y-4" style={{ background: '#1a1a1a' }}>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Criminal Records Search</span>
          </div>

          <form onSubmit={handleSearch} className="space-y-3">
            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">First Name</label>
                <input type="text" className="input-dark" placeholder="David" value={searchFirstName} onChange={(e) => setSearchFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Last Name *</label>
                <input type="text" className="input-dark" placeholder="Baker" value={searchLastName} onChange={(e) => setSearchLastName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">City</label>
                <input type="text" className="input-dark" placeholder="Miami" value={searchCity} onChange={(e) => setSearchCity(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">State</label>
                <input type="text" className="input-dark" placeholder="FL" maxLength={2} value={searchState} onChange={(e) => setSearchState(e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">DOB</label>
                <input type="text" className="input-dark" placeholder="MM/DD/YYYY" value={searchDob} onChange={(e) => setSearchDob(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={searching || !searchLastName.trim()} className="toolbar-btn toolbar-btn-primary text-[10px]">
                {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {searching ? 'Searching...' : 'Search Criminal Records'}
              </button>
              <span className="text-[9px] text-rmpg-500">Each search costs ~$1.75. No charge if no results found.</span>
            </div>
          </form>

          {searchError && (
            <div className="flex items-center gap-2 p-2 text-xs bg-red-900/30 border border-red-700/30 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" /> {searchError}
            </div>
          )}

          {/* Results */}
          {searchResults !== null && (
            <div className="space-y-3">
              <div className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold">
                {searchResults.length === 0 ? 'No criminal records found' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} found`}
              </div>

              {searchResults.map((result, idx) => (
                <div key={idx} className="border border-rmpg-600 bg-surface-base">
                  {/* Suspect header */}
                  <button
                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/50 transition-colors text-left"
                  >
                    <User className="w-4 h-4 text-brand-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-white">
                        {result.name.first} {result.name.middle ? `${result.name.middle} ` : ''}{result.name.last}
                        {result.name.suffix ? ` ${result.name.suffix}` : ''}
                      </span>
                      <span className="text-[10px] text-rmpg-400 ml-2">
                        {result.dob ? `DOB: ${result.dob}` : ''} {result.age ? `(Age ${result.age})` : ''}
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 ${result.is_sex_offender === 'Yes' ? 'bg-red-900/50 text-red-400 border border-red-700/50' : ''}`}>
                      {result.crimes.length} offense{result.crimes.length !== 1 ? 's' : ''}
                    </span>
                    {expandedIdx === idx ? <ChevronUp className="w-3 h-3 text-rmpg-400" /> : <ChevronDown className="w-3 h-3 text-rmpg-400" />}
                  </button>

                  {/* Expanded details */}
                  {expandedIdx === idx && (
                    <div className="px-3 pb-3 space-y-3 border-t border-rmpg-700">
                      {/* Physical description */}
                      <div className="grid grid-cols-6 gap-2 pt-2">
                        {result.gender && <Detail label="Gender" value={result.gender} />}
                        {result.race && <Detail label="Race" value={result.race} />}
                        {result.hair && <Detail label="Hair" value={result.hair} />}
                        {result.eyes && <Detail label="Eyes" value={result.eyes} />}
                        {result.height && <Detail label="Height" value={result.height} />}
                        {result.weight && <Detail label="Weight" value={result.weight} />}
                      </div>

                      {result.scars_marks && (
                        <Detail label="Scars / Marks" value={result.scars_marks} />
                      )}

                      {result.is_sex_offender === 'Yes' && (
                        <div className="flex items-center gap-2 p-2 bg-red-900/30 border border-red-700/30 text-red-400 text-xs font-bold">
                          <AlertTriangle className="w-3.5 h-3.5" /> REGISTERED SEX OFFENDER
                        </div>
                      )}

                      {result.address.line1 && (
                        <div className="flex items-center gap-2 text-[10px] text-rmpg-300">
                          <MapPin className="w-3 h-3 text-rmpg-400" />
                          {result.address.line1}, {result.address.city}, {result.address.state} {result.address.zip}
                          {result.address.county ? ` (${result.address.county} Co.)` : ''}
                        </div>
                      )}

                      {/* Crime records */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Criminal History</span>
                        {result.crimes.map((crime, cIdx) => (
                          <div key={cIdx} className="border border-rmpg-700 p-2 space-y-1" style={{ background: '#161616' }}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">{crime.offense_description || 'Unknown Offense'}</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 uppercase ${
                                crime.crime_type?.toLowerCase().includes('felony') ? 'bg-red-900/50 text-red-400 border border-red-700/50' :
                                crime.crime_type?.toLowerCase().includes('misdemeanor') ? 'bg-amber-900/50 text-amber-400 border border-amber-700/50' :
                                'bg-rmpg-700 text-rmpg-300 border border-rmpg-600'
                              }`}>
                                {crime.crime_type || crime.case_type || 'N/A'}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {crime.offense_date && <Detail label="Offense Date" value={crime.offense_date} icon={Calendar} />}
                              {crime.disposition && <Detail label="Disposition" value={crime.disposition} icon={FileText} />}
                              {crime.disposition_date && <Detail label="Disp. Date" value={crime.disposition_date} />}
                              {crime.court && <Detail label="Court" value={crime.court} />}
                              {crime.county && <Detail label="County" value={crime.county} />}
                              {crime.case_number && <Detail label="Case #" value={crime.case_number} />}
                              {crime.source_state && <Detail label="State" value={crime.source_state} />}
                              {crime.sentence && <Detail label="Sentence" value={crime.sentence} />}
                              {crime.probation && <Detail label="Probation" value={crime.probation} />}
                              {crime.fines && <Detail label="Fines" value={crime.fines} />}
                              {crime.plea && <Detail label="Plea" value={crime.plea} />}
                              {crime.arresting_agency && <Detail label="Agency" value={crime.arresting_agency} />}
                            </div>
                            {crime.warrant && (
                              <div className="flex items-center gap-1 text-[10px] text-red-400 font-bold mt-1">
                                <AlertTriangle className="w-3 h-3" /> WARRANT: {crime.warrant} {crime.warrant_date ? `(${crime.warrant_date})` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ElementType }) {
  return (
    <div className="text-[10px]">
      <span className="text-rmpg-400 uppercase font-semibold">{label}: </span>
      <span className="text-rmpg-200 flex items-center gap-1 inline">
        {Icon && <Icon className="w-2.5 h-2.5 inline text-rmpg-400" />}
        {value}
      </span>
    </div>
  );
}
