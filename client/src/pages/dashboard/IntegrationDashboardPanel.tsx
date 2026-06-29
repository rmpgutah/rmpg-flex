// IntegrationDashboardPanel — cross-system KPI overview widget
import { useEffect, useState } from 'react';
import { Activity, Shield, Truck, Users, Server, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import SpmGroup from './SpmGroup';

interface IntegrationData {
  dispatch: { activeCalls: number; p1Calls: number; avgResponseMin: number };
  fleet: { totalVehicles: number; available: number; inMaintenance: number; serviceOverdue: number };
  personnel: { onDuty: number; total: number; fatigueWarnings: number };
  system_health?: { db: string; kv: string; r2: string };
}

function Stat({ icon: Icon, label, value, accent = 'text-rmpg-100', sub }: { icon: any; label: string; value: number | string; accent?: string; sub?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1">
      <Icon size={12} className="text-rmpg-500 shrink-0" />
      <span className="text-[10px] text-rmpg-400">{label}</span>
      <span className={`text-[11px] font-bold ml-auto tabular-nums ${accent}`}>{value}</span>
      {sub && <span className="text-[9px] text-rmpg-500">{sub}</span>}
    </div>
  );
}

export default function IntegrationDashboardPanel() {
  const [data, setData] = useState<IntegrationData | null>(null);
  const [health, setHealth] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [integ, h] = await Promise.all([
          apiFetch<IntegrationData>('/dispatch/aggregates/integration-dashboard').catch(() => null),
          apiFetch<{ status: string; services?: Record<string, string> }>('/health').catch(() => null),
        ]);
        if (cancelled) return;
        setData(integ);
        if (h?.services) setHealth(h.services as Record<string, string>);
      } catch { /* ignore */ }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <SpmGroup title="INTEGRATION OVERVIEW" tone="steel"><div className="p-2 text-[10px] text-rmpg-500">Loading…</div></SpmGroup>;
  if (!data) return null;

  const allHealthy = Object.values(health).every(s => s === 'ok');

  return (
    <SpmGroup title="INTEGRATION OVERVIEW" tone="steel" collapsible defaultCollapsed>
      <div className="p-1.5 space-y-1">
        <div className="grid grid-cols-2 gap-x-2">
          <Stat icon={Activity} label="Dispatch" value={`${data.dispatch?.activeCalls ?? 0} calls`} accent={data.dispatch?.p1Calls > 0 ? 'text-red-400' : 'text-rmpg-100'} sub={data.dispatch?.p1Calls > 0 ? `${data.dispatch.p1Calls} P1` : undefined} />
          <Stat icon={Shield} label="Avg Resp" value={data.dispatch?.avgResponseMin ? `${data.dispatch.avgResponseMin}m` : '—'} />
          <Stat icon={Truck} label="Fleet" value={`${data.fleet?.available ?? 0}/${data.fleet?.totalVehicles ?? 0}`} accent={(data.fleet?.inMaintenance ?? 0) > 1 ? 'text-amber-400' : 'text-green-400'} />
          <Stat icon={Users} label="Personnel" value={`${data.personnel?.onDuty ?? 0} on duty`} accent={data.personnel?.fatigueWarnings > 0 ? 'text-amber-400' : 'text-rmpg-100'} />
        </div>
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 border-t border-rmpg-700/50">
          <div className={`w-1.5 h-1.5 rounded-full ${allHealthy ? 'bg-green-500' : 'bg-amber-500'}`} />
          <span className="text-[9px] text-rmpg-400">Systems:</span>
          {Object.entries(health).slice(0, 3).map(([k, v]) => (
            <span key={k} className={`text-[9px] ${v === 'ok' ? 'text-green-400' : 'text-amber-400'}`}>
              {k}: {v}
            </span>
          ))}
        </div>
      </div>
    </SpmGroup>
  );
}
