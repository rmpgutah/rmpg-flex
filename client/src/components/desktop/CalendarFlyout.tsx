import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const TIME_ZONES = [
  { label: 'Mountain', tz: 'America/Denver' },
  { label: 'Pacific',  tz: 'America/Los_Angeles' },
  { label: 'Eastern',  tz: 'America/New_York' },
  { label: 'UTC',      tz: 'UTC' },
] as const;

function fmtZoneTime(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()); // new-date-ok — current time for world clock display
}

export default function CalendarFlyout({ anchorRef, onClose }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Refresh world times every 30 s
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        !(anchorRef.current && anchorRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  const firstDow = new Date(year, month, 1).getDay(); // new-date-ok — numeric year/month, not a server timestamp
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // new-date-ok — numeric year/month, not a server timestamp

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelected(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelected(null);
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: '100%',
        right: 0,
        marginBottom: 8,
        width: 280,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        zIndex: 99990,
        padding: 12,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button type="button" onClick={prevMonth} aria-label="Previous month"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <ChevronLeft style={{ width: 14, height: 14, color: 'var(--text-secondary)' }} />
        </button>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button type="button" onClick={nextMonth} aria-label="Next month"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <ChevronRight style={{ width: 14, height: 14, color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DAY_HEADERS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 600,
            color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const isToday = isCurrentMonth && day === today.getDate();
          const isSel = day === selected;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelected(day)}
              style={{
                textAlign: 'center',
                fontSize: 10,
                padding: '3px 0',
                background: isToday
                  ? 'var(--desktop-shell-accent, #3e74a8)'
                  : isSel
                    ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.25)'
                    : 'transparent',
                color: isToday ? '#fff' : 'var(--text-primary)',
                border: isSel && !isToday ? '1px solid var(--border-strong)' : '1px solid transparent',
                cursor: 'pointer',
                fontWeight: isToday ? 700 : 400,
                borderRadius: 2,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Selected date detail */}
      {selected && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid var(--border-subtle)',
          fontSize: 10,
          color: 'var(--text-secondary)',
          textAlign: 'center',
        }}>
          {MONTH_NAMES[month]} {selected}, {year}
        </div>
      )}

      {/* World times — refreshes every 30 s via tick */}
      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      <div data-tick={tick} style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 8, paddingTop: 6, paddingBottom: 4, paddingLeft: 4, paddingRight: 4 }}>
        <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, color: 'var(--field-label-color)' }}>
          World Times
        </p>
        {TIME_ZONES.map(({ label, tz }) => (
          <div key={tz} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fmtZoneTime(tz)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
