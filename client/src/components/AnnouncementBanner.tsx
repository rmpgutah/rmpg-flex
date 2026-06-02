import { useState, useEffect, useCallback } from 'react';
import { Megaphone, AlertTriangle, Info, Wrench, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// Officer-facing reader for admin broadcasts. Pulls active, role-scoped,
// in-window announcements from GET /api/announcements (the admin CRUD
// lives in the Admin → System Config? no — Admin → Announcements tab).
// Dismissals persist per-announcement in localStorage so a banner the
// officer closed doesn't reappear on every page navigation.

interface Announcement {
  id: number;
  title: string;
  body?: string | null;
  type: 'info' | 'warning' | 'maintenance' | 'update' | 'policy';
  priority: 'normal' | 'high' | 'critical';
}

const LS_DISMISSED = 'rmpg_dismissed_announcements';
const TYPE_STYLES: Record<string, { icon: React.ElementType; cls: string }> = {
  warning: { icon: AlertTriangle, cls: 'bg-amber-900/40 border-amber-700/50 text-amber-200' },
  maintenance: { icon: Wrench, cls: 'bg-amber-900/40 border-amber-700/50 text-amber-200' },
  policy: { icon: Info, cls: 'bg-[#1a1408] border-[#3a2e10] text-[#d4a017]' },
  update: { icon: Info, cls: 'bg-[#101010] border-[#2e2e2e] text-rmpg-200' },
  info: { icon: Megaphone, cls: 'bg-[#101010] border-[#2e2e2e] text-rmpg-200' },
};

function loadDismissed(): number[] {
  try { return JSON.parse(localStorage.getItem(LS_DISMISSED) || '[]'); } catch { return []; }
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<number[]>(loadDismissed);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Announcement[]>('/announcements');
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // Silent — a broadcast feed failing must not disrupt the shell.
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh every 5 min so newly posted broadcasts surface without reload.
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const dismiss = (id: number) => {
    const next = [...new Set([...dismissed, id])];
    setDismissed(next);
    try { localStorage.setItem(LS_DISMISSED, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const visible = items.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col">
      {visible.map((a) => {
        const style = TYPE_STYLES[a.type] || TYPE_STYLES.info;
        const Icon = style.icon;
        return (
          <div key={a.id} className={`border-b px-4 py-1.5 flex items-center gap-2 ${style.cls}`} role="status">
            <Icon className="w-4 h-4 shrink-0" />
            {a.priority === 'critical' && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 bg-red-700/60 text-red-100 rounded-sm shrink-0">Critical</span>
            )}
            <span className="text-xs font-semibold shrink-0">{a.title}</span>
            {a.body && <span className="text-[11px] opacity-90 truncate">— {a.body}</span>}
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="ml-auto opacity-70 hover:opacity-100 transition-opacity shrink-0"
              aria-label={`Dismiss announcement: ${a.title}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
