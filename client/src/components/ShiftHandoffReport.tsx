// ============================================================
// RMPG Flex — Shift Handoff Report
// Generates a printable shift transition report for officers
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from './PanelTitleBar';
import StatusBadge from './StatusBadge';
import { safeDateTimeStr } from '../utils/dateUtils';
import {
  FileText, Printer, Radio, AlertTriangle, StickyNote,
  MapPin, BarChart3, Plus, Clock, Car,
} from 'lucide-react';

interface ShiftHandoffProps {
  officerId?: number;
}

interface ShiftNote {
  id: number;
  content: string;
  category: string;
  created_at: string;
}

interface OpenCall {
  id: number;
  call_number: string;
  call_type: string;
  priority: string;
  status: string;
  location: string;
  reported_at: string;
}

interface ActiveBolo {
  id: number;
  type: string;
  description: string;
  issued_at: string;
  priority: string;
}

interface HandoffData {
  calls_handled: number;
  open_calls: OpenCall[];
  active_bolos: ActiveBolo[];
  shift_notes: ShiftNote[];
  gps_summary: { total_miles: number };
  stats: { avg_response_time: number; [key: string]: number };
}

function todayShiftRange() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(now.getHours() >= 18 ? 18 : 6, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 12);
  return {
    start: start.toISOString().slice(0, 16),
    end: end.toISOString().slice(0, 16),
  };
}

export default function ShiftHandoffReport({ officerId }: ShiftHandoffProps) {
  const defaults = todayShiftRange();
  const [shiftStart, setShiftStart] = useState(defaults.start);
  const [shiftEnd, setShiftEnd] = useState(defaults.end);
  const [data, setData] = useState<HandoffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [submitting, setSubmitting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        shift_start: new Date(shiftStart).toISOString(),
        shift_end: new Date(shiftEnd).toISOString(),
      });
      if (officerId) params.set('officer_id', String(officerId));
      const result = await apiFetch<HandoffData>(`/api/reports/shift-handoff?${params}`);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [shiftStart, shiftEnd, officerId]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const addNote = async () => {
    if (!noteText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/reports/shift-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteText.trim(), category: noteCategory }),
      });
      setNoteText('');
      fetchReport();
    } catch {
      setError('Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  const openItems = (data?.open_calls.length ?? 0) + (data?.active_bolos.length ?? 0);

  return (
    <div className="flex flex-col gap-3 p-4 max-w-[1100px] mx-auto print:p-0 print:max-w-none">
      {/* ── Controls (hidden in print) ── */}
      <div className="flex items-center gap-3 flex-wrap print:hidden">
        <label className="text-rmpg-300 text-xs font-mono">
          Shift Start
          <input
            type="datetime-local"
            value={shiftStart}
            onChange={e => setShiftStart(e.target.value)}
            className="ml-1 bg-[#050505] border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1 rounded-[2px] font-mono"
          />
        </label>
        <label className="text-rmpg-300 text-xs font-mono">
          Shift End
          <input
            type="datetime-local"
            value={shiftEnd}
            onChange={e => setShiftEnd(e.target.value)}
            className="ml-1 bg-[#050505] border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1 rounded-[2px] font-mono"
          />
        </label>
        <button onClick={fetchReport} className="toolbar-btn text-xs" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        <button onClick={() => window.print()} className="toolbar-btn text-xs ml-auto">
          <Printer size={13} className="mr-1 inline" />Print Report
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-xs px-3 py-2 rounded-[2px] font-mono">
          {error}
        </div>
      )}

      {/* ── Report Header ── */}
      <div className="panel-beveled bg-[#141414] p-3 print:border print:border-gray-400">
        <h1 className="text-brand-400 text-sm font-bold tracking-wider uppercase flex items-center gap-2 mb-2">
          <FileText size={16} /> Shift Handoff Report
        </h1>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-mono font-bold text-rmpg-100">{data?.calls_handled ?? '--'}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Calls Handled</div>
          </div>
          <div>
            <div className="text-2xl font-mono font-bold text-rmpg-100">
              {data?.gps_summary.total_miles != null ? data.gps_summary.total_miles.toFixed(1) : '--'}
            </div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Miles Patrolled</div>
          </div>
          <div>
            <div className="text-2xl font-mono font-bold text-rmpg-100">{data ? openItems : '--'}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide">Open Items</div>
          </div>
        </div>
      </div>

      {/* ── Open Calls ── */}
      <div className="panel-beveled bg-[#141414] print:border print:border-gray-400">
        <PanelTitleBar title="Open Calls" icon={Radio} />
        <div className="p-2">
          {!data?.open_calls.length ? (
            <p className="text-rmpg-400 text-xs font-mono py-2 text-center">No open calls</p>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-rmpg-400 text-left border-b border-rmpg-600/40">
                  <th className="pb-1 pr-2">Call #</th>
                  <th className="pb-1 pr-2">Type</th>
                  <th className="pb-1 pr-2">Priority</th>
                  <th className="pb-1 pr-2">Status</th>
                  <th className="pb-1">Location</th>
                </tr>
              </thead>
              <tbody>
                {data.open_calls.map(c => (
                  <tr key={c.id} className="border-b border-rmpg-700/30 text-rmpg-200">
                    <td className="py-1 pr-2 text-brand-400">{c.call_number}</td>
                    <td className="py-1 pr-2">{c.call_type}</td>
                    <td className="py-1 pr-2"><StatusBadge status={c.priority} type="priority" size="sm" /></td>
                    <td className="py-1 pr-2"><StatusBadge status={c.status} type="call_status" size="sm" /></td>
                    <td className="py-1 text-rmpg-300">{c.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Active BOLOs ── */}
      <div className="panel-beveled bg-[#141414] print:border print:border-gray-400">
        <PanelTitleBar title="Active BOLOs" icon={AlertTriangle} />
        <div className="p-2">
          {!data?.active_bolos.length ? (
            <p className="text-rmpg-400 text-xs font-mono py-2 text-center">No active BOLOs</p>
          ) : (
            <div className="space-y-2">
              {data.active_bolos.map(b => (
                <div key={b.id} className="bg-[#050505] border border-rmpg-700/40 rounded-[2px] p-2 text-xs font-mono">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-brand-400 font-bold uppercase">{b.type}</span>
                    <StatusBadge status={b.priority} type="priority" size="sm" />
                    <span className="text-rmpg-400 ml-auto">{safeDateTimeStr(b.issued_at)}</span>
                  </div>
                  <p className="text-rmpg-200">{b.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Shift Notes ── */}
      <div className="panel-beveled bg-[#141414] print:border print:border-gray-400">
        <PanelTitleBar title="Shift Notes" icon={StickyNote} />
        <div className="p-2 space-y-2">
          {data?.shift_notes.map(n => (
            <div key={n.id} className="bg-[#050505] border border-rmpg-700/40 rounded-[2px] p-2 text-xs font-mono">
              <div className="flex items-center gap-2 text-rmpg-400 mb-1">
                <span className="bg-brand-900/40 text-brand-400 px-1.5 py-0.5 rounded-[2px] text-[10px] uppercase font-bold">
                  {n.category}
                </span>
                <span className="ml-auto">{safeDateTimeStr(n.created_at)}</span>
              </div>
              <p className="text-rmpg-200">{n.content}</p>
            </div>
          ))}
          {/* Add note form — hidden in print */}
          <div className="flex gap-2 items-end print:hidden">
            <select
              value={noteCategory}
              onChange={e => setNoteCategory(e.target.value)}
              className="bg-[#050505] border border-rmpg-600 text-rmpg-200 text-xs px-2 py-1.5 rounded-[2px] font-mono"
            >
              <option value="general">General</option>
              <option value="safety">Safety</option>
              <option value="followup">Follow-Up</option>
              <option value="equipment">Equipment</option>
            </select>
            <input
              type="text"
              placeholder="Add shift note..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addNote()}
              className="flex-1 bg-[#050505] border border-rmpg-600 text-rmpg-100 text-xs px-2 py-1.5 rounded-[2px] font-mono placeholder:text-rmpg-500"
            />
            <button onClick={addNote} disabled={submitting || !noteText.trim()} className="toolbar-btn text-xs">
              <Plus size={13} className="mr-1 inline" />{submitting ? 'Saving...' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* ── GPS Summary & Shift Stats ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="panel-beveled bg-[#141414] print:border print:border-gray-400">
          <PanelTitleBar title="GPS Summary" icon={MapPin} />
          <div className="p-3 text-center">
            <Car size={28} className="mx-auto text-brand-400 mb-2" />
            <div className="text-3xl font-mono font-bold text-rmpg-100">
              {data?.gps_summary.total_miles != null ? data.gps_summary.total_miles.toFixed(1) : '--'}
            </div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wide mt-1">Total Miles</div>
          </div>
        </div>

        <div className="panel-beveled bg-[#141414] print:border print:border-gray-400">
          <PanelTitleBar title="Shift Stats" icon={BarChart3} />
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-rmpg-300 flex items-center gap-1"><Clock size={12} /> Avg Response</span>
              <span className="text-rmpg-100 font-bold">
                {data?.stats.avg_response_time != null ? `${data.stats.avg_response_time.toFixed(1)} min` : '--'}
              </span>
            </div>
            {data?.stats && Object.entries(data.stats)
              .filter(([k]) => k !== 'avg_response_time')
              .map(([key, val]) => (
                <div key={key} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-rmpg-300">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <span className="text-rmpg-100 font-bold">{typeof val === 'number' ? val.toFixed(1) : val}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Print Styles ── */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .panel-beveled { background: white !important; box-shadow: none !important; }
          .panel-title-bar { background: #eee !important; color: #333 !important; -webkit-print-color-adjust: exact; }
          .text-rmpg-100, .text-rmpg-200, .text-rmpg-300 { color: #222 !important; }
          .text-rmpg-400 { color: #666 !important; }
          .text-brand-400 { color: #888888 !important; }
        }
      `}</style>
    </div>
  );
}
