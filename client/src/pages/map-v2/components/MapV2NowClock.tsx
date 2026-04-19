import { useEffect, useState } from 'react';

/**
 * Live SLC-local clock + date — bottom-center chrome. Single-second tick.
 * Mountain time, displayed monospaced as "MON 14:23:07 MDT".
 */
export default function MapV2NowClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const day = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Denver' }).toUpperCase();
  const time = now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Denver' });
  const tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short', timeZone: 'America/Denver' }).split(' ').pop();
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-2 py-1 bg-[#141414] border border-[#222222] text-[#9ca3af] font-mono text-[10px] tabular-nums tracking-wider pointer-events-none">
      {day} {time} {tz}
    </div>
  );
}
