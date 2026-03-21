// ============================================================
// RMPG Flex — Officer Time Log Detail Tab
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { Clock, LogIn, LogOut, Pencil, Coffee, Zap, Trash2, History, Calendar } from 'lucide-react';
import type { TimeEntry, TimeEntryEdit } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import ConfirmDialog from '../../../components/ConfirmDialog';

interface Props {
  timeEntries: TimeEntry[];
  officerId: string;
  isClockedIn: boolean;
  isOnBreak: boolean;
  onClockIn: (officerId: string) => void;
  onClockOut: (officerId: string) => void;
  onStartBreak: (officerId: string) => void;
  onEndBreak: (officerId: string) => void;
  onEditTimeEntry: (entry: TimeEntry) => void;
  onDeleteTimeEntry: (entryId: string) => void;
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function calcHours(entry: TimeEntry): string {
  if (entry.total_hours != null) return entry.total_hours.toFixed(2);
  if (!entry.clock_in) return '-';
  const start = new Date(entry.clock_in).getTime();
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  const hrs = (end - start) / (1000 * 60 * 60);
  return hrs.toFixed(2);
}

function leftBarColor(status: string): string {
  if (status === 'clocked_in') return 'border-l-green-500';
  if (status === 'on_break') return 'border-l-amber-500';
  if (status === 'edited') return 'border-l-blue-500';
  return 'border-l-rmpg-500';
}

export default function TimeLogDetailTab({
  timeEntries, officerId, isClockedIn, isOnBreak,
  onClockIn, onClockOut, onStartBreak, onEndBreak,
  onEditTimeEntry, onDeleteTimeEntry,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<TimeEntryEdit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const filteredEntries = useMemo(() => {
    return timeEntries.filter(te => {
      const d = te.clock_in?.split('T')[0] || te.clock_in?.split(' ')[0] || '';
      if (filterStart && d < filterStart) return false;
      if (filterEnd && d > filterEnd) return false;
      return true;
    });
  }, [timeEntries, filterStart, filterEnd]);

  const toggleHistory = useCallback(async (entryId: string) => {
    if (expandedHistory === entryId) { setExpandedHistory(null); return; }
    setHistoryLoading(true);
    try {
      const edits = await apiFetch<TimeEntryEdit[]>(`/personnel/time/${entryId}/history`);
      setEditHistory(Array.isArray(edits) ? edits : []);
      setExpandedHistory(entryId);
    } catch { setEditHistory([]); }
    finally { setHistoryLoading(false); }
  }, [expandedHistory]);

  const isActive = isClockedIn || isOnBreak;
  const totalEntries = filteredEntries.length;
  const totalHours = filteredEntries.reduce((sum, e) => {
    const h = e.total_hours ?? (
      e.clock_in
        ? (((e.clock_out ? new Date(e.clock_out).getTime() : Date.now()) - new Date(e.clock_in).getTime()) / (1000 * 60 * 60))
        : 0
    );
    return sum + h;
  }, 0);
  const avgPerEntry = totalEntries > 0 ? totalHours / totalEntries : 0;
  const totalBreakMins = filteredEntries.reduce((sum, e) => sum + (e.break_minutes || 0), 0);

  return (
    <div className="space-y-4">
      {/* Clock action bar */}
      <div className="panel-inset p-2 flex items-center justify-between">
        <h3 className="field-label tracking-widest">Time Log</h3>
        <div className="flex items-center gap-2">
          {isActive ? (
            <>
              {isClockedIn && (
                <button
                  onClick={() => onStartBreak(officerId)}
                  className="toolbar-btn flex items-center gap-1.5 text-blue-400 border-blue-700/50 hover:bg-blue-900/40"
                >
                  <Coffee className="w-3 h-3" /> Start Break
                </button>
              )}
              {isOnBreak && (
                <button
                  onClick={() => onEndBreak(officerId)}
                  className="toolbar-btn toolbar-btn-success flex items-center gap-1.5"
                >
                  <Zap className="w-3 h-3" /> End Break
                </button>
              )}
              <button
                onClick={() => onClockOut(officerId)}
                className="toolbar-btn toolbar-btn-danger flex items-center gap-1.5"
              >
                <LogOut className="w-3 h-3" /> Clock Out
              </button>
            </>
          ) : (
            <button
              onClick={() => onClockIn(officerId)}
              className="toolbar-btn toolbar-btn-success flex items-center gap-1.5"
            >
              <LogIn className="w-3 h-3" /> Clock In
            </button>
          )}
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-3 h-3 text-rmpg-400" />
        <span className="text-[8px] text-rmpg-500 uppercase font-bold">Filter</span>
        <input type="date" className="input-dark text-[10px]" style={{ padding: '1px 4px' }}
          value={filterStart} onChange={e => setFilterStart(e.target.value)} />
        <span className="text-rmpg-600 text-[9px]">to</span>
        <input type="date" className="input-dark text-[10px]" style={{ padding: '1px 4px' }}
          value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
        {(filterStart || filterEnd) && (
          <button onClick={() => { setFilterStart(''); setFilterEnd(''); }} className="toolbar-btn text-[8px]" style={{ padding: '1px 4px' }}>Clear</button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <p className="text-lg font-bold text-rmpg-100 font-mono">{totalEntries}</p>
          <p className="field-label">Entries</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-brand-400">
          <p className="text-lg font-bold text-brand-400 font-mono">{totalHours.toFixed(1)}</p>
          <p className="field-label">Hours</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-blue-500">
          <p className="text-lg font-bold text-rmpg-100 font-mono">{avgPerEntry.toFixed(1)}</p>
          <p className="field-label">Avg/Entry</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-amber-500">
          <p className="text-lg font-bold text-amber-400 font-mono">{totalBreakMins.toFixed(0)}</p>
          <p className="field-label">Break Min</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-green-500">
          <p className={`text-lg font-bold font-mono ${isOnBreak ? 'text-amber-400' : isClockedIn ? 'text-green-400' : 'text-rmpg-400'}`}>
            {isOnBreak ? 'BRK' : isClockedIn ? 'IN' : 'OUT'}
          </p>
          <p className="field-label">Status</p>
        </div>
      </div>

      {/* Time Entry List */}
      {filteredEntries.length > 0 ? (
        <div className="space-y-2">
          {filteredEntries.map((entry) => {
            const hours = calcHours(entry);
            const isActiveEntry = (entry.status === 'clocked_in' || entry.status === 'on_break') && !entry.clock_out;

            return (
              <div
                key={entry.id}
                className={`panel-beveled p-3 border-l-2 bg-surface-base ${
                  (entry.edit_count != null && entry.edit_count > 0)
                    ? 'border-l-amber-500'
                    : leftBarColor(entry.status)
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {/* Clock in */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <LogIn className="w-3 h-3 text-green-400" />
                      <span className="text-green-400 font-mono">{formatTime(entry.clock_in)}</span>
                    </div>

                    {/* Clock out or Active/Break */}
                    {entry.clock_out ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <LogOut className="w-3 h-3 text-rmpg-300" />
                        <span className="text-rmpg-300 font-mono">{formatTime(entry.clock_out)}</span>
                      </div>
                    ) : isActiveEntry ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        {entry.status === 'on_break' ? (
                          <>
                            <Coffee className="w-3 h-3 text-amber-400" />
                            <span className="text-amber-400 animate-pulse font-semibold">On Break</span>
                          </>
                        ) : (
                          <>
                            <LogOut className="w-3 h-3 text-rmpg-500" />
                            <span className="text-green-400 animate-pulse font-semibold">Active</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs">
                        <LogOut className="w-3 h-3 text-rmpg-500" />
                        <span className="text-rmpg-500">-</span>
                      </div>
                    )}

                    {/* Break minutes + edited badge */}
                    <div className="flex items-center gap-2">
                      {entry.break_minutes > 0 && (
                        <span className="text-[9px] text-amber-400 font-mono">
                          <Coffee className="w-2.5 h-2.5 inline mr-0.5" />
                          {entry.break_minutes.toFixed(0)}min break
                        </span>
                      )}
                      {entry.status === 'edited' && (
                        <span className="text-[8px] px-1 py-0.5 bg-blue-900/40 text-blue-400 border border-blue-700/50 font-bold uppercase">
                          Edited
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Hours + Actions */}
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-rmpg-100">{hours}h</p>
                    </div>
                    <button
                      onClick={() => onEditTimeEntry(entry)}
                      className="toolbar-btn p-1"
                      title="Edit time entry"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(entry.id)}
                      className="toolbar-btn toolbar-btn-danger p-1"
                      title="Delete time entry"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Edit history indicator */}
                {(entry.status === 'edited' || (entry.edit_count != null && entry.edit_count > 0)) && (
                  <div className="mt-1 pt-1 border-t border-rmpg-700/30">
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <History className="w-2.5 h-2.5 text-amber-400" />
                      <span className="text-amber-400">
                        Edited{entry.edited_by_name ? ` by ${entry.edited_by_name}` : ''}
                        {entry.edit_reason ? ` — ${entry.edit_reason}` : ''}
                      </span>
                      {entry.edit_count != null && entry.edit_count > 0 && (
                        <button onClick={() => toggleHistory(entry.id)} className="text-[8px] text-brand-400 hover:underline ml-auto">
                          {expandedHistory === entry.id ? 'Hide' : `${entry.edit_count} change${entry.edit_count > 1 ? 's' : ''}`}
                        </button>
                      )}
                    </div>
                    {expandedHistory === entry.id && (
                      <div className="mt-1 space-y-0.5 pl-4">
                        {historyLoading ? (
                          <span className="text-[8px] text-rmpg-500">Loading...</span>
                        ) : editHistory.map(edit => (
                          <div key={edit.id} className="flex items-center gap-2 text-[8px] text-rmpg-500">
                            <span className="text-rmpg-400">{edit.edited_by_name}</span>
                            <span>{edit.edit_type.replace(/_/g, ' ')}</span>
                            {edit.old_value && !edit.old_value.startsWith('{') && <span className="line-through text-red-400/60 font-mono">{edit.old_value}</span>}
                            {edit.new_value && <span className="text-green-400 font-mono">{edit.new_value}</span>}
                            {edit.reason && <span className="italic text-rmpg-600">— {edit.reason}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-beveled p-8 text-center bg-surface-base">
          <Clock className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No time entries on file</p>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { onDeleteTimeEntry(deleteTarget); setDeleteTarget(null); } }}
        title="Delete Time Entry"
        message="Are you sure you want to delete this time entry? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
