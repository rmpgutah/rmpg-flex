// RMPG Flex — ALPR Capture History Portal
// Full-detail view of historical plate scan uploads for admin and officers.
// Replaces the inline "PLATE SCAN" button history with a dedicated portal
// that offers image thumbnails, vehicle details, hit badges, date filters,
// CSV export (admin), and drill-down to the vehicle dossier.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Search, Download, ScanSearch, AlertTriangle, CheckCircle,
  XCircle, Clock, Car, MapPin, Filter, Loader2, Plus,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import PlateScanModal from '../components/PlateScanModal';
import { copyToClipboard } from '../utils/contextMenuActions';
import { alprCapturesToCsv, downloadTextFile } from '../utils/rmsListExport';

interface CaptureRow {
  id: number;
  plate: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicle_type: string | null;
  confidence: number | null;
  risk_score: number | null;
  review_status: string | null;
  accepted: number | null;
  alerted: number | null;
  call_id: number | null;
  incident_id: number | null;
  field_photo_id: number | null;
  image_url: string | null;
  annotated_image_url: string | null;
  vehicle_count: number | null;
  enrich_status: string | null;
  created_at: string;
  damage_observed: number | null;
  damage_summary: string | null;
  condition: string | null;
}

type DateFilter = 'today' | '7d' | '30d' | 'all';
type SourceFilter = '' | 'field' | 'dashcam' | 'manual';

function formatTs(raw: string): string {
  const d = parseTimestamp(raw);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function dateFrom(filter: DateFilter): string | undefined {
  if (filter === 'all') return undefined;
  const now = Date.now();
  if (filter === 'today') {
    const d = new Date(now); // new-date-ok — epoch number, not a server string
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()); // new-date-ok local wall-clock
    return start.toISOString();
  }
  const days = filter === '7d' ? 7 : 30;
  return new Date(now - days * 86_400_000).toISOString(); // new-date-ok — arithmetic on numeric ms
}

const REVIEW_STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  confirmed:          { label: 'Confirmed', cls: 'text-green-400 border-green-700' },
  confirmed_unlinked: { label: 'Unlinked',  cls: 'text-yellow-400 border-yellow-700' },
  needs_review:       { label: 'Needs review', cls: 'text-amber-400 border-amber-700' },
  no_plate:           { label: 'No plate',  cls: 'text-rmpg-500 border-rmpg-600' },
  rejected:           { label: 'Rejected',  cls: 'text-red-400 border-red-700' },
};

export default function AlprHistoryPage() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [plate, setPlate] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('7d');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('');
  const [accepted, setAccepted] = useState<'' | '0' | '1'>('');
  const [showScanModal, setShowScanModal] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: '100', gallery: '1' });
      const from = dateFrom(dateFilter);
      if (from) params.set('from', from);
      if (plate.trim()) params.set('plate', plate.trim().toUpperCase());
      if (sourceFilter) params.set('source', sourceFilter);
      if (accepted) params.set('accepted', accepted);
      const data = await apiFetch<CaptureRow[]>(`/alpr/captures?${params}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      const msg = err?.message ?? 'Failed to load capture history';
      setLoadError(msg);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [plate, dateFilter, sourceFilter, accepted, addToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (plate) {
          e.stopPropagation();
          setPlate('');
        } else {
          inputRef.current?.blur();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plate]);

  const handleCreated = useCallback((vehicleRecordId: number) => {
    setShowScanModal(false);
    navigate(`/records/vehicles/${vehicleRecordId}`);
  }, [navigate]);

  return (
    <div className="p-4 space-y-3 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <PanelTitleBar title="ALPR CAPTURE HISTORY" icon={ScanSearch} />
        <button
          type="button"
          onClick={() => setShowScanModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-brand-400 text-brand-400 hover:bg-surface-raised"
        >
          <Plus className="w-3 h-3" />
          NEW SCAN
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-default pb-3">
        {/* Plate search */}
        <div className="relative flex-1 min-w-40 max-w-52">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            ref={inputRef}
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Plate… (/ to focus)"
            className="w-full bg-surface-overlay border border-border-default pl-7 pr-2 py-1.5 text-xs text-rmpg-200 placeholder:text-rmpg-500 outline-none focus:border-brand-400 uppercase"
          />
        </div>

        {/* Date range */}
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          className="bg-surface-overlay border border-border-default text-xs text-rmpg-300 px-2 py-1.5 outline-none"
        >
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>

        {/* Source */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          className="bg-surface-overlay border border-border-default text-xs text-rmpg-300 px-2 py-1.5 outline-none"
        >
          <option value="">All sources</option>
          <option value="field">Field (call-linked)</option>
          <option value="dashcam">Dashcam</option>
          <option value="manual">Manual upload</option>
        </select>

        {/* Accepted */}
        <select
          value={accepted}
          onChange={(e) => setAccepted(e.target.value as '' | '0' | '1')}
          className="bg-surface-overlay border border-border-default text-xs text-rmpg-300 px-2 py-1.5 outline-none"
        >
          <option value="">All</option>
          <option value="1">Accepted</option>
          <option value="0">Pending / Review</option>
        </select>

        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 px-2 py-1.5 border border-border-default text-rmpg-400 text-xs hover:text-rmpg-200"
          aria-label="Apply filters"
        >
          <Filter className="w-3 h-3" />
          Filter
        </button>
        {loadError && (
          <button type="button" onClick={load} className="text-xs border border-red-700 text-red-400 px-2 py-1.5">Retry</button>
        )}

        <div className="ml-auto flex items-center gap-2 text-[10px] text-rmpg-500">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>{rows.length} record{rows.length !== 1 ? 's' : ''}</span>}
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadTextFile(`alpr-history-${Date.now()}.csv`, alprCapturesToCsv(rows.map((r) => ({
                id: r.id,
                created_at: r.created_at,
                plate: r.plate,
                state: r.state,
                make: r.make,
                model: r.model,
                accepted: r.accepted,
                alerted: r.alerted,
                call_id: r.call_id,
              }))))}
              disabled={rows.length === 0}
              className="toolbar-btn flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-rmpg-500 gap-3">
          <ScanSearch className="w-8 h-8 opacity-30" />
          <span className="text-sm">
            {plate.trim() || sourceFilter || accepted
              ? 'No captures match the current plate / source / accepted filters'
              : 'No captures found for the selected date range'}
          </span>
          <button
            type="button"
            onClick={() => setShowScanModal(true)}
            className="text-xs border border-brand-400 text-brand-400 px-4 py-1.5 hover:bg-surface-raised"
          >
            Run a New Plate Scan
          </button>
        </div>
      )}

      {/* Capture grid */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {rows.map((row) => {
          const chip = row.review_status ? REVIEW_STATUS_CHIP[row.review_status] : null;
          const isSelected = selectedId === row.id;
          return (
            <div
              key={row.id}
              className={`border bg-surface-raised cursor-pointer transition-colors ${
                isSelected ? 'border-brand-400' : 'border-border-default hover:border-rmpg-500'
              }`}
              style={{ borderRadius: 2 }}
              onClick={() => setSelectedId(isSelected ? null : row.id)}
            >
              {/* Image strip */}
              {(row.annotated_image_url || row.image_url) && (
                <img
                  src={authedImageUrl(row.annotated_image_url ?? row.image_url)}
                  alt={row.plate ?? 'capture'}
                  className="w-full object-cover border-b border-border-default"
                  style={{ height: 140 }}
                  loading="lazy"
                />
              )}

              <div className="p-3 space-y-1.5">
                {/* Plate + chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-rmpg-100 text-base tracking-widest">
                    {row.plate ?? '—'}
                  </span>
                  {row.plate && (
                    <button
                      type="button"
                      className="text-[9px] border border-border-default px-1.5 py-0.5"
                      onClick={(e) => { e.stopPropagation(); void copyToClipboard(row.plate!); }}
                    >
                      Copy plate
                    </button>
                  )}
                  {row.alerted ? (
                    <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-400 border border-red-700 px-1.5 py-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> HIT
                    </span>
                  ) : null}
                  {row.accepted === 1 ? (
                    <CheckCircle className="w-3 h-3 text-green-500" aria-label="Accepted" />
                  ) : row.accepted === 0 && row.review_status !== 'needs_review' ? (
                    <XCircle className="w-3 h-3 text-red-500" aria-label="Rejected" />
                  ) : null}
                  {chip && (
                    <span className={`text-[9px] border px-1.5 py-0.5 ${chip.cls}`}>{chip.label}</span>
                  )}
                </div>

                {/* Vehicle summary */}
                <div className="text-[11px] text-rmpg-400">
                  {[row.year, row.make, row.model, row.color, row.vehicle_type]
                    .filter(Boolean).join(' · ') || 'No vehicle details'}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-3 text-[10px] text-rmpg-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTs(row.created_at)}
                  </span>
                  {row.confidence != null && (
                    <span>{Math.round(row.confidence * 100)}% conf</span>
                  )}
                  {row.vehicle_count != null && row.vehicle_count > 1 && (
                    <span className="flex items-center gap-0.5">
                      <Car className="w-3 h-3" /> {row.vehicle_count} vehicles
                    </span>
                  )}
                  {row.call_id && (
                    <Link
                      to={`/dispatch?call_id=${row.call_id}`}
                      className="flex items-center gap-0.5 text-brand-400 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MapPin className="w-3 h-3" /> Call #{row.call_id}
                    </Link>
                  )}
                </div>

                {/* Expanded detail */}
                {isSelected && (
                  <div className="pt-2 border-t border-border-default space-y-1">
                    {row.damage_observed ? (
                      <p className="text-[10px] text-amber-400">
                        ⚠ Damage observed{row.damage_summary ? ` — ${row.damage_summary}` : ''}
                      </p>
                    ) : null}
                    {row.condition && (
                      <p className="text-[10px] text-rmpg-400">Condition: {row.condition}</p>
                    )}
                    {row.enrich_status && (
                      <p className="text-[10px] text-rmpg-500">Enrich: {row.enrich_status}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      {row.plate && (
                        <Link
                          to={`/intel/plate-log?plate=${encodeURIComponent(row.plate)}`}
                          className="text-[10px] text-brand-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View dossier →
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scan modal */}
      {showScanModal && (
        <PlateScanModal
          onClose={() => setShowScanModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
