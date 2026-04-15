import React, { useMemo } from 'react';
import {
  Fuel, DollarSign, Gauge, Plus, MapPin, Calendar, Pencil, Trash2,
  TrendingUp, TrendingDown, Route, AlertTriangle, Paperclip, Upload, Download, FileText,
  Target, Settings,
} from 'lucide-react';
import type { FleetFuelLog, FleetFuelSummary, FuelType, FleetFuelBudgetSummary } from '../../../types';
import { formatMilitary } from '../utils/fleetFormatters';

// ── Period filter ─────────────────────────────────────────────
//
// Stable string IDs the parent stores in URL/local state; Q1–Q4 are scoped
// to the CURRENT calendar year. "this_q" / "last_q" are computed at the
// moment getPeriodBounds() runs so they roll forward with the calendar.
export type FuelPeriod =
  | 'all'
  | 'mtd'
  | '30d' | '60d' | '90d'
  | 'this_q' | 'last_q'
  | 'q1' | 'q2' | 'q3' | 'q4';

export interface FuelPeriodBounds {
  start: Date | null;  // inclusive lower bound, null = open-ended back
  end: Date | null;    // exclusive upper bound, null = open-ended forward
  label: string;       // human-readable for UI + PDF header
  shortLabel: string;  // one-word for inline use
}

export function getFuelPeriodBounds(period: FuelPeriod, asOf: Date = new Date()): FuelPeriodBounds {
  const y = asOf.getFullYear();
  const m = asOf.getMonth(); // 0-11
  const fmt = (d: Date | null) => d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '—';
  const daysAgo = (n: number) => {
    const d = new Date(asOf);
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const startOfMonth = (yr: number, mo: number) => new Date(yr, mo, 1, 0, 0, 0, 0);

  switch (period) {
    case 'all':
      return { start: null, end: null, label: 'All Time', shortLabel: 'All' };
    case 'mtd': {
      const start = startOfMonth(y, m);
      return { start, end: asOf, label: `Month-to-Date (${fmt(start)} to ${fmt(asOf)})`, shortLabel: 'MTD' };
    }
    case '30d':
      return { start: daysAgo(30), end: asOf, label: `Last 30 Days (${fmt(daysAgo(30))} to ${fmt(asOf)})`, shortLabel: '30d' };
    case '60d':
      return { start: daysAgo(60), end: asOf, label: `Last 60 Days (${fmt(daysAgo(60))} to ${fmt(asOf)})`, shortLabel: '60d' };
    case '90d':
      return { start: daysAgo(90), end: asOf, label: `Last 90 Days (${fmt(daysAgo(90))} to ${fmt(asOf)})`, shortLabel: '90d' };
    case 'this_q': {
      const qStart = Math.floor(m / 3) * 3;
      const start = startOfMonth(y, qStart);
      const end = startOfMonth(y, qStart + 3);
      const qNum = Math.floor(m / 3) + 1;
      return { start, end, label: `Q${qNum} ${y} (${fmt(start)} to ${fmt(end)})`, shortLabel: `Q${qNum} ${y}` };
    }
    case 'last_q': {
      const qIdx = Math.floor(m / 3) - 1;        // -1 if currently in Q1
      const qY = qIdx < 0 ? y - 1 : y;
      const qStart = qIdx < 0 ? 9 : qIdx * 3;
      const start = startOfMonth(qY, qStart);
      const end = startOfMonth(qY, qStart + 3);
      const qNum = qIdx < 0 ? 4 : qIdx + 1;
      return { start, end, label: `Q${qNum} ${qY} (${fmt(start)} to ${fmt(end)})`, shortLabel: `Q${qNum} ${qY}` };
    }
    case 'q1':
    case 'q2':
    case 'q3':
    case 'q4': {
      const qNum = parseInt(period.slice(1), 10);
      const qStart = (qNum - 1) * 3;
      const start = startOfMonth(y, qStart);
      const end = startOfMonth(y, qStart + 3);
      return { start, end, label: `Q${qNum} ${y} (${fmt(start)} to ${fmt(end)})`, shortLabel: `Q${qNum} ${y}` };
    }
  }
}

export function filterLogsByPeriod(logs: FleetFuelLog[], period: FuelPeriod): FleetFuelLog[] {
  const bounds = getFuelPeriodBounds(period);
  if (!bounds.start && !bounds.end) return logs;
  return logs.filter((l) => {
    if (!l.fuel_date) return false;
    // The DB stores fuel_date as a local timestamp string; new Date() parses
    // it as local time on most modern browsers. Comparing against bounds
    // (also constructed in local time) keeps the filter consistent.
    const d = new Date(l.fuel_date);
    if (isNaN(d.getTime())) return false;
    if (bounds.start && d < bounds.start) return false;
    if (bounds.end && d >= bounds.end) return false;
    return true;
  });
}

const PERIOD_OPTIONS: { value: FuelPeriod; label: string }[] = [
  { value: 'all',    label: 'All Time' },
  { value: 'mtd',    label: 'Month-to-Date' },
  { value: '30d',    label: 'Last 30 Days' },
  { value: '60d',    label: 'Last 60 Days' },
  { value: '90d',    label: 'Last 90 Days' },
  { value: 'this_q', label: 'This Quarter' },
  { value: 'last_q', label: 'Last Quarter' },
  { value: 'q1',     label: 'Q1 (current year)' },
  { value: 'q2',     label: 'Q2 (current year)' },
  { value: 'q3',     label: 'Q3 (current year)' },
  { value: 'q4',     label: 'Q4 (current year)' },
];

/** Budget status → bar + text color. Mirrors the server's status field. */
function budgetColor(status?: string): { bar: string; text: string; ring: string } {
  switch (status) {
    case 'over':     return { bar: 'bg-red-600', text: 'text-red-400', ring: 'border-red-700/40' };
    case 'warning':  return { bar: 'bg-amber-500', text: 'text-amber-400', ring: 'border-amber-700/40' };
    case 'watch':    return { bar: 'bg-yellow-500', text: 'text-yellow-400', ring: 'border-yellow-700/40' };
    case 'on_track': return { bar: 'bg-green-500', text: 'text-green-400', ring: 'border-green-700/40' };
    default:         return { bar: 'bg-gray-500', text: 'text-gray-400', ring: 'border-gray-700/40' };
  }
}

/** Budget summary panel — shows current-period spend, bar, and forecast. */
function BudgetCard({
  budgetSummary, onOpenBudgetModal, onPrintVariance,
}: {
  budgetSummary: FleetFuelBudgetSummary | null;
  onOpenBudgetModal: () => void;
  onPrintVariance?: () => void;
}) {
  if (!budgetSummary) return null;
  if (!budgetSummary.has_budget) {
    return (
      <div className="panel-beveled p-2.5 bg-surface-sunken flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-rmpg-500" />
          <div>
            <div className="text-[10px] font-bold text-rmpg-400">No Budget Set</div>
            <div className="text-[9px] text-rmpg-600">Track spend against a monthly, quarterly, or annual budget</div>
          </div>
        </div>
        <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px]" onClick={onOpenBudgetModal}>
          <Plus className="w-3 h-3" /> Set Budget
        </button>
      </div>
    );
  }
  const { budget, period, spend, status } = budgetSummary;
  if (!budget || !period || !spend) return null;
  const color = budgetColor(status);
  const pct = Math.min(100, Math.max(0, spend.pct_of_budget));
  const overage = spend.pct_of_budget > 100 ? spend.pct_of_budget - 100 : 0;
  return (
    <div className={`panel-beveled p-3 bg-surface-sunken border ${color.ring}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${color.text}`} />
          <div>
            <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              {budget.period_type} Budget
              {budget.vehicle_id ? <span className="ml-1 text-[8px] text-rmpg-500">(this vehicle)</span>
                                 : <span className="ml-1 text-[8px] text-rmpg-500">(fleet-wide)</span>}
            </div>
            <div className="text-[9px] text-rmpg-500 font-mono">{period.start} → {period.end} ({period.days_elapsed} of {period.days_total} days)</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onPrintVariance && (
            <button type="button" className="toolbar-btn text-[9px]" onClick={onPrintVariance} title="Print budget variance report">
              <FileText className="w-3 h-3" /> Variance PDF
            </button>
          )}
          <button type="button" className="toolbar-btn text-[9px]" onClick={onOpenBudgetModal} title="Edit budget">
            <Settings className="w-3 h-3" /> Manage
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative w-full h-3 bg-surface-base rounded-sm overflow-hidden border border-rmpg-800 mb-1">
        <div className={`absolute top-0 left-0 h-full ${color.bar} transition-all duration-500`}
          style={{ width: `${pct}%` }} />
        {/* Threshold marker */}
        <div className="absolute top-0 h-full w-px bg-amber-600"
          style={{ left: `${Math.min(100, budget.alert_threshold_pct)}%` }}
          title={`Alert threshold: ${budget.alert_threshold_pct}%`} />
      </div>

      <div className="flex items-center justify-between text-[9px] font-mono tabular-nums">
        <span className="text-rmpg-400">
          <span className={`font-bold ${color.text}`}>${spend.actual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-rmpg-500"> of </span>
          <span className="text-rmpg-300">${budget.budget_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={`ml-1 ${color.text}`}>({spend.pct_of_budget.toFixed(1)}%{overage > 0 ? ` — ${overage.toFixed(1)}% over` : ''})</span>
        </span>
        <span className="text-rmpg-500">
          Forecast: <span className={`font-bold ${color.text}`}>${spend.forecast.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={`ml-1 ${color.text}`}>
            ({spend.variance_pct > 0 ? '+' : ''}{spend.variance_pct.toFixed(1)}% vs budget)
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between text-[8px] text-rmpg-600 mt-0.5">
        <span>Burn rate: ${spend.daily_rate.toFixed(2)}/day</span>
        <span>{period.days_remaining} days remaining</span>
      </div>
    </div>
  );
}

/** Parse the JSON-encoded `flags` column into a plain string[] for display. */
function parseFlags(flagsRaw: string | null | undefined): string[] {
  if (!flagsRaw) return [];
  try { const arr = JSON.parse(flagsRaw); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

/**
 * Parse a natural-language quick-log string. Designed to be forgiving —
 * an officer at the pump types something like:
 *   "20.5g $68.50 Shell Main St"
 *   "12.345 gal 3.299/gal Maverik @ 76410"
 *   "8 gallons total $24.16 Costco"
 *
 * Returns a structured payload or null when we can't even find a
 * gallons number (which is required for any save). Any field can be
 * undefined; the caller decides how to treat missing values.
 */
export function parseQuickLog(input: string): {
  gallons: number;
  total_cost?: number;
  cost_per_gallon?: number;
  station?: string;
  odometer_reading?: number;
} | null {
  if (!input || !input.trim()) return null;
  let s = ' ' + input.trim() + ' ';

  // 1. Gallons — first numeric run that's followed by g, gal, gallons
  const galMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:gal(?:lons?)?|g)\b/i);
  if (!galMatch) return null;
  const gallons = parseFloat(galMatch[1]);
  if (!isFinite(gallons) || gallons <= 0) return null;
  s = s.replace(galMatch[0], ' ');

  // 2. Cost-per-gallon — "$3.29/gal" or "3.299 ppg" patterns
  let cost_per_gallon: number | undefined;
  const cpgMatch = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*gal|ppg|per\s*gal)/i);
  if (cpgMatch) {
    cost_per_gallon = parseFloat(cpgMatch[1]);
    s = s.replace(cpgMatch[0], ' ');
  }

  // 3. Total cost — first remaining $-prefixed number (or trailing "total $X")
  let total_cost: number | undefined;
  const totalMatch = s.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (totalMatch) {
    total_cost = parseFloat(totalMatch[1]);
    s = s.replace(totalMatch[0], ' ');
  }

  // 4. Odometer — "@ 76410" or "odo 76410" patterns; plain bare numbers are
  //    too ambiguous so we only accept tagged values.
  let odometer_reading: number | undefined;
  const odoMatch = s.match(/(?:@|odo|odometer|mi)\s*(\d{4,7})/i);
  if (odoMatch) {
    odometer_reading = parseInt(odoMatch[1], 10);
    s = s.replace(odoMatch[0], ' ');
  }

  // 5. Station — whatever's left, trimmed of obvious filler words. Empty
  //    string becomes undefined so the form leaves it blank.
  const station = s
    .replace(/\b(at|from|paid|cost|total|cash|card)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    gallons,
    total_cost,
    cost_per_gallon,
    station: station || undefined,
    odometer_reading,
  };
}

/** Inline single-line quick-log bar — saves directly without opening the modal. */
function QuickLogBar({ onSubmit }: { onSubmit: (parsed: ReturnType<typeof parseQuickLog>) => Promise<void> | void }) {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const parsed = useMemo(() => parseQuickLog(text), [text]);

  const submit = async () => {
    if (!parsed) { setError('Need at least gallons (e.g. "20g") to save'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit(parsed);
      setText('');
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center gap-2">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider whitespace-nowrap">Quick Log</span>
        <input
          className="input-dark flex-1 text-[11px] font-mono py-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "20.5g $68.50 Shell Main St" or "12 gal $3.299/gal Maverik @ 76410"'
          onKeyDown={(e) => { if (e.key === 'Enter' && parsed && !busy) submit(); }}
          disabled={busy}
        />
        <button
          type="button"
          className="toolbar-btn-primary text-[10px] py-1 px-3 disabled:opacity-50"
          onClick={submit}
          disabled={!parsed || busy}
          title={!parsed ? 'Type at least a gallons amount (e.g. "20g")' : 'Save now (Enter)'}
        >
          {busy ? '…' : 'Save'}
        </button>
      </div>
      {/* Live preview of what got parsed */}
      {parsed && (
        <div className="mt-1 text-[9px] font-mono text-rmpg-500 flex flex-wrap gap-3">
          <span><span className="text-rmpg-400">Gal:</span> <span className="text-cyan-400">{parsed.gallons.toFixed(3)}</span></span>
          {parsed.total_cost != null && <span><span className="text-rmpg-400">Total:</span> <span className="text-green-400">${parsed.total_cost.toFixed(2)}</span></span>}
          {parsed.cost_per_gallon != null && <span><span className="text-rmpg-400">$/Gal:</span> <span className="text-amber-400">${parsed.cost_per_gallon.toFixed(3)}</span></span>}
          {parsed.station && <span><span className="text-rmpg-400">Station:</span> <span className="text-rmpg-300">{parsed.station}</span></span>}
          {parsed.odometer_reading != null && <span><span className="text-rmpg-400">Odo:</span> <span className="text-rmpg-300">{parsed.odometer_reading.toLocaleString()}</span></span>}
        </div>
      )}
      {error && <div className="mt-1 text-[9px] text-red-400">{error}</div>}
    </div>
  );
}

/** Drag-drop zone for receipt files. Highlights on hover, calls `onDrop`
 *  when the user releases a file. Text-only fallback for click. */
function ReceiptDropZone({ onDrop }: { onDrop: (file: File) => Promise<void> | void }) {
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setError('');
    setBusy(true);
    try {
      await onDrop(f);
    } catch (e: any) {
      setError(e?.message || 'Drop failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`panel-beveled p-2 border-dashed transition-colors ${over ? 'border-brand-500 bg-brand-900/20' : 'border-rmpg-700 bg-surface-sunken'}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
    >
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <div className="flex items-center gap-2">
          <Paperclip className={`w-3 h-3 ${over ? 'text-brand-400' : 'text-rmpg-500'}`} />
          <span className={over ? 'text-brand-300' : 'text-rmpg-400'}>
            {busy ? 'Attaching to most recent fill...' : 'Drop a receipt here to attach to the most recent fill'}
          </span>
        </div>
        <button type="button" className="toolbar-btn text-[9px]"
          onClick={() => inputRef.current?.click()} disabled={busy}>
          Browse
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            if (inputRef.current) inputRef.current.value = '';
          }}
        />
      </div>
      {error && <div className="mt-1 text-[9px] text-red-400">{error}</div>}
    </div>
  );
}

/** Receipt gallery — thumbnails for image receipts, icon for PDFs.
 *  Uses the existing ?token= streaming URL so unsigned <img> elements work. */
function ReceiptGallery({ logs, authToken }: { logs: FleetFuelLog[]; authToken: string | null }) {
  const withReceipt = logs.filter(l => l.receipt_path);
  if (withReceipt.length === 0) return null;
  const url = (id: string | number) => authToken
    ? `${window.location.origin}/api/fleet/fuel/${id}/receipt?token=${encodeURIComponent(authToken)}`
    : '';
  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider flex items-center gap-1">
          <Paperclip className="w-2.5 h-2.5" /> Receipts ({withReceipt.length})
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {withReceipt.map((log) => {
          const u = url(log.id);
          const isPdf = !!log.receipt_path && /\.pdf$/i.test(log.receipt_path);
          return (
            <a key={log.id} href={u} target="_blank" rel="noopener noreferrer"
              className="block panel-beveled bg-surface-base border border-rmpg-700 hover:border-brand-500 transition-colors group"
              title={`${log.fuel_date} — ${log.gallons.toFixed(2)} gal${log.total_cost != null ? ` — $${log.total_cost.toFixed(2)}` : ''}`}>
              <div className="aspect-square w-full bg-black flex items-center justify-center overflow-hidden">
                {isPdf ? (
                  <div className="flex flex-col items-center gap-0.5 text-rmpg-500 group-hover:text-brand-400">
                    <FileText className="w-5 h-5" />
                    <span className="text-[7px]">PDF</span>
                  </div>
                ) : u ? (
                  <img src={u} alt="receipt" className="w-full h-full object-cover" />
                ) : (
                  <Paperclip className="w-4 h-4 text-rmpg-500" />
                )}
              </div>
              <div className="px-1 py-0.5 text-[7px] font-mono text-center text-rmpg-500 truncate">
                {log.fuel_date.slice(5, 10)}{log.total_cost != null ? ` · $${log.total_cost.toFixed(0)}` : ''}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** Human-readable short label for a flag code, used on the badge + tooltip. */
function flagLabel(flag: string): { short: string; tooltip: string } {
  const [code] = flag.split(':');
  switch (code) {
    case 'tank-overflow':    return { short: 'TANK', tooltip: `Gallons exceed tank capacity: ${flag}` };
    case 'price-spike':      return { short: 'PRICE', tooltip: `Price anomaly: ${flag}` };
    case 'mpg-anomaly':      return { short: 'MPG',   tooltip: `MPG outlier: ${flag}` };
    case 'rapid-duplicate':  return { short: 'DUP',   tooltip: `Rapid duplicate fill: ${flag}` };
    default:                 return { short: '?',     tooltip: flag };
  }
}

const FUEL_TYPE_BADGE: Record<FuelType, { bg: string; text: string; border: string }> = {
  regular: { bg: 'bg-rmpg-800', text: 'text-rmpg-300', border: 'border-rmpg-600' },
  premium: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-700/40' },
  diesel: { bg: 'bg-gray-900/30', text: 'text-gray-400', border: 'border-gray-700/40' },
};

function mpgColor(mpg: number | null | undefined): string {
  if (mpg == null) return 'text-rmpg-500';
  if (mpg > 20) return 'text-green-400';
  if (mpg >= 15) return 'text-amber-400';
  return 'text-red-400';
}

function mpgBgColor(mpg: number | null | undefined): string {
  if (mpg == null) return 'bg-rmpg-800/50';
  if (mpg > 20) return 'bg-green-900/20';
  if (mpg >= 15) return 'bg-amber-900/20';
  return 'bg-red-900/20';
}

/** Tiny SVG sparkline for MPG trend */
function MpgSparkline({ logs }: { logs: FleetFuelLog[] }) {
  // Get last 20 entries with MPG in chronological order (oldest first)
  const withMpg = [...logs]
    .filter(l => l.mpg != null && l.mpg! > 0)
    .reverse()
    .slice(-20);

  if (withMpg.length < 2) return null;

  const values = withMpg.map(l => l.mpg!);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const w = 320;
  const h = 40;
  const padding = 2;
  const usableH = h - padding * 2;
  const usableW = w - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * usableW;
    const y = padding + usableH - ((v - min) / range) * usableH;
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding},${h - padding}`,
    ...points,
    `${padding + usableW},${h - padding}`,
  ].join(' ');

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const avgY = padding + usableH - ((avg - min) / range) * usableH;

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">MPG Trend (Last {values.length} Fills)</span>
        <div className="flex items-center gap-3 text-[8px] text-rmpg-500">
          <span>Low: <span className={`font-mono font-bold ${mpgColor(min)}`}>{min.toFixed(1)}</span></span>
          <span>Avg: <span className="font-mono font-bold text-brand-400">{avg.toFixed(1)}</span></span>
          <span>High: <span className={`font-mono font-bold ${mpgColor(max)}`}>{max.toFixed(1)}</span></span>
        </div>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        {/* Area fill */}
        <polygon points={areaPoints} fill="rgba(136,136,136,0.15)" />
        {/* Average line */}
        <line x1={padding} y1={avgY} x2={padding + usableW} y2={avgY} stroke="rgba(212,160,23,0.3)" strokeWidth="0.5" strokeDasharray="3,3" />
        {/* Trend line */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#888888"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Data points */}
        {values.map((v, i) => {
          const x = padding + (i / (values.length - 1)) * usableW;
          const y = padding + usableH - ((v - min) / range) * usableH;
          const color = v > 20 ? '#4ade80' : v >= 15 ? '#fbbf24' : '#f87171';
          return <circle key={i} cx={x} cy={y} r="2" fill={color} />;
        })}
      </svg>
    </div>
  );
}

/** 12-month cost+gallons bar chart. Groups entries by YYYY-MM and shows a
 *  dual-axis-feel via a green gallons bar and an amber cost bar per month.
 *  Skipped when there aren't at least 2 months of data (the stats cards
 *  already cover the single-month case). */
function MonthlyCostChart({ logs }: { logs: FleetFuelLog[] }) {
  const buckets = useMemo(() => {
    const m: Record<string, { month: string; cost: number; gallons: number }> = {};
    for (const l of logs) {
      if (!l.fuel_date) continue;
      const month = l.fuel_date.substring(0, 7); // YYYY-MM
      if (!m[month]) m[month] = { month, cost: 0, gallons: 0 };
      m[month].cost += Number(l.total_cost) || 0;
      m[month].gallons += Number(l.gallons) || 0;
    }
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [logs]);

  if (buckets.length < 2) return null;

  const maxCost = Math.max(...buckets.map(b => b.cost), 1);
  const maxGal = Math.max(...buckets.map(b => b.gallons), 1);
  const barW = 100 / buckets.length;

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Monthly Fuel Consumption ({buckets.length}mo)</span>
        <div className="flex items-center gap-3 text-[8px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-400"></span><span className="text-rmpg-500">Gallons</span></span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400"></span><span className="text-rmpg-500">Cost</span></span>
        </div>
      </div>
      <div className="relative h-16 flex items-end gap-0.5">
        {buckets.map((b) => {
          const galH = (b.gallons / maxGal) * 100;
          const costH = (b.cost / maxCost) * 100;
          return (
            <div key={b.month} className="flex-1 flex flex-col items-center justify-end h-full gap-px" title={`${b.month}: ${b.gallons.toFixed(1)} gal, $${b.cost.toFixed(2)}`}>
              <div className="w-full flex items-end justify-center gap-0.5 h-full">
                <div className="bg-cyan-600/60 w-1/2 border-t border-cyan-400" style={{ height: `${galH}%`, minHeight: '1px' }} />
                <div className="bg-amber-600/60 w-1/2 border-t border-amber-400" style={{ height: `${costH}%`, minHeight: '1px' }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 mt-0.5">
        {buckets.map((b) => (
          <div key={b.month} className="flex-1 text-center text-[7px] font-mono text-rmpg-600 tracking-tighter" style={{ width: `${barW}%` }}>
            {b.month.slice(5)}/{b.month.slice(2, 4)}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  fuelLogs: FleetFuelLog[];
  summary: FleetFuelSummary | null;
  onAddFuel: () => void;
  onEditFuel?: (log: FleetFuelLog) => void;
  onDeleteFuel?: (log: FleetFuelLog) => void;
  /** New in 2026-04-14: CSV import, CSV export, and PDF report hooks. */
  onImportCsv?: () => void;
  onExportCsv?: () => void;
  onDownloadReport?: () => void;
  /** Vehicle ID scope — used for receipt-download URLs. Optional so the tab
   *  keeps rendering cleanly even on a "fleet-wide" view in the future. */
  vehicleId?: number | string | null;
  /** v2: budget summary + open-manage-budget hook. null/undefined hides the card. */
  budgetSummary?: FleetFuelBudgetSummary | null;
  onManageBudget?: () => void;
  /** v3 printables / UX additions — all optional so legacy callers stay valid. */
  onPrintBudgetVariance?: () => void;
  onPrintFlaggedAudit?: () => void;
  onQuickLog?: (parsed: { gallons: number; total_cost?: number; cost_per_gallon?: number; station?: string; odometer_reading?: number }) => Promise<void> | void;
  onReceiptDropped?: (file: File) => Promise<void> | void;
  /**
   * v4 (2026-04-14): period selector. Lifted to the parent so the same
   * choice can be threaded into the PDF-report generator. When the parent
   * doesn't pass these props, the tab falls back to its own internal state
   * so legacy callers keep working unchanged.
   */
  period?: FuelPeriod;
  onPeriodChange?: (p: FuelPeriod) => void;
}

export default function FleetFuelTab({
  fuelLogs, summary, onAddFuel, onEditFuel, onDeleteFuel,
  onImportCsv, onExportCsv, onDownloadReport,
  budgetSummary, onManageBudget,
  onPrintBudgetVariance, onPrintFlaggedAudit, onQuickLog, onReceiptDropped,
  period: periodProp, onPeriodChange,
}: Props) {
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('rmpg_token') : null;
  // Internal fallback state so the tab still works when the parent doesn't
  // hand us a controlled period prop (older callers / standalone testing).
  const [internalPeriod, setInternalPeriod] = React.useState<FuelPeriod>('all');
  const period = periodProp ?? internalPeriod;
  const setPeriod = (p: FuelPeriod) => {
    setInternalPeriod(p);
    onPeriodChange?.(p);
  };

  // Filter the visible entry list + recompute period-scoped roll-ups.
  // Everything below the period selector reads from `filteredLogs` instead
  // of the raw `fuelLogs`, except the all-time MPG sparkline + monthly
  // chart, which deliberately keep showing the full history (a 7-day
  // sparkline isn't useful).
  const periodBounds = useMemo(() => getFuelPeriodBounds(period), [period]);
  const filteredLogs = useMemo(() => filterLogsByPeriod(fuelLogs, period), [fuelLogs, period]);
  const periodSummary = useMemo(() => {
    const totalGallons = filteredLogs.reduce((s, l) => s + (Number(l.gallons) || 0), 0);
    const totalCost    = filteredLogs.reduce((s, l) => s + (Number(l.total_cost) || 0), 0);
    return {
      log_count: filteredLogs.length,
      total_gallons: totalGallons,
      total_cost: totalCost,
      avg_cpg: totalGallons > 0 ? totalCost / totalGallons : null,
    };
  }, [filteredLogs]);
  const flaggedCount = useMemo(() => filteredLogs.filter(l => parseFlags(l.flags).length > 0).length, [filteredLogs]);
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Summary Stats — Top Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Fuel className="w-3.5 h-3.5 mx-auto text-cyan-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-cyan-400">
            {summary ? summary.total_gallons.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Gallons</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-green-400">
            ${summary ? summary.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Cost</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Gauge className="w-3.5 h-3.5 mx-auto text-brand-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-brand-400">
            {summary?.avg_mpg != null ? summary.avg_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-amber-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-amber-400">
            ${summary ? summary.avg_cost_per_gallon.toFixed(3) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Avg $/Gal</div>
        </div>
      </div>

      {/* Summary Stats — Second Row (efficiency details) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <Route className="w-3.5 h-3.5 mx-auto text-gray-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-gray-400">
            {summary?.total_distance != null ? summary.total_distance.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Total Miles</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-purple-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-purple-400">
            {summary?.cost_per_mile != null ? `$${summary.cost_per_mile.toFixed(3)}` : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Cost/Mile</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <TrendingUp className="w-3.5 h-3.5 mx-auto text-green-400 mb-1" />
          <div className={`text-sm font-bold font-mono tabular-nums ${mpgColor(summary?.best_mpg)}`}>
            {summary?.best_mpg != null ? summary.best_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Best MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <TrendingDown className="w-3.5 h-3.5 mx-auto text-red-400 mb-1" />
          <div className={`text-sm font-bold font-mono tabular-nums ${mpgColor(summary?.worst_mpg)}`}>
            {summary?.worst_mpg != null ? summary.worst_mpg.toFixed(1) : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">Worst MPG</div>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-sunken">
          <DollarSign className="w-3.5 h-3.5 mx-auto text-orange-400 mb-1" />
          <div className="text-sm font-bold font-mono tabular-nums text-orange-400">
            {summary?.fuel_cost_per_day != null ? `$${summary.fuel_cost_per_day.toFixed(2)}` : '-'}
          </div>
          <div className="text-[7px] text-rmpg-500 uppercase">$/Day</div>
        </div>
      </div>

      {/* Quick-entry rail — appears at the top of the tab so officers can
          log a fill in one keystroke without opening the full modal. Only
          rendered when the page wired an onQuickLog callback. */}
      {onQuickLog && (
        <QuickLogBar onSubmit={async (parsed) => { if (parsed) await onQuickLog(parsed); }} />
      )}

      {/* Drag-drop a receipt → attaches to the most-recent fill. Helpful
          when an officer scans a stack of receipts after a shift. */}
      {onReceiptDropped && (
        <ReceiptDropZone onDrop={onReceiptDropped} />
      )}

      {/* Budget card — only shown when a scope-specific budget exists or
          when the caller wires a "set budget" callback for creation. */}
      {onManageBudget && (
        <BudgetCard
          budgetSummary={budgetSummary ?? null}
          onOpenBudgetModal={onManageBudget}
          onPrintVariance={onPrintBudgetVariance}
        />
      )}

      {/* MPG Sparkline + Monthly Cost Chart */}
      <MpgSparkline logs={fuelLogs} />
      <MonthlyCostChart logs={fuelLogs} />

      {/* Receipt gallery — small thumbnail grid of every attached receipt
          for fast visual browsing / audit prep. */}
      <ReceiptGallery logs={fuelLogs} authToken={authToken} />

      {/* Period selector + period roll-up — drives the entry list,
          the flagged-audit count, and the PDF report scope. */}
      <div className="panel-beveled bg-surface-sunken p-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <label className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider whitespace-nowrap flex items-center gap-1">
            <Calendar className="w-2.5 h-2.5" /> Period
          </label>
          <select
            className="select-dark text-[10px] py-1 px-2 min-h-[30px]"
            value={period}
            onChange={(e) => setPeriod(e.target.value as FuelPeriod)}
            aria-label="Period filter"
          >
            {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-[9px] font-mono text-rmpg-500 hidden sm:inline">{periodBounds.label}</span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono tabular-nums">
          <span><span className="text-rmpg-500">Entries:</span> <span className="text-cyan-400 font-bold">{periodSummary.log_count}</span></span>
          <span><span className="text-rmpg-500">Gal:</span> <span className="text-cyan-400 font-bold">{periodSummary.total_gallons.toFixed(1)}</span></span>
          <span><span className="text-rmpg-500">Cost:</span> <span className="text-green-400 font-bold">${periodSummary.total_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
          {periodSummary.avg_cpg != null && (
            <span><span className="text-rmpg-500">Avg $/Gal:</span> <span className="text-amber-400 font-bold">${periodSummary.avg_cpg.toFixed(3)}</span></span>
          )}
        </div>
      </div>

      {/* Action Bar — Add / Import / Export / Report ───────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Fuel className="w-3 h-3" /> Fuel Log ({filteredLogs.length}{period !== 'all' && fuelLogs.length !== filteredLogs.length ? ` of ${fuelLogs.length}` : ''})
        </h3>
        <div className="flex items-center gap-1.5 print:hidden">
          {onImportCsv && (
            <button type="button" className="toolbar-btn" onClick={onImportCsv} title="Import CSV from fuel card statement">
              <Upload className="w-3 h-3" /> Import CSV
            </button>
          )}
          {onExportCsv && filteredLogs.length > 0 && (
            <button type="button" className="toolbar-btn" onClick={onExportCsv} title="Download fuel logs as CSV">
              <Download className="w-3 h-3" /> Export CSV
            </button>
          )}
          {onDownloadReport && filteredLogs.length > 0 && (
            <button type="button" className="toolbar-btn" onClick={onDownloadReport} title={`Download PDF fuel report for ${periodBounds.shortLabel}`}>
              <FileText className="w-3 h-3" /> Report ({periodBounds.shortLabel})
            </button>
          )}
          {onPrintFlaggedAudit && flaggedCount > 0 && (
            <button type="button" className="toolbar-btn"
              onClick={onPrintFlaggedAudit}
              title={`Audit PDF for ${flaggedCount} flagged ${flaggedCount === 1 ? 'entry' : 'entries'}`}>
              <AlertTriangle className="w-3 h-3 text-amber-400" /> Audit ({flaggedCount})
            </button>
          )}
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={onAddFuel}>
            <Plus className="w-3 h-3" /> Add Fuel Log
          </button>
        </div>
      </div>

      {/* Fuel Log List */}
      {filteredLogs.length === 0 ? (
        <div className="text-center py-12 panel-beveled bg-surface-base">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#050505' }}>
            <Fuel className="w-8 h-8 text-rmpg-600" />
          </div>
          {fuelLogs.length === 0 ? (
            <>
              <p className="text-xs text-rmpg-400 font-semibold">No Fuel Logs Recorded</p>
              <p className="text-[10px] text-rmpg-600 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
                Track fuel consumption, cost per gallon, and station visits to monitor fleet fuel efficiency.
              </p>
              <button type="button" className="toolbar-btn toolbar-btn-primary mt-3" onClick={onAddFuel}>
                <Plus className="w-3 h-3" /> Log First Entry
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-rmpg-400 font-semibold">No entries in {periodBounds.shortLabel}</p>
              <p className="text-[10px] text-rmpg-600 mt-1.5 max-w-[280px] mx-auto leading-relaxed">
                {fuelLogs.length} total entries fall outside this period — switch back to "All Time" to see them.
              </p>
              <button type="button" className="toolbar-btn mt-3" onClick={() => setPeriod('all')}>
                Show All Time
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredLogs.map((log) => {
            const badge = FUEL_TYPE_BADGE[log.fuel_type] || FUEL_TYPE_BADGE.regular;
            const dist = log.calc_distance ?? log.distance ?? null;
            const flags = parseFlags(log.flags);
            const hasReceipt = !!log.receipt_path;
            // Auth-token-in-query so <a>/<img> elements without custom headers
            // can still fetch the authenticated receipt stream.
            const receiptUrl = hasReceipt && authToken
              ? `${window.location.origin}/api/fleet/fuel/${log.id}/receipt?token=${encodeURIComponent(authToken)}`
              : null;
            return (
              <div key={log.id} className={`panel-beveled p-2.5 flex items-center gap-3 ${flags.length > 0 ? 'bg-amber-900/10 border border-amber-700/30' : 'bg-surface-base'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-sm flex items-center justify-center ${flags.length > 0 ? 'bg-amber-900/30 border border-amber-700/40' : 'bg-cyan-900/20 border border-cyan-700/40'}`}>
                  <Fuel className={`w-4 h-4 ${flags.length > 0 ? 'text-amber-400' : 'text-cyan-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-rmpg-200 font-mono font-bold">
                      {log.gallons.toFixed(3)} gal
                    </span>
                    <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${badge.bg} ${badge.text} ${badge.border}`}>
                      {log.fuel_type}
                    </span>
                    {log.total_cost != null && (
                      <span className="text-[10px] text-green-400 font-mono">${log.total_cost.toFixed(2)}</span>
                    )}
                    {/* MPG badge */}
                    {log.mpg != null && (
                      <span className={`px-1.5 py-0.5 text-[9px] font-bold font-mono tabular-nums border rounded-sm ${mpgBgColor(log.mpg)} ${mpgColor(log.mpg)} border-current/20`}>
                        {log.mpg.toFixed(1)} MPG
                      </span>
                    )}
                    {/* Cost per mile */}
                    {log.cost_per_mile != null && (
                      <span className="px-1 py-0.5 text-[8px] font-mono tabular-nums text-purple-400 bg-purple-900/20 border border-purple-700/30">
                        ${log.cost_per_mile.toFixed(3)}/mi
                      </span>
                    )}
                    {/* Distance */}
                    {dist != null && dist > 0 && (
                      <span className="text-[9px] font-mono tabular-nums text-gray-400">
                        {dist.toFixed(1)} mi
                      </span>
                    )}
                    {/* Flag badges — one chip per distinct flag code */}
                    {flags.map((flag, idx) => {
                      const { short, tooltip } = flagLabel(flag);
                      return (
                        <span key={idx}
                          className="px-1 py-0.5 text-[8px] font-bold uppercase bg-amber-900/30 text-amber-300 border border-amber-700/40 flex items-center gap-0.5"
                          title={tooltip}>
                          <AlertTriangle className="w-2.5 h-2.5" />{short}
                        </span>
                      );
                    })}
                    {/* Receipt link — opens inline via token-in-query */}
                    {receiptUrl && (
                      <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
                        className="px-1 py-0.5 text-[8px] font-bold uppercase text-cyan-400 bg-cyan-900/20 border border-cyan-700/40 flex items-center gap-0.5 hover:text-brand-400"
                        title="View receipt">
                        <Paperclip className="w-2.5 h-2.5" />RCPT
                      </a>
                    )}
                    {/* Source badge for imported rows */}
                    {log.source && log.source !== 'manual' && (
                      <span className="px-1 py-0.5 text-[8px] font-bold uppercase text-rmpg-400 bg-rmpg-800 border border-rmpg-700 tracking-wider" title={`Entered via ${log.source}`}>
                        {log.source}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      {formatMilitary(log.fuel_date)}
                    </span>
                    {log.station && (
                      <span className="flex items-center gap-0.5">
                        <MapPin className="w-2.5 h-2.5" />{log.station}
                      </span>
                    )}
                    {log.odometer_reading != null && (
                      <span className="flex items-center gap-0.5">
                        <Gauge className="w-2.5 h-2.5" />{log.odometer_reading.toLocaleString()} mi
                      </span>
                    )}
                    {log.cost_per_gallon != null && (
                      <span>${log.cost_per_gallon.toFixed(3)}/gal</span>
                    )}
                  </div>
                  {log.notes && <p className="text-[9px] text-rmpg-400 mt-0.5">{log.notes}</p>}
                </div>
                {/* Admin Edit / Delete */}
                {(onEditFuel || onDeleteFuel) && (
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {onEditFuel && (
                      <button type="button"
                        className="p-1 text-rmpg-500 hover:text-brand-400 hover:bg-rmpg-700 rounded-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); onEditFuel(log); }}
                        title="Edit fuel log"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteFuel && (
                      <button type="button"
                        className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors"
                        onClick={(e) => { e.stopPropagation(); onDeleteFuel(log); }}
                        title="Delete fuel log"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
