// ============================================================
// RMPG Flex — Officer Schedule Detail Tab
// ============================================================

import { Calendar, Plus, Trash2, MapPin, Sun, Moon } from 'lucide-react';
import type { Schedule } from '../../../types';
import { parseTimestamp } from '../../../utils/dateUtils';

interface Props {
  schedules: Schedule[];
  onAddSchedule: () => void;
  onDeleteSchedule: (scheduleId: string) => void;
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-900/50 text-green-400 border border-green-700/50',
  cancelled: 'bg-red-900/50 text-red-400 border border-red-700/50',
  confirmed: 'bg-gray-900/50 text-gray-400 border border-gray-700/50',
  no_show: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

function isNightShift(shiftStart: string): boolean {
  if (!shiftStart) return false;
  const hour = parseTimestamp(shiftStart).getHours();
  return hour >= 18 || hour < 6;
}

function formatShiftStart(shiftStart: string): string {
  if (!shiftStart) return '-';
  return parseTimestamp(shiftStart).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatShiftEnd(shiftEnd: string): string {
  if (!shiftEnd) return '-';
  return parseTimestamp(shiftEnd).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function ScheduleDetailTab({
  schedules,
  onAddSchedule,
  onDeleteSchedule,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5">
          <Calendar className="w-3 h-3" />
          Schedules
        </h3>
        <button type="button"
          onClick={onAddSchedule}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Add Schedule
        </button>
      </div>

      {/* Schedule Cards */}
      {schedules.length > 0 ? (
        <div className="space-y-2">
          {schedules.map((sched) => {
            const night = isNightShift(sched.shift_start);
            const statusClass =
              STATUS_BADGE[sched.status] || 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600';

            return (
              <div
                key={sched.id}
                className={`panel-beveled p-3 bg-surface-base ${
                  night
                    ? 'border-t-2 border-t-purple-500'
                    : 'border-t-2 border-t-brand-500'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Left side: shift info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* Day/Night + time */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 ${
                          night
                            ? 'bg-purple-900/40 text-purple-300'
                            : 'bg-brand-900/40 text-brand-300'
                        }`}
                      >
                        {night ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                        {night ? 'NIGHT' : 'DAY'}
                      </span>
                      <span className="text-xs text-rmpg-100 font-mono">
                        {formatShiftStart(sched.shift_start)}
                        <span className="text-rmpg-500 mx-1">-</span>
                        {formatShiftEnd(sched.shift_end)}
                      </span>
                    </div>

                    {/* Status badge */}
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] px-1.5 py-0.5 font-bold uppercase ${statusClass}`}>
                        {sched.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    {/* Property */}
                    {sched.property_name && (
                      <div className="flex items-center gap-1 text-xs text-rmpg-300">
                        <MapPin className="w-3 h-3 text-rmpg-400" />
                        {sched.property_name}
                      </div>
                    )}

                    {/* Notes */}
                    {sched.notes && (
                      <p className="text-[10px] text-rmpg-400 italic">{sched.notes}</p>
                    )}
                  </div>

                  {/* Delete button (only for scheduled) */}
                  {sched.status === 'scheduled' && (
                    <button type="button"
                      onClick={() => onDeleteSchedule(sched.id)}
                      className="toolbar-btn toolbar-btn-danger flex-shrink-0"
                      title="Delete schedule"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-beveled p-10 text-center bg-surface-base" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Calendar className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No schedules on file</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click "Add Schedule" to assign shifts</p>
        </div>
      )}
    </div>
  );
}
