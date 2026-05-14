import { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import IconButton from '../../../components/IconButton';

interface Shift {
  id: number;
  officer_id: number;
  officer_name: string;
  badge_number: string;
  property_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  status: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarTab() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const loadShifts = async () => {
    setLoading(true);
    try {
      try { const data = await apiFetch<any[]>(`/personnel/calendar/shifts?year=${year}&month=${month}`); setShifts(data); } catch { /* handled */ }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadShifts(); }, [year, month]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const weeks: (number | null)[][] = [];
  let currentDay = 1;
  for (let week = 0; week < 6; week++) {
    const row: (number | null)[] = [];
    for (let dow = 0; dow < 7; dow++) {
      if ((week === 0 && dow < firstDay) || currentDay > daysInMonth) {
        row.push(null);
      } else {
        row.push(currentDay++);
      }
    }
    weeks.push(row);
    if (currentDay > daysInMonth) break;
  }

  // Group shifts by date
  const shiftsByDate: Record<string, Shift[]> = {};
  for (const s of shifts) {
    const d = s.shift_date?.substring(8, 10)?.replace(/^0/, '');
    if (d) {
      if (!shiftsByDate[d]) shiftsByDate[d] = [];
      shiftsByDate[d].push(s);
    }
  }

  const today = new Date();
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><Calendar className="w-4 h-4" /> Schedule Calendar</h2>
        <div className="flex items-center gap-2">
          <IconButton aria-label="Previous month" onClick={prevMonth} className="toolbar-btn p-1"><ChevronLeft className="w-3.5 h-3.5" /></IconButton>
          <span className="text-xs text-white font-bold w-36 text-center">{MONTHS[month - 1]} {year}</span>
          <IconButton aria-label="Next month" onClick={nextMonth} className="toolbar-btn p-1"><ChevronRight className="w-3.5 h-3.5" /></IconButton>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-8 text-xs"><Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" /> Loading calendar...</div>
      ) : (
        <div className="border border-rmpg-700">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-rmpg-700">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] text-rmpg-400 py-1 font-bold border-r border-rmpg-700 last:border-r-0">{d}</div>
            ))}
          </div>
          {/* Calendar weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-rmpg-700/50 last:border-b-0">
              {week.map((day, di) => {
                const dayShifts = day ? shiftsByDate[String(day)] || [] : [];
                return (
                  <div key={di} className={`min-h-[60px] p-1 border-r border-rmpg-800 last:border-r-0 ${
                    day ? 'bg-surface-sunken' : 'bg-[#0d0d0d]'
                  } ${isToday(day || 0) ? 'ring-1 ring-inset ring-brand-500' : ''}`}>
                    {day && (
                      <>
                        <span className={`text-[10px] font-bold ${isToday(day) ? 'text-brand-400' : 'text-rmpg-300'}`}>{day}</span>
                        <div className="space-y-0.5 mt-0.5">
                          {dayShifts.slice(0, 3).map((s, si) => (
                            <div key={si} className="text-[8px] px-1 py-0.5 bg-brand-900/30 text-brand-300 truncate leading-tight">
                              {s.officer_name?.split(' ').pop()} {s.start_time?.substring(0, 5)}
                            </div>
                          ))}
                          {dayShifts.length > 3 && (
                            <div className="text-[8px] text-rmpg-400 text-center">+{dayShifts.length - 3} more</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Shift count summary */}
      <div className="flex items-center gap-4 text-[10px] text-rmpg-400">
        <span>Total shifts this month: <strong className="text-white">{shifts.length}</strong></span>
        <span>Unique officers: <strong className="text-white">{new Set(shifts.map(s => s.officer_id)).size}</strong></span>
      </div>
    </div>
  );
}
