// ============================================================
// RMPG Flex — Personnel: Schedule Tab (Weekly Grid)
// ============================================================

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Plus } from 'lucide-react';
import type { Schedule } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { DAYS, getWeekMonday, formatWeekLabel, dateToYMD } from '../utils/personnelFormatters';

interface Props {
  officers: OfficerWithStatus[];
  schedules: Schedule[];
  weekMonday: Date;
  onWeekChange: (monday: Date) => void;
  onAddSchedule: () => void;
}

export default function ScheduleTab({ officers, schedules, weekMonday, onWeekChange, onAddSchedule }: Props) {
  // Build array of 7 dates for the week
  const weekDates = useMemo(() => {
    return DAYS.map((_, i) => {
      const d = new Date(weekMonday);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekMonday]);

  const todayYMD = dateToYMD(new Date());

  // Officers who have schedules in this week
  const officersWithSchedules = useMemo(() => {
    const weekStart = dateToYMD(weekDates[0]);
    const weekEnd = dateToYMD(weekDates[6]);

    const idsInWeek = new Set<string>();
    for (const s of schedules) {
      const shiftDate = s.shift_start ? dateToYMD(new Date(s.shift_start)) : '';
      if (shiftDate >= weekStart && shiftDate <= weekEnd) {
        idsInWeek.add(s.officer_id);
      }
    }

    if (idsInWeek.size > 0) {
      return officers.filter((o) => idsInWeek.has(o.id));
    }
    // Fallback: show first 8 officers
    return officers.slice(0, 8);
  }, [officers, schedules, weekDates]);

  // Map officer_id + date -> schedules for that cell
  const scheduleMap = useMemo(() => {
    const map = new Map<string, Schedule[]>();
    for (const s of schedules) {
      if (!s.shift_start) continue;
      const ymd = dateToYMD(new Date(s.shift_start));
      const key = `${s.officer_id}_${ymd}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [schedules]);

  function handlePrevWeek() {
    const prev = new Date(weekMonday);
    prev.setDate(prev.getDate() - 7);
    onWeekChange(prev);
  }

  function handleNextWeek() {
    const next = new Date(weekMonday);
    next.setDate(next.getDate() + 7);
    onWeekChange(next);
  }

  function handleToday() {
    onWeekChange(getWeekMonday(new Date()));
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function isNightShift(s: Schedule): boolean {
    if (!s.shift_start) return false;
    const hour = new Date(s.shift_start).getHours();
    return hour >= 18 || hour < 6;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
        <div className="flex items-center">
          <Calendar className="w-4 h-4 section-icon" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider ml-2">Schedule</h2>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={onAddSchedule} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1.5">
              <Plus className="w-3 h-3" />
              Add Schedule
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
      {/* Week Navigation */}
      <div className="flex items-center justify-center">
        <div className="panel-beveled p-1.5 flex items-center gap-1 bg-gradient-to-b from-surface-raised to-surface-sunken rounded-sm">
          <button onClick={handlePrevWeek} className="toolbar-btn p-1 rounded-sm">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleToday} className="toolbar-btn text-brand-400 text-[10px] px-2 py-0.5 rounded-sm">
            Today
          </button>
          <span className="text-xs font-bold font-mono text-rmpg-200 min-w-[190px] text-center tracking-wide">
            {formatWeekLabel(weekMonday)}
          </span>
          <button onClick={handleNextWeek} className="toolbar-btn p-1 rounded-sm">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* No officers fallback */}
      {officersWithSchedules.length === 0 ? (
        <div className="empty-state-container text-center py-16">
          <div className="empty-state-icon w-16 h-16 mx-auto mb-4 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
            <Calendar className="w-8 h-8 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-400 font-medium">No officers or schedules to display</p>
          <p className="text-[10px] text-rmpg-600 mt-1.5">Add schedules to populate the weekly grid.</p>
        </div>
      ) : (
        <div className="panel-beveled overflow-x-auto bg-surface-sunken">
          <div className="grid grid-cols-8 min-w-[700px]">
            {/* Header Row */}
            <div className="p-2 text-[9px] text-rmpg-400 uppercase font-bold tracking-wider border-b border-rmpg-700 bg-gradient-to-b from-rmpg-800 to-surface-sunken">
              Officer
            </div>
            {weekDates.map((d, i) => {
              const ymd = dateToYMD(d);
              const isToday = ymd === todayYMD;
              return (
                <div
                  key={i}
                  className={`cascade-item p-2 text-center border-b border-rmpg-700 bg-gradient-to-b from-rmpg-800 to-surface-sunken ${
                    isToday ? 'schedule-today border-brand-500' : ''
                  }`}
                >
                  <div className={`text-[9px] uppercase font-bold tracking-wider ${isToday ? 'text-brand-400' : 'text-rmpg-400'}`}>
                    {DAYS[i]}
                  </div>
                  <div className={`text-[10px] font-mono ${isToday ? 'text-brand-300 font-bold' : 'text-rmpg-500'}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}

            {/* Officer Rows */}
            {officersWithSchedules.map((officer) => (
              <React.Fragment key={officer.id}>
                {/* Officer name cell */}
                <div className="p-2 border-b border-rmpg-700/50 flex items-center gap-1.5 bg-surface-sunken">
                  <span className={officer.status === 'on_duty' ? 'led-dot led-green' : 'led-dot led-off'} />
                  <span className="text-[10px] text-rmpg-300 font-medium truncate max-w-[90px]">
                    {officer.last_name}, {officer.first_name?.[0] || ''}.
                  </span>
                </div>

                {/* Day cells */}
                {weekDates.map((d, dayIdx) => {
                  const ymd = dateToYMD(d);
                  const isToday = ymd === todayYMD;
                  const key = `${officer.id}_${ymd}`;
                  const cellSchedules = scheduleMap.get(key) || [];

                  return (
                    <div
                      key={dayIdx}
                      className={`cascade-item p-1 border-b border-rmpg-700/50 min-h-[44px] ${
                        isToday ? 'schedule-today border-brand-500' : ''
                      }`}
                    >
                      {cellSchedules.map((s) => {
                        const night = isNightShift(s);
                        return (
                          <div
                            key={s.id}
                            className={`schedule-shift panel-inset px-1.5 py-1 mb-0.5 border rounded-sm ${
                              night
                                ? 'schedule-shift-night bg-indigo-900/10'
                                : 'schedule-shift-day'
                            }`}
                          >
                            <div className="font-mono text-[10px] text-rmpg-300 leading-tight">
                              {formatTime(s.shift_start)}-{formatTime(s.shift_end)}
                            </div>
                            {s.property_name && (
                              <div className="text-[8px] text-rmpg-500 truncate mt-0.5 max-w-[80px]">
                                {s.property_name}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
