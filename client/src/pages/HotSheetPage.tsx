import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Flame, AlertTriangle, Eye, FileWarning, ShieldAlert, User, Car,
  RefreshCw, Printer, Clock, ChevronDown, Filter,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import StatusBadge from '../components/StatusBadge';
import { formatDateTime, formatShortTime } from '../utils/dateUtils';

interface HotSheetData {
  generated_at: string;
  summary: {
    total: number; critical: number; urgent: number; notice: number;
    by_type: { bolos: number; warrants: number; trespass: number; offender: number };
  };
  alerts: any[];
}

type AlertFilter = 'all' | 'bolo' | 'warrant' | 'trespass' | 'offender';

export default function HotSheetPage() {
  const [data, setData] = useState<HotSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const result = await apiFetch<HotSheetData>('/api/reports/hot-sheet');
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshTimer.current = setInterval(load, 30 * 1000); // 30 sec
    return () => clearInterval(refreshTimer.current);
  }, [load]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
    </div>
  );

  if (error || !data) return (
    <div className="flex-1 flex items-center justify-center text-red-400">
      <AlertTriangle className="w-4 h-4 mr-2" />
      {error || 'Failed to load hot sheet'}
    </div>
  );

  const { summary, alerts } = data;
  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.alert_type === filter);

  const severityColor: Record<string, string> = {
    critical: 'border-red-600 bg-red-950/40',
    urgent: 'border-amber-600 bg-amber-950/30',
    notice: 'border-blue-700 bg-blue-950/20',
  };
  const severityBadge: Record<string, string> = {
    critical: 'bg-red-700 text-white',
    urgent: 'bg-amber-700 text-white',
    notice: 'bg-blue-700 text-white',
  };
  const typeIcon: Record<string, any> = {
    bolo: Eye, warrant: AlertTriangle, trespass: FileWarning, offender: ShieldAlert,
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Flame className="w-5 h-5 text-red-500" />
            HOT SHEET — ACTIVE ALERTS
          </h1>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            Live feed — Auto-refreshes every 30s — {formatDateTime(data.generated_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={load} className="toolbar-btn text-[10px] flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => window.print()} className="toolbar-btn text-[10px] flex items-center gap-1">
            <Printer className="w-3 h-3" /> Print
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-neutral-500">Total:</span>
          <span className="font-bold text-white">{summary.total}</span>
        </div>
        <div className="h-4 w-px bg-neutral-700" />
        {summary.critical > 0 && (
          <span className="text-[10px] px-2 py-0.5 bg-red-700 text-white font-bold">
            {summary.critical} CRITICAL
          </span>
        )}
        {summary.urgent > 0 && (
          <span className="text-[10px] px-2 py-0.5 bg-amber-700 text-white font-bold">
            {summary.urgent} URGENT
          </span>
        )}
        {summary.notice > 0 && (
          <span className="text-[10px] px-2 py-0.5 bg-blue-700 text-white font-bold">
            {summary.notice} NOTICE
          </span>
        )}
        <div className="h-4 w-px bg-neutral-700" />
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <Eye className="w-3 h-3" />{summary.by_type.bolos}
          <AlertTriangle className="w-3 h-3 ml-1" />{summary.by_type.warrants}
          <FileWarning className="w-3 h-3 ml-1" />{summary.by_type.trespass}
          <ShieldAlert className="w-3 h-3 ml-1" />{summary.by_type.offender}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 print:hidden">
        <Filter className="w-3 h-3 text-neutral-500" />
        {(['all', 'bolo', 'warrant', 'trespass', 'offender'] as AlertFilter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-1 uppercase tracking-wide font-medium transition-colors ${filter === f ? 'bg-brand-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>
            {f === 'all' ? `All (${summary.total})` : `${f} (${summary.by_type[f === 'bolo' ? 'bolos' : f === 'warrant' ? 'warrants' : f]})`}
          </button>
        ))}
      </div>

      {/* Alerts Feed */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">
          <Flame className="w-8 h-8 mx-auto mb-2 text-green-500" />
          <p className="text-sm font-medium text-green-400">All Clear</p>
          <p className="text-xs">No active alerts matching filter</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((alert: any, idx: number) => {
            const Icon = typeIcon[alert.alert_type] || AlertTriangle;
            return (
              <div key={`${alert.alert_type}-${alert.id}-${idx}`}
                className={`border p-3 ${severityColor[alert.severity] || severityColor.notice}`}>
                {/* Alert Header */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[9px] px-1.5 py-0.5 font-bold uppercase ${severityBadge[alert.severity] || severityBadge.notice}`}>
                    {alert.severity}
                  </span>
                  <Icon className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="text-[9px] uppercase tracking-wide text-neutral-500 font-bold">
                    {alert.alert_type}
                  </span>
                  {alert.number && <span className="text-xs text-neutral-400 font-mono">{alert.number}</span>}
                  <span className="ml-auto text-[10px] text-neutral-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatShortTime(alert.created_at)}
                  </span>
                </div>

                {/* Alert Body */}
                <div className="text-sm font-semibold text-white mb-1">{alert.title}</div>

                {alert.description && (
                  <div className="text-xs text-neutral-300 mb-1">{alert.description}</div>
                )}

                {/* Person Details */}
                {alert.subject && (alert.subject.first_name || alert.subject.last_name) && (
                  <div className="text-xs text-neutral-400 flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {alert.subject.dob && <span>DOB: {alert.subject.dob}</span>}
                    {alert.subject.height_feet && (
                      <span>{alert.subject.height_feet}'{alert.subject.height_inches || 0}" {alert.subject.weight && `${alert.subject.weight}lbs`}</span>
                    )}
                    {alert.subject.hair_color && <span>{alert.subject.hair_color} hair</span>}
                    {alert.subject.eye_color && <span>{alert.subject.eye_color} eyes</span>}
                    {alert.subject.scars_marks_tattoos && (
                      <span className="text-amber-400">SMT: {alert.subject.scars_marks_tattoos}</span>
                    )}
                  </div>
                )}

                {/* Vehicle / Subject Description */}
                {alert.subject_description && (
                  <div className="text-xs text-neutral-400 mt-1 flex items-center gap-1">
                    <User className="w-3 h-3" /> {alert.subject_description}
                  </div>
                )}
                {alert.vehicle_description && (
                  <div className="text-xs text-neutral-400 mt-0.5 flex items-center gap-1">
                    <Car className="w-3 h-3" /> {alert.vehicle_description}
                  </div>
                )}

                {/* Location for trespass */}
                {alert.property && (
                  <div className="text-xs text-neutral-500 mt-1">Property: {alert.property} — {alert.location}</div>
                )}

                {/* Bail / Offense Level */}
                {alert.bail_amount && (
                  <div className="text-xs text-neutral-400 mt-1">
                    Bail: <span className="text-amber-400">${Number(alert.bail_amount).toLocaleString()}</span>
                    {alert.offense_level && <span className="ml-2 text-red-400">{alert.offense_level.replace(/_/g, ' ')}</span>}
                  </div>
                )}

                {/* Expiry */}
                {alert.expires_at && (
                  <div className="text-[10px] text-neutral-500 mt-1">
                    Expires: {formatDateTime(alert.expires_at)}
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
