// ============================================================
// RMPG Flex — Personnel: Time & Attendance Tab (Enhanced)
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { Clock, LogIn, LogOut, Coffee, Users, BarChart3, Pencil, Trash2, ChevronDown, ChevronUp, Calendar, History, CheckSquare, RefreshCw } from 'lucide-react';
import type { TimeEntry, TimeEntryEdit } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { apiFetch } from '../../../hooks/useApi';

interface Props {
  timeEntries: TimeEntry[];
  officers: OfficerWithStatus[];
  onEditTimeEntry?: (entry: TimeEntry) => void;
  onDeleteTimeEntry?: (entryId: string) => void;
  onBatchClockIn?: (officerIds: string[]) => void;
  onInlineEdit?: (entryId: string, field: string, value: string, reason: string) => void;
  userRole?: string;
  dateRange: { start: string; end: string };
  onDateRangeChange: (range: { start: string; end: string }) => void;
}

// ---- Helpers ----

function formatClockTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getElapsedHours(clockIn: string): string {
  const diff = Date.now() - new Date(clockIn).getTime();
  const hrs = (diff / 3600000).toFixed(1);
  return `${hrs}h`;
}

function toLocalInput(dt?: string): string {
  if (!dt) return '';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const today = () => new Date().toISOString().split('T')[0];

const getWeekRange = (offset: number) => {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + (offset * 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] };
};

// ---- Component ----

export default function TimeAttendanceTab({
  timeEntries, officers, onEditTimeEntry, onDeleteTimeEntry,
  onBatchClockIn, onInlineEdit, userRole, dateRange, onDateRangeChange,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedForClockIn, setSelectedForClockIn] = useState<string[]>([]);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditField, setInlineEditField] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<TimeEntryEdit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ---- Computed ----

  const stats = useMemo(() => {
    const clockedIn = timeEntries.filter((te) => te.status === 'clocked_in');
    const onBreak = timeEntries.filter((te) => te.status === 'on_break');
    const clockedOut = timeEntries.filter((te) => te.status === 'clocked_out');

    const totalHours = timeEntries.reduce((sum, te) => sum + (te.total_hours || 0), 0);
    const officerCount = new Set(timeEntries.map((te) => te.officer_id)).size;
    const avgHours = officerCount > 0 ? totalHours / officerCount : 0;

    return {
      clockedInCount: clockedIn.length,
      onBreakCount: onBreak.length,
      clockedOutCount: clockedOut.length,
      totalHours: totalHours.toFixed(1),
      avgHours: avgHours.toFixed(1),
    };
  }, [timeEntries]);

  const activeEntries = useMemo(() => {
    return timeEntries.filter((te) => te.status === 'clocked_in' || te.status === 'on_break');
  }, [timeEntries]);

  const offDutyOfficers = useMemo(() => {
    const activeOfficerIds = new Set(
      timeEntries
        .filter(te => te.status === 'clocked_in' || te.status === 'on_break')
        .map(te => te.officer_id),
    );
    return officers.filter(o => !activeOfficerIds.has(o.id) && o.status !== 'inactive');
  }, [timeEntries, officers]);

  const canEdit = !!userRole && ['admin', 'manager', 'supervisor'].includes(userRole);
  const canBatch = !!userRole && ['admin', 'manager', 'supervisor', 'dispatcher'].includes(userRole);
  const colCount = (onEditTimeEntry || onDeleteTimeEntry) ? 7 : 6;

  // ---- Inline editing ----

  const startInlineEdit = (id: string, field: string) => {
    if (!canEdit) return;
    setInlineEditId(id);
    setInlineEditField(field);
  };

  const commitInlineEdit = (id: string, field: string, value: string) => {
    if (value && onInlineEdit) {
      onInlineEdit(id, field, value, 'Inline correction');
    }
    setInlineEditId(null);
    setInlineEditField(null);
  };

  const cancelInlineEdit = () => {
    setInlineEditId(null);
    setInlineEditField(null);
  };

  // ---- Edit history ----

  const toggleHistory = useCallback(async (entryId: string) => {
    if (expandedHistory === entryId) {
      setExpandedHistory(null);
      return;
    }
    setHistoryLoading(true);
    try {
      const edits = await apiFetch<TimeEntryEdit[]>(`/personnel/time/${entryId}/history`);
      setEditHistory(Array.isArray(edits) ? edits : []);
      setExpandedHistory(entryId);
    } catch {
      setEditHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [expandedHistory]);

  // ---- Summary cards config ----

  const SUMMARY_CARDS = [
    { label: 'Currently Clocked In', value: stats.clockedInCount, icon: LogIn, color: 'text-green-400', bgClass: 'bg-[#0a1a0a]', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Total Hours', value: stats.totalHours, icon: Clock, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'On Break', value: stats.onBreakCount, icon: Coffee, color: 'text-amber-400', bgClass: 'bg-[#1a1400]', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Clocked Out', value: stats.clockedOutCount, icon: LogOut, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-600' },
    { label: 'Avg Hours/Officer', value: stats.avgHours, icon: BarChart3, color: 'text-brand-400', bgClass: 'bg-[#0a1020]', border: 'border-brand-700/30', topBorder: 'border-t-brand-500' },
  ];

  // ---- Render ----

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Time & Attendance</h2>
      </div>

      {/* Date Range Picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="w-3 h-3 text-rmpg-400" />
        {[
          { label: 'Today', fn: () => { const t = today(); onDateRangeChange({ start: t, end: t }); } },
          { label: 'This Week', fn: () => onDateRangeChange(getWeekRange(0)) },
          { label: 'Last Week', fn: () => onDateRangeChange(getWeekRange(-1)) },
        ].map(p => (
          <button key={p.label} onClick={p.fn} className="toolbar-btn text-[8px]" style={{ padding: '1px 6px' }}>{p.label}</button>
        ))}
        <div className="flex items-center gap-1 ml-auto">
          <input type="date" className="input-dark text-[10px]" style={{ padding: '1px 4px' }} value={dateRange.start}
            onChange={e => onDateRangeChange({ ...dateRange, start: e.target.value })} />
          <span className="text-rmpg-600 text-[9px]">to</span>
          <input type="date" className="input-dark text-[10px]" style={{ padding: '1px 4px' }} value={dateRange.end}
            onChange={e => onDateRangeChange({ ...dateRange, end: e.target.value })} />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {SUMMARY_CARDS.map((card) => (
          <div
            key={card.label}
            className={`panel-beveled p-2.5 text-center border ${card.border} border-t-2 ${card.topBorder} ${card.bgClass}`}
          >
            <card.icon className={`w-3.5 h-3.5 mx-auto ${card.color} mb-1`} />
            <div className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Batch Clock-In Panel */}
      {canBatch && (
        <div className="panel-beveled p-2.5 border border-brand-700/20">
          <button onClick={() => setShowBatchPanel(!showBatchPanel)} className="flex items-center justify-between w-full text-[9px] text-rmpg-400 font-bold uppercase">
            <span className="flex items-center gap-1.5"><CheckSquare className="w-3 h-3" /> Quick Clock-In ({offDutyOfficers.length} available)</span>
            {showBatchPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showBatchPanel && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {offDutyOfficers.map(o => (
                  <label key={o.id} className="flex items-center gap-1.5 panel-beveled px-2 py-1 cursor-pointer hover:bg-surface-raised text-[10px]">
                    <input type="checkbox" checked={selectedForClockIn.includes(o.id)}
                      onChange={e => setSelectedForClockIn(prev => e.target.checked ? [...prev, o.id] : prev.filter(id => id !== o.id))} />
                    <span className="text-rmpg-300">{o.full_name}</span>
                  </label>
                ))}
                {offDutyOfficers.length === 0 && <span className="text-[9px] text-rmpg-500">All officers are already clocked in</span>}
              </div>
              {selectedForClockIn.length > 0 && (
                <button onClick={() => { onBatchClockIn?.(selectedForClockIn); setSelectedForClockIn([]); }}
                  className="toolbar-btn toolbar-btn-primary text-[9px]" style={{ padding: '3px 10px' }}>
                  <LogIn className="w-3 h-3" /> Clock In {selectedForClockIn.length} Officer{selectedForClockIn.length > 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active Clock-Ins */}
      {activeEntries.length > 0 && (
        <div className="panel-beveled p-3 border border-green-700/30 border-l-2 border-l-green-500 bg-[#0a1a0a]">
          <h3 className="text-[9px] text-green-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
            <Users className="w-3 h-3" />
            Currently Active ({activeEntries.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {activeEntries.map((te) => (
              <div
                key={te.id}
                className="panel-beveled p-2 border border-green-800/30 flex items-center gap-2"
              >
                <span className="led-dot led-green" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-rmpg-200 font-medium truncate">{te.officer_name}</div>
                  <div className="text-[9px] text-green-400 font-mono">
                    {getElapsedHours(te.clock_in)} elapsed
                  </div>
                </div>
                {te.status === 'on_break' && (
                  <span className="px-1 py-0.5 text-[8px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">
                    BREAK
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time Entries Table */}
      <div className="panel-beveled overflow-x-auto bg-surface-sunken">
        <table className="table-dark w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left">Officer</th>
              <th className="text-left">Clock In</th>
              <th className="text-left">Clock Out</th>
              <th className="text-left">Status</th>
              <th className="text-right">Break (min)</th>
              <th className="text-right">Hours</th>
              {(onEditTimeEntry || onDeleteTimeEntry) && <th className="w-16"></th>}
            </tr>
          </thead>
          <tbody>
            {timeEntries.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="text-center py-8 text-rmpg-500 text-[10px]">
                  No time entries to display.
                </td>
              </tr>
            ) : (
              timeEntries.map((te) => (
                <React.Fragment key={te.id}>
                  <tr className="group">
                    {/* Officer */}
                    <td>
                      <div className="flex items-center gap-1.5">
                        {te.status === 'clocked_in' && <span className="led-dot led-green" />}
                        {te.status === 'on_break' && <span className="led-dot led-amber" />}
                        {te.status === 'clocked_out' && <span className="led-dot led-off" />}
                        {te.status === 'edited' && <span className="led-dot led-blue" />}
                        <span className="text-xs text-rmpg-200">{te.officer_name}</span>
                      </div>
                    </td>

                    {/* Clock In (inline-editable) */}
                    <td
                      className={canEdit ? 'cursor-pointer group/cell hover:bg-surface-raised' : ''}
                      onClick={() => canEdit && startInlineEdit(te.id, 'clock_in')}
                    >
                      {inlineEditId === te.id && inlineEditField === 'clock_in' ? (
                        <input
                          type="datetime-local"
                          autoFocus
                          className="input-dark text-[10px] w-36 font-mono"
                          defaultValue={toLocalInput(te.clock_in)}
                          onBlur={e => commitInlineEdit(te.id, 'clock_in', e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitInlineEdit(te.id, 'clock_in', (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') cancelInlineEdit();
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-xs font-mono text-rmpg-300 flex items-center gap-0.5">
                          <LogIn className="w-2.5 h-2.5 text-green-400" />
                          {formatClockTime(te.clock_in)}
                          {canEdit && <Pencil className="w-2 h-2 text-rmpg-700 opacity-0 group-hover/cell:opacity-100 transition-opacity" />}
                        </span>
                      )}
                    </td>

                    {/* Clock Out (inline-editable) */}
                    <td
                      className={canEdit && te.clock_out ? 'cursor-pointer group/cell hover:bg-surface-raised' : ''}
                      onClick={() => canEdit && te.clock_out && startInlineEdit(te.id, 'clock_out')}
                    >
                      {inlineEditId === te.id && inlineEditField === 'clock_out' ? (
                        <input
                          type="datetime-local"
                          autoFocus
                          className="input-dark text-[10px] w-36 font-mono"
                          defaultValue={toLocalInput(te.clock_out)}
                          onBlur={e => commitInlineEdit(te.id, 'clock_out', e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitInlineEdit(te.id, 'clock_out', (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') cancelInlineEdit();
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="text-xs font-mono text-rmpg-300">
                          {te.clock_out ? (
                            <span className="flex items-center gap-0.5">
                              <LogOut className="w-2.5 h-2.5 text-rmpg-400" />
                              {formatClockTime(te.clock_out)}
                              {canEdit && <Pencil className="w-2 h-2 text-rmpg-700 opacity-0 group-hover/cell:opacity-100 transition-opacity" />}
                            </span>
                          ) : (
                            <span className="text-rmpg-600">-</span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Status + Edit badge */}
                    <td>
                      <div className="flex items-center gap-1">
                        {te.status === 'clocked_in' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-green-900/50 text-green-400 border border-green-700/50">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            Active
                          </span>
                        )}
                        {te.status === 'on_break' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            Break
                          </span>
                        )}
                        {te.status === 'clocked_out' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-rmpg-700 text-rmpg-400 border border-rmpg-600">
                            Clocked Out
                          </span>
                        )}
                        {te.status === 'edited' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-blue-900/50 text-blue-400 border border-blue-700/50">
                            Edited
                          </span>
                        )}
                        {te.edit_count != null && te.edit_count > 0 && (
                          <button
                            onClick={() => toggleHistory(te.id)}
                            className="ml-1 text-[7px] text-amber-400 bg-amber-900/30 px-1 py-0.5 font-bold hover:bg-amber-900/50"
                            title="View edit history"
                          >
                            {te.edit_count} edit{te.edit_count > 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* Break minutes */}
                    <td className="text-right">
                      <span className="text-xs font-mono text-rmpg-400">{te.break_minutes || 0}</span>
                    </td>

                    {/* Total hours */}
                    <td className="text-right">
                      <span className="text-xs font-mono font-bold text-rmpg-200">
                        {te.total_hours != null ? te.total_hours.toFixed(1) : (
                          (te.status === 'clocked_in' || te.status === 'on_break') ? getElapsedHours(te.clock_in) : '-'
                        )}
                      </span>
                    </td>

                    {/* Actions */}
                    {(onEditTimeEntry || onDeleteTimeEntry) && (
                      <td>
                        <div className="flex items-center gap-0.5">
                          {onEditTimeEntry && (
                            <button
                              onClick={() => onEditTimeEntry(te)}
                              className="toolbar-btn p-1"
                              title="Edit time entry"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                          {onDeleteTimeEntry && (
                            <button
                              onClick={() => setDeleteTarget(te.id)}
                              className="toolbar-btn toolbar-btn-danger p-1"
                              title="Delete time entry"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>

                  {/* Expanded edit history sub-row */}
                  {expandedHistory === te.id && (
                    <tr>
                      <td colSpan={colCount} className="!p-0">
                        <div className="bg-surface-sunken border-l-2 border-l-amber-500 px-4 py-2 space-y-1">
                          {historyLoading ? (
                            <div className="text-center py-2"><RefreshCw className="w-3 h-3 text-rmpg-500 animate-spin mx-auto" /></div>
                          ) : editHistory.length === 0 ? (
                            <p className="text-[9px] text-rmpg-500">No edit history</p>
                          ) : (
                            editHistory.map(edit => (
                              <div key={edit.id} className="flex items-center gap-2 text-[9px] py-0.5">
                                <History className="w-2.5 h-2.5 text-amber-400 flex-shrink-0" />
                                <span className="text-rmpg-300 font-medium">{edit.edited_by_name}</span>
                                <span className="text-rmpg-500">{edit.edit_type.replace(/_/g, ' ')}</span>
                                {edit.old_value && !edit.old_value.startsWith('{') && (
                                  <span className="line-through text-red-400/60 font-mono">{formatClockTime(edit.old_value)}</span>
                                )}
                                {edit.new_value && (
                                  <span className="text-green-400 font-mono">{formatClockTime(edit.new_value)}</span>
                                )}
                                {edit.reason && <span className="text-rmpg-600 italic">{'\u2014'} {edit.reason}</span>}
                                <span className="ml-auto text-rmpg-600 font-mono">
                                  {new Date(edit.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation */}
      {onDeleteTimeEntry && (
        <ConfirmDialog
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => { if (deleteTarget && onDeleteTimeEntry) { onDeleteTimeEntry(deleteTarget); setDeleteTarget(null); } }}
          title="Delete Time Entry"
          message="Are you sure you want to delete this time entry? This action cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
        />
      )}
    </div>
  );
}
