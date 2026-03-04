import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, ExternalLink, AlertTriangle, Shield, User,
  MapPin, Calendar, FileText, ChevronDown, ChevronUp,
  Phone, Mail, Home, Users, Building2, Scale,
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

// ---------- Criminal types ----------
interface CrimeRecord {
  source_state: string; case_number: string; crime_type: string; case_type: string;
  offense_code: string; offense_description: string; offense_description_2: string;
  disposition: string; disposition_date: string; offense_date: string;
  charges_filed_date: string; court: string; county: string; sentence: string;
  probation: string; fines: string; plea: string; arresting_agency: string;
  warrant: string; warrant_date: string;
}
interface CriminalResult {
  name: { first: string; middle: string; last: string; suffix: string };
  dob: string; age: string; gender: string; race: string; hair: string;
  eyes: string; height: string; weight: string; scars_marks: string;
  is_sex_offender: string; report_token: string;
  address: { line1: string; city: string; county: string; state: string; zip: string };
  crimes: CrimeRecord[];
}

// ---------- People types ----------
interface PersonResult {
  report_token: string;
  name: { first: string; middle: string; last: string; suffix: string };
  aliases: string[]; dob: string; age: string;
  is_deceased: string; dod: string;
  addresses: { line1: string; city: string; state: string; zip: string; county: string; type: string; first_seen: string; last_seen: string }[];
  phones: { number: string; type: string; carrier: string; is_connected: string }[];
  emails: string[];
  relatives: { name: string; relationship: string; dob: string; report_token: string }[];
  bankruptcies: any[]; liens: any[]; judgments: any[];
}

// ---------- Property types ----------
interface PropertyResult {
  owner_name: string; owner_name_2: string;
  mailing_address: { line1: string; city: string; state: string; zip: string };
  property_address: { line1: string; city: string; state: string; zip: string };
  property_type: string; bedrooms: string; bathrooms: string; sqft: string;
  lot_size: string; year_built: string; assessed_value: string; market_value: string;
  last_sale_date: string; last_sale_price: string; tax_amount: string;
  zoning: string; apn: string; legal_description: string;
  elevation: string; usps_classification: string;
}

type SearchMode = 'criminal' | 'people' | 'property';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export default function AdminSearchBugTab({ LoadingSpinner, setError }: Props) {
  // --- Config state ---
  const [status, setStatus] = useState<SearchBugStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountNumber, setAccountNumber] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deleting, setDeleting] = useState(false);

  // --- Search mode ---
  const [searchMode, setSearchMode] = useState<SearchMode>('criminal');

  // --- Criminal search state ---
  const [crimFirstName, setCrimFirstName] = useState('');
  const [crimLastName, setCrimLastName] = useState('');
  const [crimCity, setCrimCity] = useState('');
  const [crimState, setCrimState] = useState('');
  const [crimDob, setCrimDob] = useState('');

  // --- People search state ---
  const [pplFirstName, setPplFirstName] = useState('');
  const [pplMiddleName, setPplMiddleName] = useState('');
  const [pplLastName, setPplLastName] = useState('');
  const [pplAddress, setPplAddress] = useState('');
  const [pplCity, setPplCity] = useState('');
  const [pplState, setPplState] = useState('');
  const [pplZip, setPplZip] = useState('');
  const [pplPhone, setPplPhone] = useState('');
  const [pplEmail, setPplEmail] = useState('');
  const [pplDob, setPplDob] = useState('');

  // --- Property search state ---
  const [propAddress, setPropAddress] = useState('');
  const [propCity, setPropCity] = useState('');
  const [propState, setPropState] = useState('');
  const [propZip, setPropZip] = useState('');

  // --- Results ---
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [criminalResults, setCriminalResults] = useState<{ criminals: CriminalResult[]; total_found: number; capped: boolean } | null>(null);
  const [peopleResults, setPeopleResults] = useState<{ people: PersonResult[]; total_found: number; capped: boolean } | null>(null);
  const [propertyResult, setPropertyResult] = useState<PropertyResult | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SearchBugStatus>('/searchbug/status');
      setStatus(data);
    } catch { setError('Failed to load NCIC status'); }
    finally { setLoading(false); }
  }, [setError]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // --- Config handlers ---
  const handleSave = async () => {
    setSaving(true); setTestResult(null);
    try {
      await apiFetch('/searchbug/credentials', { method: 'PUT', body: JSON.stringify({ account_number: accountNumber, api_key: apiKey }) });
      setAccountNumber(''); setApiKey(''); await fetchStatus();
    } catch (err: any) { setError(err.message || 'Failed to save credentials'); }
    finally { setSaving(false); }
  };
  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await apiFetch<TestResult>('/searchbug/test', { method: 'POST' })); }
    catch (err: any) { setTestResult({ success: false, error: err.message }); }
    finally { setTesting(false); }
  };
  const handleDelete = async () => {
    setDeleting(true);
    try { await apiFetch('/searchbug/credentials', { method: 'DELETE' }); setTestResult(null); await fetchStatus(); }
    catch (err: any) { setError(err.message || 'Failed to remove credentials'); }
    finally { setDeleting(false); }
  };

  // --- Search handlers ---
  const clearResults = () => {
    setCriminalResults(null); setPeopleResults(null); setPropertyResult(null);
    setSearchError(null); setExpandedIdx(null);
  };

  const handleCriminalSearch = async (e: React.FormEvent) => {
    e.preventDefault(); clearResults(); setSearching(true);
    try {
      const data = await apiFetch<{ found: boolean; count: number; total_found: number; capped: boolean; criminals: CriminalResult[] }>('/searchbug/criminal-search', {
        method: 'POST',
        body: JSON.stringify({ first_name: crimFirstName.trim(), last_name: crimLastName.trim(), city: crimCity.trim(), state: crimState.trim(), dob: crimDob.trim() }),
      });
      setCriminalResults({ criminals: data.criminals || [], total_found: data.total_found || 0, capped: !!data.capped });
    } catch (err: any) { setSearchError(err.message || 'Criminal search failed'); }
    finally { setSearching(false); }
  };

  const handlePeopleSearch = async (e: React.FormEvent) => {
    e.preventDefault(); clearResults(); setSearching(true);
    try {
      const data = await apiFetch<{ found: boolean; count: number; total_found: number; capped: boolean; people: PersonResult[] }>('/searchbug/people-search', {
        method: 'POST',
        body: JSON.stringify({
          first_name: pplFirstName.trim(), middle_name: pplMiddleName.trim(), last_name: pplLastName.trim(),
          address: pplAddress.trim(), city: pplCity.trim(), state: pplState.trim(), zip: pplZip.trim(),
          phone: pplPhone.trim(), email: pplEmail.trim(), dob: pplDob.trim(),
        }),
      });
      setPeopleResults({ people: data.people || [], total_found: data.total_found || 0, capped: !!data.capped });
    } catch (err: any) { setSearchError(err.message || 'People search failed'); }
    finally { setSearching(false); }
  };

  const handlePropertySearch = async (e: React.FormEvent) => {
    e.preventDefault(); clearResults(); setSearching(true);
    try {
      const data = await apiFetch<{ found: boolean; property: PropertyResult | null }>('/searchbug/property-search', {
        method: 'POST',
        body: JSON.stringify({ address: propAddress.trim(), city: propCity.trim(), state: propState.trim(), zip: propZip.trim() }),
      });
      setPropertyResult(data.property || null);
    } catch (err: any) { setSearchError(err.message || 'Property search failed'); }
    finally { setSearching(false); }
  };

  // --- Validation ---
  const criminalValid = crimFirstName.trim() && crimLastName.trim() && crimState.trim();
  const peopleValid = (pplFirstName.trim() && pplLastName.trim()) || pplPhone.trim() || pplEmail.trim() || (pplAddress.trim() && pplCity.trim() && pplState.trim());
  const propertyValid = propAddress.trim() && propCity.trim() && propState.trim();

  if (loading) return <LoadingSpinner />;

  const searchModes: { id: SearchMode; label: string; icon: React.ElementType; cost: string }[] = [
    { id: 'criminal', label: 'Criminal Records', icon: Shield, cost: '$1.75' },
    { id: 'people', label: 'People Search', icon: Users, cost: '$0.33-$0.79' },
    { id: 'property', label: 'Property Records', icon: Building2, cost: '$0.20-$0.50' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-brand-400" />
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">NCIC Searches</h2>
            <p className="text-[10px] text-rmpg-400 mt-0.5">Criminal records, people search & property lookups via SearchBug API</p>
          </div>
        </div>
        <a href="https://www.searchbug.com/info/api/api-guide/" target="_blank" rel="noopener noreferrer" className="toolbar-btn text-[10px] gap-1">
          <ExternalLink className="w-3 h-3" /> API Docs
        </a>
      </div>

      {/* Credentials Card */}
      <div className="border border-rmpg-600 p-4 space-y-4" style={{ background: '#1a1a1a' }}>
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">API Credentials</span>
          {status?.configured ? (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400"><CheckCircle2 className="w-3 h-3" /> Connected</span>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-rmpg-400"><XCircle className="w-3 h-3" /> Not configured</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Account Number (CO_CODE)</label>
            <input type="text" className="input-dark" placeholder={status?.has_account_number ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'e.g. 12345678'} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">API Key (PASS)</label>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} className="input-dark pr-8" placeholder={status?.has_api_key ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Your API key'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white">
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

      {/* Search Section */}
      {status?.configured && (
        <div className="border border-rmpg-600 p-4 space-y-4" style={{ background: '#1a1a1a' }}>
          {/* Search Mode Tabs */}
          <div className="flex items-center gap-1 border-b border-rmpg-700 pb-2">
            {searchModes.map(({ id, label, icon: Icon, cost }) => (
              <button
                key={id}
                onClick={() => { setSearchMode(id); clearResults(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: searchMode === id ? '#ffffff' : '#666666',
                  background: searchMode === id ? 'rgba(188, 16, 16, 0.15)' : 'transparent',
                  borderBottom: searchMode === id ? '2px solid #bc1010' : '2px solid transparent',
                }}
              >
                <Icon className="w-3 h-3" style={{ color: searchMode === id ? '#bc1010' : '#555555' }} />
                {label}
                <span className="text-[8px] font-normal ml-0.5" style={{ color: '#555555' }}>{cost}</span>
              </button>
            ))}
          </div>

          {/* Criminal Records Form */}
          {searchMode === 'criminal' && (
            <form onSubmit={handleCriminalSearch} className="space-y-3">
              <div className="flex items-center gap-2 p-2 bg-amber-900/20 border border-amber-700/30 text-amber-400 text-[10px]">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>First Name, Last Name, and State are <strong>required</strong> to narrow results and conserve search credits. Add DOB for best accuracy.</span>
              </div>
              <div className="grid grid-cols-5 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">First Name *</label>
                  <input type="text" className="input-dark" placeholder="David" value={crimFirstName} onChange={(e) => setCrimFirstName(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Last Name *</label>
                  <input type="text" className="input-dark" placeholder="Baker" value={crimLastName} onChange={(e) => setCrimLastName(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">City</label>
                  <input type="text" className="input-dark" placeholder="Miami" value={crimCity} onChange={(e) => setCrimCity(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">State *</label>
                  <select className="input-dark" value={crimState} onChange={(e) => setCrimState(e.target.value)} required>
                    <option value="">Select...</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">DOB</label>
                  <input type="text" className="input-dark" placeholder="MM/DD/YYYY" value={crimDob} onChange={(e) => setCrimDob(e.target.value)} />
                </div>
              </div>
              <SearchButton searching={searching} disabled={!criminalValid} label="Search Criminal Records" cost="~$1.75/hit" />
            </form>
          )}

          {/* People Search Form */}
          {searchMode === 'people' && (
            <form onSubmit={handlePeopleSearch} className="space-y-3">
              <div className="flex items-center gap-2 p-2 bg-blue-900/20 border border-blue-700/30 text-blue-400 text-[10px]">
                <Search className="w-3 h-3 flex-shrink-0" />
                <span>Search by <strong>Name</strong>, <strong>Phone</strong>, <strong>Email</strong>, or <strong>Address</strong>. Provide as much detail as possible for best results.</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">First Name</label>
                  <input type="text" className="input-dark" placeholder="James" value={pplFirstName} onChange={(e) => setPplFirstName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Middle Name</label>
                  <input type="text" className="input-dark" placeholder="A" value={pplMiddleName} onChange={(e) => setPplMiddleName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Last Name</label>
                  <input type="text" className="input-dark" placeholder="Baker" value={pplLastName} onChange={(e) => setPplLastName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">DOB</label>
                  <input type="text" className="input-dark" placeholder="MM/DD/YYYY" value={pplDob} onChange={(e) => setPplDob(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-5 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1"><Phone className="w-2.5 h-2.5 inline mr-0.5" />Phone</label>
                  <input type="text" className="input-dark" placeholder="212-773-1234" value={pplPhone} onChange={(e) => setPplPhone(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1"><Mail className="w-2.5 h-2.5 inline mr-0.5" />Email</label>
                  <input type="text" className="input-dark" placeholder="user@example.com" value={pplEmail} onChange={(e) => setPplEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1"><Home className="w-2.5 h-2.5 inline mr-0.5" />Address</label>
                  <input type="text" className="input-dark" placeholder="200 E 69th St" value={pplAddress} onChange={(e) => setPplAddress(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">City</label>
                  <input type="text" className="input-dark" placeholder="Miami" value={pplCity} onChange={(e) => setPplCity(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">State</label>
                    <select className="input-dark" value={pplState} onChange={(e) => setPplState(e.target.value)}>
                      <option value="">--</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Zip</label>
                    <input type="text" className="input-dark" placeholder="33101" maxLength={5} value={pplZip} onChange={(e) => setPplZip(e.target.value)} />
                  </div>
                </div>
              </div>
              <SearchButton searching={searching} disabled={!peopleValid} label="Search People" cost="~$0.33-$0.79/hit" />
            </form>
          )}

          {/* Property Search Form */}
          {searchMode === 'property' && (
            <form onSubmit={handlePropertySearch} className="space-y-3">
              <div className="flex items-center gap-2 p-2 bg-emerald-900/20 border border-emerald-700/30 text-emerald-400 text-[10px]">
                <Building2 className="w-3 h-3 flex-shrink-0" />
                <span>Look up property ownership, value, and details. <strong>Address, City, and State</strong> are required.</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Street Address *</label>
                  <input type="text" className="input-dark" placeholder="200 E 69th St" value={propAddress} onChange={(e) => setPropAddress(e.target.value)} required />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">City *</label>
                  <input type="text" className="input-dark" placeholder="New York" value={propCity} onChange={(e) => setPropCity(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">State *</label>
                    <select className="input-dark" value={propState} onChange={(e) => setPropState(e.target.value)} required>
                      <option value="">--</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-rmpg-300 uppercase mb-1">Zip</label>
                    <input type="text" className="input-dark" placeholder="10021" maxLength={5} value={propZip} onChange={(e) => setPropZip(e.target.value)} />
                  </div>
                </div>
              </div>
              <SearchButton searching={searching} disabled={!propertyValid} label="Search Property Records" cost="~$0.20-$0.50/hit" />
            </form>
          )}

          {/* Error */}
          {searchError && (
            <div className="flex items-center gap-2 p-2 text-xs bg-red-900/30 border border-red-700/30 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" /> {searchError}
            </div>
          )}

          {/* Criminal Results */}
          {criminalResults && (
            <div className="space-y-3">
              <ResultHeader count={criminalResults.criminals.length} totalFound={criminalResults.total_found} capped={criminalResults.capped} type="criminal record" />
              {criminalResults.criminals.map((result, idx) => (
                <CriminalCard key={idx} result={result} idx={idx} expandedIdx={expandedIdx} setExpandedIdx={setExpandedIdx} />
              ))}
            </div>
          )}

          {/* People Results */}
          {peopleResults && (
            <div className="space-y-3">
              <ResultHeader count={peopleResults.people.length} totalFound={peopleResults.total_found} capped={peopleResults.capped} type="person" />
              {peopleResults.people.map((person, idx) => (
                <PersonCard key={idx} person={person} idx={idx} expandedIdx={expandedIdx} setExpandedIdx={setExpandedIdx} />
              ))}
            </div>
          )}

          {/* Property Result */}
          {propertyResult !== undefined && searchMode === 'property' && criminalResults === null && peopleResults === null && !searching && !searchError && propertyResult !== null && (
            <PropertyCard property={propertyResult} />
          )}
          {propertyResult === null && searchMode === 'property' && criminalResults === null && peopleResults === null && !searching && !searchError && propertyResult !== undefined && (
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold">No property records found</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SearchButton({ searching, disabled, label, cost }: { searching: boolean; disabled: boolean; label: string; cost: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="submit" disabled={searching || disabled} className="toolbar-btn toolbar-btn-primary text-[10px]">
        {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
        {searching ? 'Searching...' : label}
      </button>
      <span className="text-[9px] text-rmpg-500">{cost} per hit. No charge if no results found. Max 2 results returned.</span>
    </div>
  );
}

function ResultHeader({ count, totalFound, capped, type }: { count: number; totalFound: number; capped: boolean; type: string }) {
  return (
    <div className="text-[10px] text-rmpg-400 uppercase tracking-wider font-bold">
      {count === 0 ? `No ${type}s found` : (
        <>
          {count} {type}{count !== 1 ? 's' : ''} shown
          {capped && <span className="text-amber-400 ml-2">(limited from {totalFound} total \u2014 refine search for fewer results)</span>}
        </>
      )}
    </div>
  );
}

function CriminalCard({ result, idx, expandedIdx, setExpandedIdx }: { result: CriminalResult; idx: number; expandedIdx: number | null; setExpandedIdx: (n: number | null) => void }) {
  return (
    <div className="border border-rmpg-600 bg-surface-base">
      <button onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/50 transition-colors text-left">
        <Shield className="w-4 h-4 text-brand-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-white">{result.name.first} {result.name.middle ? `${result.name.middle} ` : ''}{result.name.last}{result.name.suffix ? ` ${result.name.suffix}` : ''}</span>
          <span className="text-[10px] text-rmpg-400 ml-2">{result.dob ? `DOB: ${result.dob}` : ''} {result.age ? `(Age ${result.age})` : ''}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 ${result.is_sex_offender === 'Yes' ? 'bg-red-900/50 text-red-400 border border-red-700/50' : ''}`}>
          {result.crimes.length} offense{result.crimes.length !== 1 ? 's' : ''}
        </span>
        {expandedIdx === idx ? <ChevronUp className="w-3 h-3 text-rmpg-400" /> : <ChevronDown className="w-3 h-3 text-rmpg-400" />}
      </button>
      {expandedIdx === idx && (
        <div className="px-3 pb-3 space-y-3 border-t border-rmpg-700">
          <div className="grid grid-cols-6 gap-2 pt-2">
            {result.gender && <Detail label="Gender" value={result.gender} />}
            {result.race && <Detail label="Race" value={result.race} />}
            {result.hair && <Detail label="Hair" value={result.hair} />}
            {result.eyes && <Detail label="Eyes" value={result.eyes} />}
            {result.height && <Detail label="Height" value={result.height} />}
            {result.weight && <Detail label="Weight" value={result.weight} />}
          </div>
          {result.scars_marks && <Detail label="Scars / Marks" value={result.scars_marks} />}
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
                  }`}>{crime.crime_type || crime.case_type || 'N/A'}</span>
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
  );
}

function PersonCard({ person, idx, expandedIdx, setExpandedIdx }: { person: PersonResult; idx: number; expandedIdx: number | null; setExpandedIdx: (n: number | null) => void }) {
  return (
    <div className="border border-rmpg-600 bg-surface-base">
      <button onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-rmpg-700/50 transition-colors text-left">
        <User className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-white">{person.name.first} {person.name.middle ? `${person.name.middle} ` : ''}{person.name.last}{person.name.suffix ? ` ${person.name.suffix}` : ''}</span>
          <span className="text-[10px] text-rmpg-400 ml-2">{person.dob ? `DOB: ${person.dob}` : ''} {person.age ? `(Age ${person.age})` : ''}</span>
          {person.is_deceased === 'Yes' && <span className="text-[10px] text-red-400 ml-2 font-bold">DECEASED</span>}
        </div>
        <div className="flex items-center gap-2 text-[9px] text-rmpg-400">
          {person.addresses.length > 0 && <span>{person.addresses.length} addr</span>}
          {person.phones.length > 0 && <span>{person.phones.length} phone</span>}
          {person.emails.length > 0 && <span>{person.emails.length} email</span>}
        </div>
        {expandedIdx === idx ? <ChevronUp className="w-3 h-3 text-rmpg-400" /> : <ChevronDown className="w-3 h-3 text-rmpg-400" />}
      </button>
      {expandedIdx === idx && (
        <div className="px-3 pb-3 space-y-3 border-t border-rmpg-700 pt-2">
          {/* Aliases */}
          {person.aliases.length > 0 && (
            <div className="text-[10px]">
              <span className="text-rmpg-400 uppercase font-semibold">Also Known As: </span>
              <span className="text-rmpg-200">{person.aliases.join(', ')}</span>
            </div>
          )}
          {/* Addresses */}
          {person.addresses.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Addresses</span>
              {person.addresses.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                  <MapPin className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
                  <span>{a.line1}, {a.city}, {a.state} {a.zip}</span>
                  {a.type && <span className="text-[8px] text-rmpg-500 uppercase">({a.type})</span>}
                </div>
              ))}
            </div>
          )}
          {/* Phones */}
          {person.phones.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Phone Numbers</span>
              {person.phones.map((ph, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                  <Phone className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
                  <span>{ph.number}</span>
                  {ph.type && <span className="text-[8px] text-rmpg-500 uppercase">({ph.type})</span>}
                  {ph.carrier && <span className="text-[8px] text-rmpg-500">{ph.carrier}</span>}
                </div>
              ))}
            </div>
          )}
          {/* Emails */}
          {person.emails.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Email Addresses</span>
              {person.emails.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                  <Mail className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          )}
          {/* Relatives */}
          {person.relatives.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Relatives</span>
              {person.relatives.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-rmpg-300">
                  <Users className="w-3 h-3 text-rmpg-500 flex-shrink-0" />
                  <span className="font-semibold">{r.name}</span>
                  {r.relationship && <span className="text-[8px] text-rmpg-500 uppercase">({r.relationship})</span>}
                  {r.dob && <span className="text-[8px] text-rmpg-500">DOB: {r.dob}</span>}
                </div>
              ))}
            </div>
          )}
          {/* Financial flags */}
          {(person.bankruptcies.length > 0 || person.liens.length > 0 || person.judgments.length > 0) && (
            <div className="flex items-center gap-3 text-[10px]">
              <Scale className="w-3 h-3 text-amber-400" />
              {person.bankruptcies.length > 0 && <span className="text-amber-400 font-bold">{person.bankruptcies.length} Bankruptcy</span>}
              {person.liens.length > 0 && <span className="text-amber-400 font-bold">{person.liens.length} Lien</span>}
              {person.judgments.length > 0 && <span className="text-amber-400 font-bold">{person.judgments.length} Judgment</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PropertyCard({ property }: { property: PropertyResult }) {
  return (
    <div className="border border-rmpg-600 bg-surface-base p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-bold text-white uppercase tracking-wider">Property Details</span>
      </div>
      {/* Owner */}
      <div className="grid grid-cols-3 gap-3 border-b border-rmpg-700 pb-2">
        <div>
          <Detail label="Owner" value={property.owner_name || 'Unknown'} />
          {property.owner_name_2 && <Detail label="Owner 2" value={property.owner_name_2} />}
        </div>
        <div>
          <Detail label="Property Address" value={`${property.property_address.line1}, ${property.property_address.city}, ${property.property_address.state} ${property.property_address.zip}`} />
        </div>
        {property.mailing_address.line1 && (
          <div>
            <Detail label="Mailing Address" value={`${property.mailing_address.line1}, ${property.mailing_address.city}, ${property.mailing_address.state} ${property.mailing_address.zip}`} />
          </div>
        )}
      </div>
      {/* Details */}
      <div className="grid grid-cols-6 gap-2">
        {property.property_type && <Detail label="Type" value={property.property_type} />}
        {property.bedrooms && <Detail label="Beds" value={property.bedrooms} />}
        {property.bathrooms && <Detail label="Baths" value={property.bathrooms} />}
        {property.sqft && <Detail label="SqFt" value={property.sqft} />}
        {property.lot_size && <Detail label="Lot Size" value={property.lot_size} />}
        {property.year_built && <Detail label="Year Built" value={property.year_built} />}
      </div>
      {/* Financial */}
      <div className="grid grid-cols-5 gap-2">
        {property.assessed_value && <Detail label="Assessed Value" value={`$${property.assessed_value}`} />}
        {property.market_value && <Detail label="Market Value" value={`$${property.market_value}`} />}
        {property.last_sale_price && <Detail label="Last Sale" value={`$${property.last_sale_price}`} />}
        {property.last_sale_date && <Detail label="Sale Date" value={property.last_sale_date} />}
        {property.tax_amount && <Detail label="Annual Tax" value={`$${property.tax_amount}`} />}
      </div>
      {/* Legal */}
      <div className="grid grid-cols-4 gap-2">
        {property.zoning && <Detail label="Zoning" value={property.zoning} />}
        {property.apn && <Detail label="APN / Parcel #" value={property.apn} />}
        {property.legal_description && <Detail label="Legal Desc" value={property.legal_description} />}
        {property.usps_classification && <Detail label="USPS Class" value={property.usps_classification} />}
      </div>
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
