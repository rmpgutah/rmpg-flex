// Dashboard card — next 7 days across ALL scheduled sources (serve
// attempts, shift plans, court events, custom events) via the unified
// /api/scheduler/upcoming feed. Click-through opens each item's native
// surface; header opens the full SchedulerPage.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { CalendarDays, FileText, Users, Gavel, ChevronRight } from 'lucide-react';

interface UpcomingItem {
  key: string;
  source: 'serve' | 'shift' | 'court' | 'custom';
  date: string;
  start: string | null;
  title: string;
  subtitle: string | null;
  link: string | null;
}

const ICONS = { serve: FileText, shift: Users, court: Gavel, custom: CalendarDays } as const;
const TONES = { serve: 'text-brand-400', shift: 'text-blue-300', court: 'text-purple-300', custom: 'text-emerald-300' } as const;

export default function UpcomingSchedulePanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiFetch<{ items: UpcomingItem[] }>('/scheduler/upcoming?days=7')
      .then((d) => setItems((d.items || []).slice(0, 8)))
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="border border-rmpg-800 rounded bg-surface-raised">
      <button onClick={() => navigate('/scheduler')}
        className="w-full flex items-center justify-between px-3 py-[4px] border-b border-rmpg-800 text-left group">
        <span className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-rmpg-400">
          <CalendarDays className="w-3.5 h-3.5 text-brand-400" /> Upcoming Schedule — 7 Days
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-rmpg-600 group-hover:text-brand-400" />
      </button>
      {!loaded && <div className="px-3 py-3 text-[10px] text-rmpg-600">Loading…</div>}
      {loaded && items.length === 0 && (
        <div className="px-3 py-3 text-[10px] text-rmpg-600">Nothing scheduled in the next 7 days.</div>
      )}
      <div className="divide-y divide-rmpg-800/60">
        {items.map((i) => {
          const Icon = ICONS[i.source];
          return (
            <button key={i.key} onClick={() => navigate(i.link || '/scheduler')}
              className="w-full flex items-center gap-2 px-3 py-[4px] text-left text-[11px] hover:bg-surface-base/60">
              <Icon className={`w-3.5 h-3.5 shrink-0 ${TONES[i.source]}`} />
              <span className="font-mono text-rmpg-400 w-[86px] shrink-0">{i.date.slice(5)}{i.start ? ` ${i.start}` : ''}</span>
              <span className="truncate text-rmpg-100">{i.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
