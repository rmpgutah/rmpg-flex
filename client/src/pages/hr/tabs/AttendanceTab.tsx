import React, { useState, useEffect } from 'react';
import { ClipboardCheck, Plus, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';

interface AttendanceRecord {
  id: number;
  officer_id: number;
  officer_name: string;
  date: string;
  type: string;
  minutes_late: number;
  reason: string;
  excused: number;
  documented_by_name: string;
}

interface AttendanceSummary {
  officer_id: number;
  year: number;
  by_type: { type: string; count: number; excused_count: number }[];
  total_incidents: number;
  monday_friday_pattern: boolean;
  monday_friday_count: number;
}

const TYPE_COLORS: Record<string, string> = {
  absent: 'bg-red-900/50 text-red-400 border border-red-700/50',
  tardy: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  early_departure: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  no_call_no_show: 'bg-red-900/60 text-red-300 border border-red-600/50',
};

export default function AttendanceTab({ userRole }: { userRole: string }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [officers, setOfficers] = useState<any[]>([]);
  const [selectedOfficer, setSelectedOfficer] = useState<number | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [form, setForm] = useState({ officer_id: '', date: new Date().toISOString().slice(0, 10), type: 'absent', minutes_late: 0, reason: '', excused: false });

  const isManager = ['admin', 'manager', 'supervisor'].includes(userRole);

  const load = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>('/hr/attendance'); setRecords(data); } catch { /* handled */ }
    } finally { setLoading(false); }
  };

  const loadOfficers = async () => {
    try { const data = await apiFetch<any[]>('/personnel'); setOfficers(data.filter((o: any) => o.status === 'active')); } catch { /* handled */ }
  };

  const loadSummary = async (officerId: number) => {
    try { const data = await apiFetch<AttendanceSummary>(`/hr/attendance/summary/${officerId}`); setSummary(data); } catch { /* handled */ }
  };

  useEffect(() => { load(); loadOfficers(); }, []);
  useEffect(() => { if (selectedOfficer) loadSummary(selectedOfficer); }, [selectedOfficer]);

  const handleSubmit = async () => {
    if (!form.officer_id || !form.date || !form.type) { addToast('All fields required', 'error'); return; }
    try { await apiFetch('/hr/attendance', { method: 'POST', body: JSON.stringify({ ...form, officer_id: Number(form.officer_id), excused: form.excused ? 1 : 0 }) }); addToast('Attendance logged', 'success'); setShowForm(false); load(); } catch { addToast('Failed to log attendance', 'error'); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><ClipboardCheck className="w-4 h-4" /> Attendance Tracking</h2>
        {isManager && <button onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> Log Incident</button>}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="panel-beveled p-2 text-center">
            <p className="field-label">Total Incidents</p>
            <p className="text-lg font-bold font-mono text-white">{summary.total_incidents}</p>
          </div>
          {summary.by_type.map(t => (
            <div key={t.type} className="panel-beveled p-2 text-center">
              <p className="field-label">{t.type.replace(/_/g, ' ')}</p>
              <p className="text-lg font-bold font-mono text-white">{t.count} <span className="text-[10px] text-rmpg-400">({t.excused_count} excused)</span></p>
            </div>
          ))}
          {summary.monday_friday_pattern && (
            <div className="panel-beveled p-2 text-center border-t-2 border-t-amber-500 col-span-full">
              <p className="text-[10px] text-amber-400 flex items-center justify-center gap-1"><AlertTriangle className="w-3 h-3" /> Monday/Friday pattern detected ({summary.monday_friday_count} incidents)</p>
            </div>
          )}
        </div>
      )}

      {showForm && isManager && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Officer</label>
              <select value={form.officer_id} onChange={e => setForm(f => ({ ...f, officer_id: e.target.value }))} className="input-field w-full text-xs">
                <option value="">Select officer...</option>
                {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-field w-full text-xs">
                <option value="absent">Absent</option>
                <option value="tardy">Tardy</option>
                <option value="early_departure">Early Departure</option>
                <option value="no_call_no_show">No Call / No Show</option>
              </select>
            </div>
            <div>
              <label className="field-label">Minutes Late</label>
              <input type="number" value={form.minutes_late} onChange={e => setForm(f => ({ ...f, minutes_late: Number(e.target.value) }))} className="input-field w-full text-xs" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Reason</label>
              <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" checked={form.excused} onChange={e => setForm(f => ({ ...f, excused: e.target.checked }))} className="w-3 h-3" />
              <label className="text-xs text-rmpg-300">Excused</label>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="toolbar-btn toolbar-btn-success text-xs">Save</button>
            <button onClick={() => setShowForm(false)} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* Officer filter */}
      <div>
        <select value={selectedOfficer ?? ''} onChange={e => setSelectedOfficer(e.target.value ? Number(e.target.value) : null)} className="input-field text-xs py-1 px-2">
          <option value="">All Officers</option>
          {officers.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">Loading...</div>
      ) : (
        <div className="space-y-1">
          {records.filter(r => !selectedOfficer || r.officer_id === selectedOfficer).map(r => (
            <div key={r.id} className="panel-beveled p-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_COLORS[r.type] || TYPE_COLORS.absent}`}>{r.type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-white">{r.officer_name}</span>
                <span className="text-[10px] text-rmpg-400">{r.date}</span>
                {r.minutes_late > 0 && <span className="text-[10px] text-amber-400">{r.minutes_late}m late</span>}
                {r.reason && <span className="text-[10px] text-rmpg-400 italic">{r.reason}</span>}
              </div>
              <span className={`text-[10px] ${r.excused ? 'text-green-400' : 'text-red-400'}`}>{r.excused ? 'Excused' : 'Unexcused'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
