import React, { useState, useEffect } from 'react';
import {
  Users, Shield, Clock, Phone, Mail, MapPin, Calendar, Award,
  UserPlus, UserMinus, Plus, Trash2, Radio, Briefcase, ArrowRight,
  AlertTriangle, CheckCircle, FileText, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetPersonnelData, FleetPersonnelNote, FleetAssignment, Unit } from '../../../types';
import { formatMilitary, daysUntilExpiry, expiryProgress } from '../utils/fleetFormatters';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  vehicleId: string;
  personnelData: FleetPersonnelData | null;
  assignments: FleetAssignment[];
  loading: boolean;
  onAssign: (unitId: string) => void;
  onUnassign: () => void;
  onAddNote: (note: string) => void;
  onDeleteNote: (noteId: string) => void;
  onRefresh: () => void;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function credentialStatusColor(status: string): string {
  switch (status) {
    case 'valid': return 'bg-green-900/30 text-green-400 border-green-700/40';
    case 'expiring_soon': return 'bg-amber-900/30 text-amber-400 border-amber-700/40';
    case 'expired': return 'bg-red-900/30 text-red-400 border-red-700/40 animate-pulse';
    case 'revoked': return 'bg-red-900/50 text-red-400 border-red-700/50';
    default: return 'bg-rmpg-800 text-rmpg-400 border-rmpg-600';
  }
}

function formatDuration(start: string, end?: string): string {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const diffMs = e.getTime() - s.getTime();
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  if (days > 365) return `${Math.floor(days / 365)}y ${days % 365}d`;
  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export default function FleetPersonnelTab({
  vehicleId, personnelData, assignments, loading,
  onAssign, onUnassign, onAddNote, onDeleteNote, onRefresh,
}: Props) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [confirmUnassign, setConfirmUnassign] = useState(false);

  // Fetch available units for assignment dropdown
  useEffect(() => {
    const loadUnits = async () => {
      try {
        const data = await apiFetch<Unit[]>('/dispatch/units');
        setUnits(Array.isArray(data) ? data : []);
      } catch { /* silent */ }
    };
    loadUnits();
  }, []);

  if (loading || !personnelData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Users className="w-10 h-10 text-rmpg-600 mx-auto mb-3 animate-pulse" />
          <p className="text-[11px] text-rmpg-500">{loading ? 'Loading personnel data...' : 'No personnel data available'}</p>
        </div>
      </div>
    );
  }

  const { officer, unit, credentials, todaySchedule, activeTimeEntry, notes } = personnelData;
  const isAssigned = !!officer;

  // Current assignment from assignments list
  const currentAssignment = assignments.find(a => !a.unassigned_at);

  const handleAssign = () => {
    if (selectedUnitId) {
      onAssign(selectedUnitId);
      setShowAssignPanel(false);
      setSelectedUnitId('');
    }
  };

  const handleUnassign = () => {
    onUnassign();
    setConfirmUnassign(false);
  };

  const handleAddNote = () => {
    if (noteText.trim()) {
      onAddNote(noteText.trim());
      setNoteText('');
    }
  };

  // DL expiry info
  const dlDays = officer?.dl_expiry ? daysUntilExpiry(officer.dl_expiry) : null;
  const dlProgress = officer?.dl_expiry ? expiryProgress(officer.dl_expiry) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">

      {/* ─── A) CURRENT ASSIGNMENT BANNER ─── */}
      {isAssigned ? (
        <div className="panel-beveled p-3  bg-surface-sunken">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="flex-shrink-0 w-12 h-12 rounded-full border-2 border-brand-500/50 flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #1a2a3a, #0a1520)' }}>
              <span className="text-sm font-bold font-mono text-brand-400">{getInitials(officer?.full_name)}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{officer?.full_name || 'Unknown'}</span>
                {officer?.rank && (
                  <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-brand-900/30 text-brand-400 border border-brand-700/40">
                    {officer.rank}
                  </span>
                )}
                {unit?.status && (
                  <span className={`led-dot ${
                    unit.status === 'available' ? 'led-green' :
                    unit.status === 'off_duty' ? 'led-off' : 'led-amber'
                  }`} />
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                {officer?.badge_number && <span className="font-mono">Badge #{officer.badge_number}</span>}
                {unit?.call_sign && (
                  <span className="flex items-center gap-0.5">
                    <Radio className="w-2.5 h-2.5" />{unit.call_sign}
                  </span>
                )}
                {officer?.department && <span>{officer.department}</span>}
                {currentAssignment && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />Assigned {formatDuration(currentAssignment.assigned_at)}
                  </span>
                )}
              </div>
              {activeTimeEntry && (
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="led-dot led-green" style={{ width: 6, height: 6 }} />
                  <span className="text-[8px] text-green-400 font-bold uppercase">ON DUTY</span>
                  <span className="text-[8px] text-green-400/60 font-mono">since {formatMilitary(activeTimeEntry.clock_in)}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button className="toolbar-btn text-[9px]" onClick={() => setShowAssignPanel(!showAssignPanel)}>
                <UserPlus className="w-3 h-3" /> Reassign
              </button>
              <button
                className="toolbar-btn text-[9px] text-red-400 hover:text-red-300"
                onClick={() => setConfirmUnassign(true)}
              >
                <UserMinus className="w-3 h-3" /> Unassign
              </button>
              <button className="toolbar-btn text-[9px]" onClick={onRefresh}>
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Confirm Unassign */}
          {confirmUnassign && (
            <div className="mt-2 p-2 bg-red-900/20 border border-red-700/30 flex items-center justify-between">
              <span className="text-[10px] text-red-400">Remove {officer?.full_name} from this vehicle?</span>
              <div className="flex gap-1.5">
                <button className="toolbar-btn text-[9px]" onClick={() => setConfirmUnassign(false)}>Cancel</button>
                <button className="toolbar-btn text-[9px] bg-red-900/50 text-red-400 border-red-700/40" onClick={handleUnassign}>
                  Confirm Unassign
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 panel-beveled bg-surface-base">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center  bg-surface-sunken">
            <Users className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-[11px] text-rmpg-400 font-semibold">No Officer Assigned</p>
          <p className="text-[9px] text-rmpg-600 mt-1 max-w-[260px] mx-auto">
            This vehicle is not currently assigned to any unit or officer. Assign an officer to track personnel data.
          </p>
          <button className="toolbar-btn toolbar-btn-primary mt-3" onClick={() => setShowAssignPanel(true)}>
            <UserPlus className="w-3 h-3" /> Assign Officer
          </button>
        </div>
      )}

      {/* ─── ASSIGN PANEL ─── */}
      {showAssignPanel && (
        <div className="panel-beveled p-3  bg-surface-sunken">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <UserPlus className="w-3 h-3" /> {isAssigned ? 'Reassign Vehicle' : 'Assign Vehicle to Unit'}
          </h4>
          <div className="flex items-center gap-2">
            <select
              className="select-dark flex-1 text-[11px]"
              value={selectedUnitId}
              onChange={(e) => setSelectedUnitId(e.target.value)}
            >
              <option value="">Select a unit...</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.call_sign} — {u.officer_name || 'No officer'} ({toDisplayLabel(u.status)})
                </option>
              ))}
            </select>
            <button
              className="toolbar-btn toolbar-btn-primary text-[9px]"
              disabled={!selectedUnitId}
              onClick={handleAssign}
            >
              Assign
            </button>
            <button className="toolbar-btn text-[9px]" onClick={() => { setShowAssignPanel(false); setSelectedUnitId(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── B) OFFICER PROFILE & STATS ─── */}
      {isAssigned && officer && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Profile */}
          <div className="panel-beveled p-3 bg-surface-base">
            <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
              <Users className="w-3 h-3" /> Officer Profile
            </h4>
            <div className="space-y-1.5">
              {[
                { icon: <Users className="w-2.5 h-2.5" />, label: 'Name', value: officer.full_name },
                { icon: <Shield className="w-2.5 h-2.5" />, label: 'Badge', value: officer.badge_number ? `#${officer.badge_number}` : null },
                { icon: <Award className="w-2.5 h-2.5" />, label: 'Rank', value: officer.rank },
                { icon: <Briefcase className="w-2.5 h-2.5" />, label: 'Department', value: officer.department },
                { icon: <Phone className="w-2.5 h-2.5" />, label: 'Phone', value: officer.phone },
                { icon: <Mail className="w-2.5 h-2.5" />, label: 'Email', value: officer.email },
                { icon: <Clock className="w-2.5 h-2.5" />, label: 'Shift Pref', value: officer.shift_preference },
                { icon: <Calendar className="w-2.5 h-2.5" />, label: 'Hire Date', value: officer.hire_date ? formatMilitary(officer.hire_date) : null },
              ].filter(f => f.value).map((field, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="text-rmpg-500 flex-shrink-0">{field.icon}</span>
                  <span className="text-rmpg-500 w-16 flex-shrink-0">{field.label}</span>
                  <span className="text-rmpg-200 font-mono truncate">{field.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Schedule & Time */}
          <div className="space-y-3">
            {/* Today's Schedule */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Today's Schedule
              </h4>
              {todaySchedule.length === 0 ? (
                <p className="text-[10px] text-rmpg-500">No shifts scheduled today</p>
              ) : (
                <div className="space-y-1">
                  {todaySchedule.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 p-1.5 bg-surface-sunken border border-rmpg-700">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      <span className="text-[10px] font-mono text-cyan-400">{s.start_time} - {s.end_time}</span>
                      {s.property_name && (
                        <span className="text-[9px] text-rmpg-400 flex items-center gap-0.5">
                          <MapPin className="w-2.5 h-2.5" />{s.property_name}
                        </span>
                      )}
                      <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${
                        s.status === 'confirmed' ? 'bg-green-900/30 text-green-400 border-green-700/40' :
                        s.status === 'pending' ? 'bg-amber-900/30 text-amber-400 border-amber-700/40' :
                        'bg-rmpg-800 text-rmpg-400 border-rmpg-600'
                      }`}>
                        {toDisplayLabel(s.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Time Entry */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Time Clock
              </h4>
              {activeTimeEntry ? (
                <div className="flex items-center gap-2 p-1.5 bg-green-900/10 border border-green-700/30">
                  <span className="led-dot led-green" />
                  <div>
                    <span className="text-[10px] font-bold text-green-400">CLOCKED IN</span>
                    <span className="text-[9px] text-green-400/70 ml-2 font-mono">
                      Since {formatMilitary(activeTimeEntry.clock_in)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-1.5 bg-surface-sunken border border-rmpg-700">
                  <span className="led-dot led-off" />
                  <span className="text-[10px] text-rmpg-500">Not clocked in</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── C) CREDENTIALS ─── */}
      {isAssigned && officer && (
        <div className="panel-beveled bg-surface-base">
          <div className="px-3 py-1.5 border-b border-rmpg-700 flex items-center justify-between  bg-surface-sunken">
            <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> Credentials & Certifications
              {credentials.some(c => c.status === 'expired') && (
                <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold bg-red-900/30 text-red-400 border border-red-700/40 animate-pulse">
                  EXPIRED
                </span>
              )}
            </h4>
            <span className="text-[9px] text-rmpg-500">{credentials.length} total</span>
          </div>

          {/* Driver's License highlight */}
          {officer.dl_number && (
            <div className="px-3 py-2 border-b border-rmpg-700">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded flex items-center justify-center bg-cyan-900/20 border border-cyan-700/40">
                  <FileText className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-cyan-400">DRIVER'S LICENSE</span>
                    <span className="text-[10px] font-mono text-rmpg-300">{officer.dl_state} {officer.dl_number}</span>
                    {dlDays != null && (
                      <span className={`px-1 py-0.5 text-[8px] font-bold uppercase border ${
                        dlDays < 0 ? 'bg-red-900/30 text-red-400 border-red-700/40 animate-pulse' :
                        dlDays < 90 ? 'bg-amber-900/30 text-amber-400 border-amber-700/40' :
                        'bg-green-900/30 text-green-400 border-green-700/40'
                      }`}>
                        {dlDays < 0 ? `EXPIRED ${Math.abs(dlDays)}d AGO` : `${dlDays}d REMAINING`}
                      </span>
                    )}
                  </div>
                  {officer.dl_expiry && (
                    <div className="mt-1 w-full">
                      <div className="w-full h-1 bg-rmpg-700 overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${dlProgress}%`,
                            background: dlDays != null && dlDays < 0 ? '#ef4444' : dlDays != null && dlDays < 90 ? '#f59e0b' : '#22c55e',
                          }}
                        />
                      </div>
                      <span className="text-[8px] text-rmpg-600 font-mono">Expires: {formatMilitary(officer.dl_expiry)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Credential cards */}
          {credentials.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-[10px] text-rmpg-500">No credentials on file</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
              {credentials.map((cred) => (
                <div key={cred.id} className="p-2 bg-surface-sunken border border-rmpg-700">
                  <div className="flex items-center gap-2 mb-1">
                    <Award className="w-3 h-3 text-rmpg-400" />
                    <span className="text-[10px] font-bold text-rmpg-200 truncate">{toDisplayLabel(cred.type)}</span>
                    <span className={`ml-auto px-1 py-0.5 text-[7px] font-bold uppercase border ${credentialStatusColor(cred.status)}`}>
                      {cred.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-[9px] text-rmpg-500 space-y-0.5">
                    {cred.credential_number && <div className="font-mono">{cred.credential_number}</div>}
                    {cred.issuing_authority && <div>{cred.issuing_authority}</div>}
                    <div className="flex items-center gap-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      Exp: {formatMilitary(cred.expiry_date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── D) NOTES ─── */}
      <div className="panel-beveled bg-surface-base">
        <div className="px-3 py-1.5 border-b border-rmpg-700  bg-surface-sunken">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Vehicle Personnel Notes ({notes.length})
          </h4>
        </div>

        {/* Add note form */}
        <div className="px-3 py-2 border-b border-rmpg-700">
          <div className="flex gap-2">
            <textarea
              className="input-dark flex-1 text-[10px] h-14 resize-none"
              placeholder="Add a note about this vehicle's personnel..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
            />
            <button
              className="toolbar-btn toolbar-btn-primary self-end text-[9px]"
              disabled={!noteText.trim()}
              onClick={handleAddNote}
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>

        {/* Notes list */}
        {notes.length === 0 ? (
          <div className="p-3 text-center">
            <p className="text-[10px] text-rmpg-500">No personnel notes for this vehicle</p>
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto divide-y divide-rmpg-700">
            {notes.map((n) => (
              <div key={n.id} className="px-3 py-2 flex gap-2 hover:bg-surface-raised transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-rmpg-300">{n.created_by_name || 'Unknown'}</span>
                    {n.officer_name && (
                      <span className="text-[8px] text-rmpg-500">re: {n.officer_name}</span>
                    )}
                    <span className="text-[8px] text-rmpg-600 font-mono ml-auto">{formatMilitary(n.created_at)}</span>
                  </div>
                  <p className="text-[10px] text-rmpg-300 mt-0.5">{n.note}</p>
                </div>
                <button
                  className="flex-shrink-0 p-1 text-rmpg-600 hover:text-red-400 transition-colors"
                  onClick={() => onDeleteNote(n.id)}
                  title="Delete note"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── E) ASSIGNMENT HISTORY ─── */}
      <div className="panel-beveled bg-surface-base">
        <div className="px-3 py-1.5 border-b border-rmpg-700  bg-surface-sunken">
          <h4 className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Assignment History ({assignments.length})
          </h4>
        </div>

        {assignments.length === 0 ? (
          <div className="p-3 text-center">
            <p className="text-[10px] text-rmpg-500">No assignment history</p>
          </div>
        ) : (
          <div className="p-3">
            <div className="relative">
              <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: 'linear-gradient(to bottom, #1a5a9e40, #162236)' }} />
              <div className="space-y-1.5">
                {assignments.slice(0, 10).map((a) => {
                  const isActive = !a.unassigned_at;
                  return (
                    <div key={a.id} className="flex gap-2 relative pl-5">
                      <div className={`absolute left-0.5 top-1.5 w-3 h-3 rounded-full border-2 border-surface-base ${
                        isActive ? 'bg-green-500 animate-pulse' : 'bg-rmpg-500'
                      }`} />
                      <div className="flex-1 text-[9px] text-rmpg-500">
                        <div className="flex items-center gap-2">
                          {a.unit_call_sign && (
                            <span className={`font-bold ${isActive ? 'text-green-400' : 'text-rmpg-300'}`}>
                              {a.unit_call_sign}
                            </span>
                          )}
                          {a.officer_name && <span className="text-rmpg-400">{a.officer_name}</span>}
                          <span className="font-mono text-rmpg-600 ml-auto">
                            {formatDuration(a.assigned_at, a.unassigned_at || undefined)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 text-[8px] text-rmpg-600">
                          <span>{formatMilitary(a.assigned_at)}</span>
                          {a.unassigned_at && (
                            <>
                              <ArrowRight className="w-2 h-2" />
                              <span>{formatMilitary(a.unassigned_at)}</span>
                            </>
                          )}
                          {isActive && <span className="text-green-400 font-bold ml-1">CURRENT</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
