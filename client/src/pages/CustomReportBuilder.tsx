// ============================================================
// RMPG Flex — Custom Report Builder
// Visual query builder for ad-hoc reports. Choose source table,
// select columns, set filters, preview results, and export CSV.
// ============================================================

import React, {useState, useCallback, useEffect} from 'react';
import { Database, Columns, Filter, Play, Download, ArrowUpDown, ChevronRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { localToday } from '../utils/dateUtils';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import { toDisplayLabel } from '../utils/formatters';
import { useToast } from '../components/ToastProvider';

const SOURCES: Record<string, { label: string; columns: string[] }> = {
  calls_for_service: {
    label: 'Calls for Service',
    columns: ['id', 'call_number', 'incident_type', 'priority', 'status', 'caller_name', 'location_address', 'zone_beat', 'beat_id', 'zone_id', 'section_id', 'disposition', 'created_at', 'dispatched_at', 'onscene_at', 'cleared_at'],
  },
  incidents: {
    label: 'Incident Reports',
    columns: ['id', 'incident_number', 'incident_type', 'priority', 'status', 'location_address', 'narrative', 'officer_id', 'created_at', 'occurred_date', 'zone_beat', 'beat_id', 'zone_id', 'disposition', 'domestic_violence', 'weapons_involved'],
  },
  citations: {
    label: 'Citations',
    columns: ['id', 'citation_number', 'type', 'violation_description', 'statute_citation', 'offense_level', 'location', 'status', 'fine_amount', 'officer_id', 'violation_date', 'created_at'],
  },
  warrants: {
    label: 'Warrants',
    columns: ['id', 'warrant_number', 'type', 'status', 'offense_level', 'charge_description', 'statute_citation', 'court_name', 'bail_amount', 'date_issued', 'expires_at', 'served_at', 'created_at'],
  },
  bolos: {
    label: 'BOLOs / Lookouts',
    columns: ['id', 'subject_name', 'description', 'priority', 'status', 'category', 'vehicle_info', 'location_last_seen', 'issued_by', 'created_at', 'expires_at'],
  },
  evidence: {
    label: 'Evidence',
    columns: ['id', 'evidence_number', 'incident_id', 'description', 'category', 'storage_location', 'chain_of_custody', 'collected_by', 'collected_at', 'created_at'],
  },
  time_entries: {
    label: 'Time Entries',
    columns: ['id', 'officer_id', 'shift_date', 'clock_in', 'clock_out', 'hours_worked', 'overtime_hours', 'status', 'notes', 'approved_by'],
  },
  training_records: {
    label: 'Training Records',
    columns: ['id', 'officer_id', 'title', 'category', 'status', 'hours', 'completed_date', 'expiry_date', 'instructor', 'score'],
  },
  field_interviews: {
    label: 'Field Interviews',
    columns: ['id', 'subject_name', 'location', 'reason', 'officer_id', 'created_at'],
  },
  patrol_scans: {
    label: 'Patrol Scans',
    columns: ['id', 'checkpoint_id', 'officer_id', 'scanned_at', 'gps_latitude', 'gps_longitude'],
  },
};

interface ReportFilter {
  column: string;
  operator: 'eq' | 'contains' | 'gte' | 'lte';
  value: string;
}

type Step = 'source' | 'columns' | 'filters' | 'preview';

export default function CustomReportBuilder() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(200);
  const [results, setResults] = useState<any[]>([]);
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rowCount, setRowCount] = useState(0);

  const availableCols = source ? SOURCES[source]?.columns || [] : [];

  const handleSourceSelect = (src: string) => {
    setSource(src);
    setSelectedCols((SOURCES[src]?.columns || []).slice(0, 6)); // default first 6
    setFilters([]);
    setSortBy('');
    setStep('columns');
  };

  const toggleColumn = (col: string) => {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const addFilter = () => {
    if (availableCols.length === 0) return;
    setFilters(prev => [...prev, { column: availableCols[0], operator: 'contains', value: '' }]);
  };

  const updateFilter = (idx: number, field: keyof ReportFilter, val: string) => {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, [field]: val } : f));
  };

  const removeFilter = (idx: number) => {
    setFilters(prev => prev.filter((_, i) => i !== idx));
  };

  const runQuery = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<any>('/reports/custom', {
        method: 'POST',
        body: JSON.stringify({
          source,
          columns: selectedCols,
          filters: filters.filter(f => f.value),
          sortBy: sortBy || undefined,
          sortDir,
          limit,
        }),
      });
      setResults(data.data || []);
      setResultColumns(data.columns || selectedCols);
      setRowCount(data.count || 0);
      setStep('preview');
      addToast(`Query returned ${data.count || 0} rows`, 'success');
    } catch (err: any) {
      setError(err?.message || 'Query failed');
      addToast('Failed to run report query', 'error');
    }
    setLoading(false);
  }, [source, selectedCols, filters, sortBy, sortDir, limit]);

  const exportCsv = () => {
    if (results.length === 0) return;
    const headers = resultColumns.join(',');
    const rows = results.map(r => resultColumns.map(c => `"${String(r[c] ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`).join(','));
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-report-${source}-${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    { id: 'source', label: 'Source', icon: <Database className="w-3.5 h-3.5" /> },
    { id: 'columns', label: 'Columns', icon: <Columns className="w-3.5 h-3.5" /> },
    { id: 'filters', label: 'Filters', icon: <Filter className="w-3.5 h-3.5" /> },
    { id: 'preview', label: 'Results', icon: <Play className="w-3.5 h-3.5" /> },
  ];

  // Set document title
  useEffect(() => { document.title = 'Custom Report Builder \u2014 RMPG Flex'; }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {!isMobile && <PanelTitleBar title="Custom Report Builder" icon={Database}>
        <div className="flex items-center gap-2">
          {source && step !== 'source' && (
            <span className="text-[9px] text-brand-400 font-bold uppercase">{SOURCES[source]?.label}</span>
          )}
          {results.length > 0 && (
            <button type="button" onClick={exportCsv} className="toolbar-btn toolbar-btn-primary print:hidden">
              <Download className="w-3 h-3" /> Export CSV
            </button>
          )}
        </div>
      </PanelTitleBar>}

      {/* Step indicators */}
      <div className={`flex items-center ${isMobile ? 'px-2 py-1.5 overflow-x-auto' : 'px-4 py-2'} border-b border-rmpg-700/50 flex-shrink-0`} style={{ background: '#080808' }}>
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 && <ChevronRight className="w-3 h-3 text-rmpg-600 mx-1" />}
            <button type="button"
              onClick={() => { if (s.id === 'source' || source) setStep(s.id); }}
              className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                step === s.id ? 'text-brand-400 bg-brand-900/30 border border-brand-700/50' : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {s.icon} {s.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className={`flex-1 overflow-auto ${isMobile ? 'p-3' : 'p-4'}`}>
        {/* Step 1: Source Selection */}
        {step === 'source' && (
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider mb-4">Select Data Source</h2>
            <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-3`}>
              {Object.entries(SOURCES).map(([key, src]) => (
                <button type="button"
                  key={key}
                  onClick={() => handleSourceSelect(key)}
                  className={`panel-surface p-4 text-left hover:border-brand-500 transition-colors ${
                    source === key ? 'border-brand-500 bg-brand-900/20' : ''
                  }`}
                >
                  <Database className="w-5 h-5 text-brand-400 mb-2" />
                  <p className="text-sm font-bold text-white">{src.label}</p>
                  <p className="text-[9px] text-rmpg-400 mt-1">{src.columns.length} columns available</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Column Selection */}
        {step === 'columns' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Select Columns</h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedCols(availableCols)} className="text-[9px] text-brand-400 hover:text-brand-300">Select All</button>
                <button type="button" onClick={() => setSelectedCols([])} className="text-[9px] text-rmpg-400 hover:text-rmpg-300">Clear</button>
              </div>
            </div>
            <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-2`}>
              {availableCols.map(col => (
                <label key={col} className="flex items-center gap-2 panel-surface p-2 cursor-pointer hover:border-brand-500/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col)}
                    onChange={() => toggleColumn(col)}
                    className="accent-brand-500"
                  />
                  <span className="text-[10px] text-rmpg-200">{toDisplayLabel(col)}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setStep('filters')} disabled={selectedCols.length === 0} className="toolbar-btn toolbar-btn-primary print:hidden">
                Next: Filters <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Filters */}
        {step === 'filters' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Set Filters (Optional)</h2>
              <button type="button" onClick={addFilter} className="toolbar-btn"><Filter className="w-3 h-3" /> Add Filter</button>
            </div>

            {filters.map((f, i) => (
              <div key={`${f.column}-${f.operator}-${i}`} className={`${isMobile ? 'flex flex-col gap-1.5' : 'flex items-center gap-2'} panel-surface p-2`}>
                <div className="flex items-center gap-2">
                  <select className={`select-dark text-[10px] ${isMobile ? 'flex-1' : 'w-40'}`} value={f.column} onChange={e => updateFilter(i, 'column', e.target.value)}>
                    {availableCols.map(c => <option key={c} value={c}>{toDisplayLabel(c)}</option>)}
                  </select>
                  <select className={`select-dark text-[10px] ${isMobile ? 'w-24' : 'w-28'}`} value={f.operator} onChange={e => updateFilter(i, 'operator', e.target.value as any)}>
                    <option value="eq">Equals</option>
                    <option value="contains">Contains</option>
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                  </select>
                  <button type="button" onClick={() => removeFilter(i)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                </div>
                <input
                  type="text"
                  className="input-dark text-[10px] flex-1 min-h-[36px]"
                  placeholder="Value..."
                  value={f.value}
                  onChange={e => updateFilter(i, 'value', e.target.value)}
                />
              </div>
            ))}

            <div className={`${isMobile ? 'flex flex-col gap-2' : 'flex items-center gap-4'} panel-surface p-3 mt-4`}>
              <div className="flex items-center gap-2 flex-wrap">
                <ArrowUpDown className="w-3 h-3 text-rmpg-400" />
                <span className="text-[9px] text-rmpg-400 uppercase font-bold">Sort By:</span>
                <select className={`select-dark text-[10px] ${isMobile ? 'flex-1' : 'w-40'}`} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="">— None —</option>
                  {selectedCols.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="select-dark text-[10px] w-20 min-h-[36px]" value={sortDir} onChange={e => setSortDir(e.target.value as any)}>
                  <option value="asc">ASC</option>
                  <option value="desc">DESC</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-rmpg-400 uppercase font-bold">Limit:</span>
                <select className="select-dark text-[10px] w-20 min-h-[36px]" value={limit} onChange={e => setLimit(Number(e.target.value))}>
                  {[50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button type="button" onClick={runQuery} disabled={loading} className="toolbar-btn toolbar-btn-primary print:hidden">
                {loading ? 'Running...' : 'Run Query'} <Play className="w-3 h-3" />
              </button>
            </div>
            {error && <p className="text-red-400 text-[10px]">{error}</p>}
          </div>
        )}

        {/* Step 4: Results */}
        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">
                Results — {rowCount} rows
              </h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep('filters')} className="toolbar-btn">Edit Query</button>
                <button type="button" onClick={runQuery} disabled={loading} className="toolbar-btn">
                  <RefreshCw className="w-3 h-3" /> Re-run
                </button>
                <button type="button" onClick={exportCsv} className="toolbar-btn toolbar-btn-primary print:hidden">
                  <Download className="w-3 h-3" /> CSV
                </button>
              </div>
            </div>
            <div className={`overflow-auto ${isMobile ? 'max-h-[calc(100dvh-200px)] -mx-3' : 'max-h-[calc(100dvh-260px)]'}`}>
              <table className={`w-full text-[10px] border-collapse ${isMobile ? 'min-w-[600px]' : ''}`}>
                <thead>
                  <tr>
                    {resultColumns.map(col => (
                      <th key={col} className="text-left px-2 py-1.5 text-[9px] font-bold text-rmpg-400 uppercase tracking-wider bg-rmpg-800/50 border-b border-rmpg-700/50 sticky top-0">
                        {toDisplayLabel(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={i} className="border-b border-rmpg-800/30 hover:bg-rmpg-800/20">
                      {resultColumns.map(col => (
                        <td key={col} className="px-2 py-1 text-rmpg-200 font-mono max-w-48 truncate">
                          {String(row[col] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr><td colSpan={resultColumns.length} className="text-center py-8 text-rmpg-500">No results</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
