// ============================================================
// RMPG Flex — Officer Time Log Detail Tab
// ============================================================

import React, { useState } from 'react';
import { Clock, LogIn, LogOut, Pencil, Coffee, Zap, Trash2 } from 'lucide-react';
import type { TimeEntry } from '../../../types';
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
  if (entry.total_hours != null && Number.isFinite(Number(entry.total_hours))) return Number(entry.total_hours).toFixed(2);
  if (!entry.clock_in) return '-';
  const start = new Date(entry.clock_in).getTime();
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  if (isNaN(start) || isNaN(end)) return '-';
  const hrs = (end - start) / (1000 * 60 * 60);
  return hrs.toFixed(2);
}

function leftBarColor(status: string): string {
  if (status === 'clocked_in') return 'border-l-green-500';
  if (status === 'on_break') return 'border-l-amber-500';
  if (status === 'edited') return 'border-l-blue-500';
  return 'border-l-rmpg-500';
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function TimeLogDetailTab({
  timeEntries, officerId, isClockedIn, isOnBreak,
  onClockIn, onClockOut, onStartBreak, onEndBreak,
  onEditTimeEntry, onDeleteTimeEntry,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const isActive = isClockedIn || isOnBreak;
  const totalEntries = timeEntries.length;
  const totalHours = timeEntries.reduce((sum, e) => {
    const h = e.total_hours ?? (
      e.clock_in
        ? (((e.clock_out ? new Date(e.clock_out).getTime() : Date.now()) - new Date(e.clock_in).getTime()) / (1000 * 60 * 60))
        : 0
    );
    return sum + h;
  }, 0);
  const avgPerEntry = totalEntries > 0 ? totalHours / totalEntries : 0;
  const totalBreakMins = timeEntries.reduce((sum, e) => sum + (e.break_minutes || 0), 0);

  return (
    <div className="space-y-4">
      {/* Clock action bar */}
      <div className="panel-inset p-2 flex items-center justify-between">
        <h3 className="field-label tracking-widest">Time Log</h3>
        <div className="flex items-center gap-2">
          {isActive ? (
            <>
              {isClockedIn && (
                <button type="button"
                  onClick={() => onStartBreak(officerId)}
                  className="toolbar-btn flex items-center gap-1.5 text-blue-400 border-blue-700/50 hover:bg-blue-900/40"
                >
                  <Coffee className="w-3 h-3" /> Start Break
                </button>
              )}
              {isOnBreak && (
                <button type="button"
                  onClick={() => onEndBreak(officerId)}
                  className="toolbar-btn toolbar-btn-success flex items-center gap-1.5"
                >
                  <Zap className="w-3 h-3" /> End Break
                </button>
              )}
              <button type="button"
                onClick={() => onClockOut(officerId)}
                className="toolbar-btn toolbar-btn-danger flex items-center gap-1.5"
              >
                <LogOut className="w-3 h-3" /> Clock Out
              </button>
            </>
          ) : (
            <button type="button"
              onClick={() => onClockIn(officerId)}
              className="toolbar-btn toolbar-btn-success flex items-center gap-1.5"
            >
              <LogIn className="w-3 h-3" /> Clock In
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
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
      {timeEntries.length > 0 ? (
        <div className="space-y-2">
          {timeEntries.map((entry) => {
            const hours = calcHours(entry);
            const isActiveEntry = (entry.status === 'clocked_in' || entry.status === 'on_break') && !entry.clock_out;

            return (
              <div
                key={entry.id}
                className={`panel-beveled p-3 border-l-2 bg-surface-base ${leftBarColor(entry.status)}`}
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
                          {(Number(entry.break_minutes) || 0).toFixed(0)}min break
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
                    <button type="button"
                      onClick={() => onEditTimeEntry(entry)}
                      className="toolbar-btn p-1"
                      title="Edit time entry"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button type="button"
                      onClick={() => setDeleteTarget(entry.id)}
                      className="toolbar-btn toolbar-btn-danger p-1"
                      title="Delete time entry"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
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
