// ============================================================
// RMPG Flex — Personnel: Time & Attendance Tab
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Clock, LogIn, LogOut, Coffee, Users, BarChart3, Pencil, Trash2 } from 'lucide-react';
import type { TimeEntry } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { parseTimestamp } from '../../../utils/dateUtils';

interface Props {
  timeEntries: TimeEntry[];
  officers: OfficerWithStatus[];
  onEditTimeEntry?: (entry: TimeEntry) => void;
  onDeleteTimeEntry?: (entryId: string) => void;
}

export default function TimeAttendanceTab({ timeEntries, officers, onEditTimeEntry, onDeleteTimeEntry }: Props) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // Compute summary stats
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

  // Active clock-ins (clocked_in + on_break)
  const activeEntries = useMemo(() => {
    return timeEntries.filter((te) => te.status === 'clocked_in' || te.status === 'on_break');
  }, [timeEntries]);

  function formatClockTime(dateStr?: string): string {
    if (!dateStr) return '-';
    const d = parseTimestamp(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function getElapsedHours(clockIn: string): string {
    const diff = Date.now() - parseTimestamp(clockIn).getTime();
    const hrs = (diff / 3600000).toFixed(1);
    return `${hrs}h`;
  }

  const SUMMARY_CARDS = [
    { label: 'Currently Clocked In', value: stats.clockedInCount, icon: LogIn, color: 'text-green-400', bgClass: 'bg-surface-base', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Total Hours', value: stats.totalHours, icon: Clock, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'On Break', value: stats.onBreakCount, icon: Coffee, color: 'text-amber-400', bgClass: 'bg-surface-base', border: 'border-amber-700/30', topBorder: 'border-t-amber-500' },
    { label: 'Clocked Out', value: stats.clockedOutCount, icon: LogOut, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-600' },
    { label: 'Avg Hours/Officer', value: stats.avgHours, icon: BarChart3, color: 'text-brand-400', bgClass: 'bg-surface-base', border: 'border-brand-700/30', topBorder: 'border-t-brand-500' },
  ];

  // Set document title
  useEffect(() => { document.title = 'Personnel - Time \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Time & Attendance</h2>
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

      {/* Active Clock-Ins */}
      {activeEntries.length > 0 && (
        <div className="panel-beveled p-3 border border-green-700/30 border-l-2 border-l-green-500 bg-surface-base">
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
                <td colSpan={(onEditTimeEntry || onDeleteTimeEntry) ? 7 : 6} className="text-center py-8 text-rmpg-500 text-[10px]">
                  No time entries to display.
                </td>
              </tr>
            ) : (
              timeEntries.map((te) => (
                <tr key={te.id}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {te.status === 'clocked_in' && <span className="led-dot led-green" />}
                      {te.status === 'on_break' && <span className="led-dot led-amber" />}
                      {te.status === 'clocked_out' && <span className="led-dot led-off" />}
                      {te.status === 'edited' && <span className="led-dot led-gray" />}
                      <span className="text-xs text-rmpg-200">{te.officer_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-300">
                      <LogIn className="w-2.5 h-2.5 inline mr-0.5 text-green-400" />
                      {formatClockTime(te.clock_in)}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-300">
                      {te.clock_out ? (
                        <>
                          <LogOut className="w-2.5 h-2.5 inline mr-0.5 text-rmpg-400" />
                          {formatClockTime(te.clock_out)}
                        </>
                      ) : (
                        <span className="text-rmpg-600">-</span>
                      )}
                    </span>
                  </td>
                  <td>
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
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold bg-gray-900/50 text-gray-400 border border-gray-700/50">
                        Edited
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="text-xs font-mono text-rmpg-400">{te.break_minutes || 0}</span>
                  </td>
                  <td className="text-right">
                    <span className="text-xs font-mono font-bold text-rmpg-200">
                      {te.total_hours != null ? Number(te.total_hours).toFixed(1) : (
                        (te.status === 'clocked_in' || te.status === 'on_break') ? getElapsedHours(te.clock_in) : '-'
                      )}
                    </span>
                  </td>
                  {(onEditTimeEntry || onDeleteTimeEntry) && (
                    <td>
                      <div className="flex items-center gap-0.5">
                        {onEditTimeEntry && (
                          <button type="button"
                            onClick={() => onEditTimeEntry(te)}
                            className="toolbar-btn p-1"
                            title="Edit time entry"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteTimeEntry && (
                          <button type="button"
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
