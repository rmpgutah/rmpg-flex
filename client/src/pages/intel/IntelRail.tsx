// Left rail nav for the Intel Portal. NavLink active state highlights the
// current section; badge counts come from the dashboard overview poll.
import { NavLink } from 'react-router-dom';

export interface RailCounts { watchlist: number; bolos: number; alerts: number; queues: number; aiOnline: boolean }

interface Item { to: string; label: string; icon: string; end?: boolean; badge?: number; badgeRed?: boolean; off?: boolean }

export default function IntelRail({ counts }: { counts: RailCounts }) {
  const groups: Array<{ title: string; items: Item[] }> = [
    { title: 'Workspace', items: [
      { to: '/intel', label: 'Dashboard', icon: '▦', end: true },
      { to: '/intel/search', label: 'Search', icon: '⌕' },
      { to: '/intel/connections', label: 'Connections', icon: '◈' },
    ]},
    { title: 'Watch & Alert', items: [
      { to: '/intel/watchlist', label: 'Watchlist', icon: '◉', badge: counts.watchlist },
      { to: '/intel/bolos', label: 'BOLO Board', icon: '⚑', badge: counts.bolos, badgeRed: true },
      { to: '/intel/alerts', label: 'Alerts', icon: '▲', badge: counts.alerts, badgeRed: true },
    ]},
    { title: 'Sources', items: [
      { to: '/intel/jail', label: 'Jail / Bookings', icon: '⛓' },
      { to: '/intel/plate-log', label: 'Plate Sightings', icon: '🚗' },
      { to: '/intel/queues', label: 'Review Queues', icon: '⚐', badge: counts.queues },
    ]},
    { title: 'Intelligence', items: [
      { to: '/intel/map', label: 'Map', icon: '◎' },
      { to: '/intel/ai', label: 'AI Analyst', icon: '✦', off: !counts.aiOnline },
      { to: '/intel/reports', label: 'Intel Products', icon: '▤' },
    ]},
  ];

  return (
    <nav className="w-[168px] bg-[#050505] border-r border-[#232323] py-2 overflow-y-auto shrink-0">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="font-mono text-[8px] tracking-widest text-[#444] px-[14px] pt-[10px] pb-[5px] uppercase">{g.title}</div>
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end}
              className={({ isActive }) =>
                `flex items-center gap-[9px] px-[14px] py-[7px] text-[12px] border-l-2 ${
                  isActive ? 'bg-[#0c0c0c] text-rmpg-100 border-[#d4a017]' : 'text-[#bdbdbd] border-transparent'}`}>
              <span className="w-[14px] text-center text-[#777]">{it.icon}</span>
              <span>{it.label}</span>
              {typeof it.badge === 'number' && it.badge > 0 && (
                <span className={`ml-auto font-mono text-[9px] rounded-[2px] px-[5px] ${it.badgeRed ? 'bg-[#dc2626] text-rmpg-100' : 'bg-[#d4a017] text-black'}`}>{it.badge}</span>
              )}
              {it.off && <span className="ml-auto font-mono text-[7px] text-[#888] border border-[#333] rounded-[2px] px-[4px] tracking-wide">OFFLINE</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
