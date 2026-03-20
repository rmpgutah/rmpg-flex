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
      {/* Section Header */}
      <div className="section-header">
        <Clock className="w-3.5 h-3.5 section-icon" />
        <h3>Time Log</h3>
      </div>

      {/* Clock action bar */}
      <div className={`stat-pod panel-inset p-2.5 flex items-center justify-between ${isActive ? 'clock-active-ring' : ''}`} style={{ '--pod-glow': isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(26, 90, 158, 0.08)' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <span className={isOnBreak ? 'led-dot led-amber led-breathing' : isClockedIn ? 'led-dot led-green led-breathing' : 'led-dot led-off'} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isOnBreak ? 'text-amber-400' : isClockedIn ? 'text-green-400' : 'text-rmpg-500'}`}>
            {isOnBreak ? 'On Break' : isClockedIn ? 'Clocked In' : 'Off Duty'}
          </span>
        </div>
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

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(148, 163, 184, 0.1)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-rmpg-100 font-mono stat-value">{totalEntries}</p>
          <p className="field-label stat-label">Entries</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-brand-400 summary-card-shimmer" style={{ '--pod-glow': 'rgba(26, 90, 158, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-brand-400 font-mono stat-value">{totalHours.toFixed(1)}</p>
          <p className="field-label stat-label">Hours</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-blue-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(59, 130, 246, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-rmpg-100 font-mono stat-value">{avgPerEntry.toFixed(1)}</p>
          <p className="field-label stat-label">Avg/Entry</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-amber-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(245, 158, 11, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-amber-400 font-mono stat-value">{totalBreakMins.toFixed(0)}</p>
          <p className="field-label stat-label">Break Min</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-green-500 summary-card-shimmer" style={{ '--pod-glow': isOnBreak ? 'rgba(245, 158, 11, 0.12)' : isClockedIn ? 'rgba(34, 197, 94, 0.12)' : 'rgba(148, 163, 184, 0.08)' } as React.CSSProperties}>
          <p className={`text-lg font-bold font-mono stat-value ${isOnBreak ? 'text-amber-400' : isClockedIn ? 'text-green-400' : 'text-rmpg-400'}`}>
            {isOnBreak ? 'BRK' : isClockedIn ? 'IN' : 'OUT'}
          </p>
          <p className="field-label stat-label">Status</p>
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
                className={`cascade-item panel-beveled p-3 border-l-2 bg-surface-base ${leftBarColor(entry.status)} ${isActiveEntry ? 'clock-active-ring' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    {/* Clock in */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="led-dot led-green" />
                      <LogIn className="w-3 h-3 text-green-400" />
                      <span className="text-green-400 font-mono">{formatTime(entry.clock_in)}</span>
                    </div>

                    {/* Clock out or Active/Break */}
                    {entry.clock_out ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="led-dot led-off" />
                        <LogOut className="w-3 h-3 text-rmpg-300" />
                        <span className="text-rmpg-300 font-mono">{formatTime(entry.clock_out)}</span>
                      </div>
                    ) : isActiveEntry ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        {entry.status === 'on_break' ? (
                          <>
                            <span className="led-dot led-amber led-breathing" />
                            <Coffee className="w-3 h-3 text-amber-400" />
                            <span className="text-amber-400 animate-pulse font-semibold">On Break</span>
                          </>
                        ) : (
                          <>
                            <span className="led-dot led-green led-breathing" />
                            <LogOut className="w-3 h-3 text-rmpg-500" />
                            <span className="text-green-400 animate-pulse font-semibold">Active</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="led-dot led-off" />
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
                        <span className="badge-pill text-[8px] px-1 py-0.5 bg-blue-900/40 text-blue-400 border border-blue-700/50 font-bold uppercase">
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
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state-container panel-beveled p-8 text-center bg-surface-base">
          <Clock className="w-8 h-8 text-rmpg-600 mx-auto mb-2 empty-state-icon" />
          <p className="text-xs text-rmpg-400">No time entries on file</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Use the clock controls above to start tracking time.</p>
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
