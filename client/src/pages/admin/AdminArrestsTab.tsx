import React, { useState, useEffect, useCallback } from 'react';
import {
  Fingerprint, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, AlertTriangle, ToggleLeft, ToggleRight,
  RefreshCw, MapPin, Clock, Database, Link2, Plus, Upload,
  User, FileText, ChevronDown, ChevronRight, Search, Edit2, X,
  Globe, Shield, Activity, RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface ArrestStatus {
  configured: boolean;
  enabled: boolean;
  enabledCounties: string[];
  lastSync: string | null;
  recordsCount: number;
  manualCount?: number;
  csvCount?: number;
  apiCount?: number;
  countiesSynced: number;
  status: string;
  lastError: string | null;
  apiOffline?: boolean;
}

interface BookingRecord {
  id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string | null;
  booking_date: string | null;
  release_date: string | null;
  charges: string[];
  county: string;
  status: string;
  booking_number: string | null;
  agency: string | null;
  gender: string | null;
  race: string | null;
  bail_amount: number | null;
  hold_reason: string | null;
  notes: string | null;
  entry_source: string | null;
}

const EMPTY_BOOKING = {
  full_name: '', date_of_birth: '', booking_date: '', release_date: '',
  charges: '', county: '', status: 'active', booking_number: '', agency: '',
  gender: '', race: '', height: '', weight: '', hair_color: '', eye_color: '',
  address: '', bail_amount: '', hold_reason: '', notes: '',
};

const UTAH_COUNTIES = [
  'Salt Lake', 'Utah', 'Davis', 'Weber', 'Cache', 'Washington', 'Iron',
  'Box Elder', 'Tooele', 'Summit', 'Uintah', 'Sanpete', 'Sevier', 'Grand',
  'Beaver', 'Duchesne', 'Carbon', 'Emery', 'Juab', 'Millard', 'Morgan',
  'Rich', 'San Juan', 'Wasatch', 'Wayne', 'Garfield', 'Kane', 'Piute', 'Daggett',
];

export default function AdminArrestsTab({ LoadingSpinner, error, setError }: Props) {
  const [status, setStatus] = useState<ArrestStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<BookingRecord[]>([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('');

  // Manual entry form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_BOOKING });
  const [formSaving, setFormSaving] = useState(false);

  // CSV Import
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvData, setCsvData] = useState('');
  const [csvCounty, setCsvCounty] = useState('');
  const [csvAgency, setCsvAgency] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);

  // Jail Roster Scraper
  const [showScraper, setShowScraper] = useState(false);
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  const [scraperLoading, setScraperLoading] = useState(false);
  const [syncingCounty, setSyncingCounty] = useState('');

  // Legacy API settings
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Search
  const [searchTerm, setSearchTerm] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<ArrestStatus>('/arrests/status');
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch arrest status:', err);
    } finally { setLoading(false); }
  }, []);

  const fetchRecords = useCallback(async (page = 1, source = '', search = '') => {
    setRecordsLoading(true);
    try {
      if (search.trim()) {
        const data = await apiFetch<{ records: BookingRecord[]; resultCount: number }>(
          `/arrests/search?name=${encodeURIComponent(search)}`
        );
        setRecords(data.records || []);
        setRecordsTotal(data.resultCount || 0);
      } else {
        const qs = new URLSearchParams({ page: String(page), limit: '25', ...(source ? { source } : {}) });
        const data = await apiFetch<{ records: BookingRecord[]; total: number }>(`/arrests/recent?${qs}`);
        setRecords(data.records || []);
        setRecordsTotal(data.total || 0);
      }
    } catch (e) { console.error('Failed to fetch arrest records:', e); }
    finally { setRecordsLoading(false); }
  }, []);

  const fetchScraperStatus = useCallback(async () => {
    setScraperLoading(true);
    try {
      const data = await apiFetch<any>('/jail-roster/status');
      setScraperStatus(data);
    } catch (e) { console.error('Failed to fetch scraper status:', e); }
    finally { setScraperLoading(false); }
  }, []);

  const handleScraperSync = async (county: string) => {
    setSyncingCounty(county);
    try {
      await apiFetch(`/jail-roster/sync/${county}`, { method: 'POST' });
      fetchScraperStatus();
      fetchRecords(recordsPage, sourceFilter, searchTerm);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally { setSyncingCounty(''); }
  };

  const handleScraperToggle = async (county: string, enabled: boolean) => {
    try {
      await apiFetch(`/jail-roster/config/${county}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      fetchScraperStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleResetErrors = async (county: string) => {
    try {
      await apiFetch(`/jail-roster/reset-errors/${county}`, { method: 'POST' });
      fetchScraperStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    }
  };

  const handleIntervalChange = async (county: string, minutes: number) => {
    try {
      await apiFetch(`/jail-roster/config/${county}`, { method: 'PUT', body: JSON.stringify({ scrape_interval_minutes: minutes }) });
      fetchScraperStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { fetchRecords(recordsPage, sourceFilter, searchTerm); }, [fetchRecords, recordsPage, sourceFilter, searchTerm]);

  // ── Form handlers ────────────────────────────────────────

  const handleSubmitBooking = async () => {
    if (!form.full_name.trim()) return;
    setFormSaving(true);
    try {
      const body: any = { ...form };
      if (body.charges) body.charges = body.charges.split('\n').map((c: string) => c.trim()).filter(Boolean);
      else body.charges = [];
      if (body.bail_amount) body.bail_amount = parseFloat(body.bail_amount);
      else delete body.bail_amount;

      if (editingId) {
        await apiFetch(`/arrests/manual/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/arrests/manual', { method: 'POST', body: JSON.stringify(body) });
      }

      setForm({ ...EMPTY_BOOKING });
      setShowForm(false);
      setEditingId(null);
      fetchRecords(recordsPage, sourceFilter, searchTerm);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save booking');
    } finally { setFormSaving(false); }
  };

  const handleEdit = (rec: BookingRecord) => {
    setForm({
      full_name: rec.full_name || '',
      date_of_birth: rec.date_of_birth || '',
      booking_date: rec.booking_date || '',
      release_date: rec.release_date || '',
      charges: Array.isArray(rec.charges) ? rec.charges.join('\n') : '',
      county: rec.county || '',
      status: rec.status || 'active',
      booking_number: rec.booking_number || '',
      agency: rec.agency || '',
      gender: rec.gender || '',
      race: rec.race || '',
      height: '', weight: '', hair_color: '', eye_color: '', address: '',
      bail_amount: rec.bail_amount != null ? String(rec.bail_amount) : '',
      hold_reason: rec.hold_reason || '',
      notes: rec.notes || '',
    });
    setEditingId(rec.id);
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/arrests/manual/${id}`, { method: 'DELETE' });
      fetchRecords(recordsPage, sourceFilter, searchTerm);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  // ── CSV Import ────────────────────────────────────────────

  const handleCsvImport = async () => {
    if (!csvData.trim()) return;
    setCsvImporting(true);
    setCsvResult(null);
    try {
      // Parse CSV text
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      const parsed = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
      }).filter(r => Object.values(r).some(v => v));

      const data = await apiFetch<{ imported: number; skipped: number; total: number }>(
        '/arrests/import-csv',
        { method: 'POST', body: JSON.stringify({ records: parsed, county: csvCounty, agency: csvAgency }) }
      );

      setCsvResult(data);
      fetchRecords(1, sourceFilter, searchTerm);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally { setCsvImporting(false); }
  };

  // ── Legacy API handlers ───────────────────────────────────

  const handleSaveKey = async () => {
    if (!apiKey.trim() || apiKey.trim().length < 10) return;
    setSaving(true);
    try {
      await apiFetch('/arrests/credentials', { method: 'PUT', body: JSON.stringify({ apiKey: apiKey.trim() }) });
      setApiKey(''); setShowKey(false); fetchStatus();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch('/arrests/sync', { method: 'POST' });
      fetchStatus(); fetchRecords(recordsPage, sourceFilter, searchTerm);
    } catch (err) { setError(err instanceof Error ? err.message : 'Sync failed'); }
    finally { setSyncing(false); }
  };

  if (loading) return <LoadingSpinner />;

  const totalPages = Math.ceil(recordsTotal / 25);

  return (
    <div className="p-4 space-y-4">
      {/* ═══ Header ═══ */}
      <div className="flex items-center gap-2">
        <Fingerprint className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Jail Roster &amp; Arrest Records</h2>
        <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {status?.recordsCount || 0} RECORDS
        </span>
      </div>

      {/* ═══ Stats Grid ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Total Records', value: status?.recordsCount || 0, icon: Database },
          { label: 'Manual Entries', value: status?.manualCount || 0, icon: User },
          { label: 'CSV Imports', value: status?.csvCount || 0, icon: FileText },
          { label: 'API Records', value: status?.apiCount || 0, icon: RefreshCw },
        ].map(stat => (
          <div key={stat.label} className="panel-beveled bg-surface-base p-2 rounded-sm text-center">
            <stat.icon className="w-3 h-3 mx-auto mb-1 text-rmpg-400" />
            <div className="text-sm font-bold text-rmpg-100">{stat.value}</div>
            <div className="text-[9px] text-rmpg-500 uppercase">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ Action Bar ═══ */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ ...EMPTY_BOOKING }); }}
          className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white"
        >
          <Plus className="w-3 h-3" />
          Add Booking
        </button>
        <button
          onClick={() => { setShowCsvImport(!showCsvImport); setCsvResult(null); }}
          className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200"
        >
          <Upload className="w-3 h-3" />
          CSV Import
        </button>

        {/* Source filter */}
        <select
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setRecordsPage(1); }}
          className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1.5 rounded-sm"
        >
          <option value="">All Sources</option>
          <option value="manual">Manual Entries</option>
          <option value="csv">CSV Imports</option>
          <option value="scraper">Scraped Records</option>
          <option value="api">API Records</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setRecordsPage(1); }}
            placeholder="Search by name..."
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] pl-7 pr-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Manual Booking Form ═══ */}
      {showForm && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <User className="w-3.5 h-3.5" />
            {editingId ? 'Edit Booking Record' : 'New Booking Record'}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { key: 'full_name', label: 'Full Name *', ph: 'LAST, FIRST MIDDLE', span: true },
              { key: 'booking_date', label: 'Booking Date', ph: '2026-03-05', type: 'date' },
              { key: 'date_of_birth', label: 'Date of Birth', ph: '1990-01-15', type: 'date' },
              { key: 'booking_number', label: 'Booking #', ph: 'BK-2026-001234' },
              { key: 'agency', label: 'Agency', ph: 'Salt Lake County Sheriff' },
              { key: 'county', label: 'County', select: UTAH_COUNTIES },
              { key: 'gender', label: 'Gender', select: ['Male', 'Female', 'Other'] },
              { key: 'race', label: 'Race', ph: '' },
              { key: 'status', label: 'Status', select: ['active', 'released', 'transferred', 'bonded'] },
              { key: 'bail_amount', label: 'Bail Amount', ph: '5000.00', type: 'number' },
              { key: 'hold_reason', label: 'Hold Reason', ph: 'Pending trial' },
              { key: 'release_date', label: 'Release Date', ph: '', type: 'date' },
            ].map(f => (
              <div key={f.key} className={f.span ? 'col-span-2 sm:col-span-3' : ''}>
                <label className="text-[9px] text-rmpg-400 uppercase">{f.label}</label>
                {f.select ? (
                  <select
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm"
                  >
                    <option value="">—</option>
                    {f.select.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type || 'text'}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.ph}
                    className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>

          <div>
            <label className="text-[9px] text-rmpg-400 uppercase">Charges (one per line)</label>
            <textarea
              value={form.charges}
              onChange={e => setForm(p => ({ ...p, charges: e.target.value }))}
              placeholder="Theft — Misdemeanor B&#10;DUI — Class A"
              rows={3}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none resize-none font-mono"
            />
          </div>

          <div>
            <label className="text-[9px] text-rmpg-400 uppercase">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Additional details..."
              rows={2}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmitBooking}
              disabled={formSaving || !form.full_name.trim()}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
            >
              {formSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {editingId ? 'Update Record' : 'Save Booking'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="toolbar-btn text-[10px] px-3 py-1.5 text-rmpg-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ CSV Import Panel ═══ */}
      {showCsvImport && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Upload className="w-3.5 h-3.5" />
            CSV / Bulk Import
          </div>
          <div className="text-[9px] text-rmpg-500">
            Paste CSV data with a header row. Supported columns: <span className="text-brand-400 font-mono">
            full_name, first_name, last_name, date_of_birth, booking_date, release_date, charges,
            booking_number, agency, gender, race, bail_amount, status</span>. At minimum, a name column is required.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-rmpg-400 uppercase">Default County</label>
              <select
                value={csvCounty}
                onChange={e => setCsvCounty(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm"
              >
                <option value="">— Select —</option>
                {UTAH_COUNTIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-400 uppercase">Default Agency</label>
              <input
                value={csvAgency}
                onChange={e => setCsvAgency(e.target.value)}
                placeholder="Salt Lake County Jail"
                className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          <textarea
            value={csvData}
            onChange={e => setCsvData(e.target.value)}
            placeholder={'full_name,booking_date,charges,agency\n"SMITH, JOHN",2026-03-05,"Theft - Misdemeanor B","SLCPD"\n"DOE, JANE",2026-03-04,"DUI","UHP"'}
            rows={8}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none resize-none font-mono"
          />

          {csvResult && (
            <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${csvResult.skipped > 0 ? 'bg-amber-950/30 border border-amber-700/40 text-amber-300' : 'bg-green-950/30 border border-green-700/40 text-green-300'}`}>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Imported {csvResult.imported} of {csvResult.total} records{csvResult.skipped > 0 && ` (${csvResult.skipped} skipped)`}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleCsvImport}
              disabled={csvImporting || !csvData.trim()}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
            >
              {csvImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {csvImporting ? 'Importing...' : 'Import Records'}
            </button>
            <button onClick={() => setShowCsvImport(false)} className="toolbar-btn text-[10px] px-3 py-1.5 text-rmpg-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ Records Table ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Database className="w-3.5 h-3.5" />
            Booking Records
            <span className="text-brand-400">({recordsTotal})</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-rmpg-500">
            <button disabled={recordsPage <= 1} onClick={() => setRecordsPage(p => p - 1)} className="px-1.5 py-0.5 hover:text-rmpg-200 disabled:opacity-30">‹</button>
            <span>{recordsPage} / {totalPages || 1}</span>
            <button disabled={recordsPage >= totalPages} onClick={() => setRecordsPage(p => p + 1)} className="px-1.5 py-0.5 hover:text-rmpg-200 disabled:opacity-30">›</button>
          </div>
        </div>

        {recordsLoading ? (
          <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-4 justify-center">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading...
          </div>
        ) : records.length === 0 ? (
          <div className="text-center text-[10px] text-rmpg-500 py-6">
            No records found. Add a booking or import from CSV.
          </div>
        ) : (
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {records.map(rec => (
              <div
                key={rec.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-surface-sunken hover:bg-rmpg-800/30 transition-colors group"
              >
                {/* Source badge */}
                <div className={`shrink-0 w-1 h-8 rounded-full ${
                  rec.entry_source === 'manual' ? 'bg-brand-500' :
                  rec.entry_source === 'csv' ? 'bg-blue-500' :
                  rec.entry_source === 'scraper' ? 'bg-emerald-500' : 'bg-rmpg-600'
                }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-rmpg-100 truncate">{rec.full_name}</span>
                    {rec.booking_number && <span className="text-[9px] font-mono text-rmpg-500">#{rec.booking_number}</span>}
                    <span className={`text-[8px] font-bold uppercase px-1 rounded-sm ${
                      rec.status === 'active' ? 'bg-red-900/40 text-red-400' :
                      rec.status === 'released' ? 'bg-green-900/40 text-green-400' :
                      'bg-rmpg-700 text-rmpg-400'
                    }`}>{rec.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-rmpg-500">
                    {rec.booking_date && <span>Booked: {rec.booking_date.split('T')[0]}</span>}
                    {rec.county && <span>{rec.county} County</span>}
                    {rec.agency && <span>{rec.agency}</span>}
                    {Array.isArray(rec.charges) && rec.charges.length > 0 && (
                      <span className="text-amber-400">{rec.charges.length} charge{rec.charges.length !== 1 ? 's' : ''}</span>
                    )}
                    {rec.bail_amount != null && rec.bail_amount > 0 && (
                      <span className="text-green-400">Bail: ${rec.bail_amount.toLocaleString()}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEdit(rec)} className="p-1 text-rmpg-500 hover:text-brand-400" title="Edit">
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button onClick={() => handleDelete(rec.id)} className="p-1 text-rmpg-500 hover:text-red-400" title="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Legacy API Settings (Collapsible) ═══ */}
      <div className="panel-beveled bg-surface-base rounded-sm">
        <button
          onClick={() => setShowApiSettings(!showApiSettings)}
          className="w-full flex items-center gap-2 p-3 text-left"
        >
          {showApiSettings ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />}
          <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">JailBase API Settings (Legacy)</span>
          {status?.apiOffline && (
            <span className="ml-1 flex items-center gap-1 text-amber-400 text-[9px]">
              <AlertTriangle className="w-3 h-3" /> OFFLINE
            </span>
          )}
          {status?.configured && !status.apiOffline && (
            <span className="ml-1 text-green-400 text-[9px]">CONFIGURED</span>
          )}
        </button>

        {showApiSettings && (
          <div className="px-3 pb-3 space-y-3 border-t border-rmpg-700/50">
            {status?.apiOffline && (
              <div className="flex items-start gap-2 text-[10px] px-2 py-2 mt-2 rounded-sm bg-amber-950/30 border border-amber-700/40 text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>
                  The JailBase API is offline. Use manual booking entry or CSV import instead.
                  API settings are preserved in case the service returns.
                </div>
              </div>
            )}

            <div className="space-y-1.5 mt-2">
              <label className="text-[9px] text-rmpg-400 uppercase">RapidAPI Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={status?.configured ? 'Enter new key to replace...' : 'Enter RapidAPI key...'}
                  className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
                />
                <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={handleSaveKey} disabled={saving || !apiKey.trim() || apiKey.trim().length < 10}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Key className="w-3 h-3" />}
                Save Key
              </button>
              {status?.configured && (
                <>
                  <button onClick={handleSync} disabled={syncing}
                    className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-200 disabled:opacity-50">
                    {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button onClick={async () => {
                    try { await apiFetch('/arrests/credentials', { method: 'DELETE' }); fetchStatus(); } catch { /* handled by apiFetch */ }
                  }} className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                    <Trash2 className="w-3 h-3" /> Clear Key
                  </button>
                </>
              )}
            </div>

            {status?.lastError && (
              <div className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm bg-red-950/30 border border-red-800/40 text-red-400">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {status.lastError.length > 120 ? status.lastError.substring(0, 120) + '...' : status.lastError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ Jail Roster Scraper (Collapsible) ═══ */}
      <div className="panel-beveled bg-surface-base rounded-sm">
        <button
          onClick={() => { setShowScraper(!showScraper); if (!scraperStatus) fetchScraperStatus(); }}
          className="w-full flex items-center gap-2 p-3 text-left"
        >
          {showScraper ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />}
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Jail Roster Scraper</span>
          {scraperStatus && (
            <span className="ml-1 flex items-center gap-1 text-emerald-400 text-[9px]">
              <Activity className="w-3 h-3" />
              {scraperStatus.totals?.counties_active || 0} ACTIVE
            </span>
          )}
        </button>

        {showScraper && (
          <div className="px-3 pb-3 space-y-3 border-t border-rmpg-700/50">
            {scraperLoading ? (
              <div className="flex items-center gap-2 text-[10px] text-rmpg-500 py-4 justify-center">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading scraper status...
              </div>
            ) : scraperStatus ? (
              <>
                {/* Scraper Stats Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {[
                    { label: 'Scraped Records', value: scraperStatus.totals?.scraped_records || 0, color: 'text-emerald-400' },
                    { label: 'In Custody', value: scraperStatus.totals?.in_custody || 0, color: 'text-red-400' },
                    { label: 'Released', value: scraperStatus.totals?.released || 0, color: 'text-green-400' },
                    { label: 'Counties Active', value: scraperStatus.totals?.counties_active || 0, color: 'text-brand-400' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-surface-sunken p-2 rounded-sm text-center">
                      <div className={`text-sm font-bold ${stat.color}`}>{stat.value}</div>
                      <div className="text-[8px] text-rmpg-500 uppercase">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {/* County Cards */}
                <div className="space-y-2">
                  {(scraperStatus.counties || []).map((county: any) => {
                    const isCircuitBroken = county.consecutive_errors >= 5;
                    const lastSyncAgo = county.last_scrape_at
                      ? Math.round((Date.now() - new Date(county.last_scrape_at).getTime()) / 60000) : null;
                    const isStale = lastSyncAgo !== null && lastSyncAgo > (county.scrape_interval_minutes || 30) * 2;

                    return (
                      <div key={county.county} className="bg-surface-sunken p-2.5 rounded-sm">
                        <div className="flex items-center gap-2">
                          {/* Status indicator */}
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            isCircuitBroken ? 'bg-red-500' :
                            isStale ? 'bg-amber-500' :
                            county.enabled ? 'bg-green-500' : 'bg-rmpg-600'
                          }`} />

                          <span className="text-[11px] font-bold text-rmpg-100 flex-1">{county.display_name}</span>

                          {/* Type badge */}
                          <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${
                            county.roster_type === 'pdf' ? 'bg-amber-900/40 text-amber-400' : 'bg-blue-900/40 text-blue-400'
                          }`}>{county.roster_type}</span>

                          {/* Enable/Disable toggle */}
                          <button
                            onClick={() => handleScraperToggle(county.county, !county.enabled)}
                            className="text-rmpg-500 hover:text-rmpg-200"
                            title={county.enabled ? 'Disable' : 'Enable'}
                          >
                            {county.enabled ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
                          </button>
                        </div>

                        {/* Details row */}
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-rmpg-500">
                          {county.last_scrape_at && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {lastSyncAgo !== null && lastSyncAgo < 60 ? `${lastSyncAgo}m ago` :
                               lastSyncAgo !== null ? `${Math.round(lastSyncAgo / 60)}h ago` : 'never'}
                            </span>
                          )}
                          {county.last_sync && (
                            <>
                              <span>{county.last_sync.records_found} found</span>
                              {county.last_sync.duration_ms && <span>{county.last_sync.duration_ms}ms</span>}
                            </>
                          )}

                          {/* Interval selector */}
                          <select
                            value={county.scrape_interval_minutes || 30}
                            onChange={e => handleIntervalChange(county.county, parseInt(e.target.value, 10))}
                            className="bg-surface-base border border-rmpg-700 text-rmpg-400 text-[9px] px-1 py-0.5 rounded-sm"
                          >
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="60">60 min</option>
                            <option value="120">120 min</option>
                          </select>

                          {/* Sync Now button */}
                          <button
                            onClick={() => handleScraperSync(county.county)}
                            disabled={syncingCounty === county.county}
                            className="flex items-center gap-1 text-[9px] text-brand-400 hover:text-brand-300 disabled:opacity-50"
                          >
                            {syncingCounty === county.county ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Zap className="w-2.5 h-2.5" />
                            )}
                            Sync Now
                          </button>

                          {/* Reset Errors button */}
                          {isCircuitBroken && (
                            <button
                              onClick={() => handleResetErrors(county.county)}
                              className="flex items-center gap-1 text-[9px] text-red-400 hover:text-red-300"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Reset
                            </button>
                          )}
                        </div>

                        {/* Circuit breaker warning */}
                        {isCircuitBroken && (
                          <div className="flex items-center gap-1 mt-1 text-[9px] text-red-400">
                            <Shield className="w-3 h-3" />
                            Circuit breaker active — {county.consecutive_errors} consecutive errors
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Recent Sync Log */}
                {scraperStatus.recent_syncs && scraperStatus.recent_syncs.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Recent Sync Log</div>
                    <div className="space-y-0.5 max-h-[150px] overflow-y-auto">
                      {scraperStatus.recent_syncs.slice(0, 10).map((sync: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-[9px] px-2 py-1 rounded-sm bg-surface-base">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sync.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className="text-rmpg-400 w-14">{sync.county}</span>
                          <span className="text-rmpg-500">{sync.synced_at?.split(' ')[1]?.substring(0, 5) || sync.synced_at}</span>
                          {sync.status === 'success' ? (
                            <span className="text-rmpg-400">
                              {sync.records_found}F / {sync.records_new}N / {sync.records_updated}U / {sync.records_released}R
                            </span>
                          ) : (
                            <span className="text-red-400 truncate flex-1">{sync.error_message}</span>
                          )}
                          <span className="text-rmpg-600 ml-auto">{sync.duration_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Refresh button */}
                <button
                  onClick={fetchScraperStatus}
                  className="flex items-center gap-1 text-[9px] text-rmpg-500 hover:text-rmpg-300"
                >
                  <RefreshCw className="w-2.5 h-2.5" /> Refresh Status
                </button>
              </>
            ) : (
              <div className="text-[10px] text-rmpg-500 py-2">Failed to load scraper status.</div>
            )}
          </div>
        )}
      </div>

      {/* ═══ Cross-Link Info ═══ */}
      <div className="text-[9px] text-rmpg-600 px-1">
        All booking records are automatically cross-linked against warrants, court events, and known persons.
        Use the NCIC <span className="text-brand-400 font-mono">QR</span> command to query arrest records from any source.
      </div>
    </div>
  );
}
