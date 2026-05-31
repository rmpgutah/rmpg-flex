import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { ShieldAlert, Users, SprayCanIcon as Spray, TrendingUp } from 'lucide-react';

interface GangMember { id: string; name: string; moniker: string; gang_name: string; status: string; }
interface Gang { id: string; name: string; colors: string; member_count: number; threat_level: string; }
interface Stats { totalMembers: number; activeMembers: number; }

export default function GangIntelPage() {
  const [members, setMembers] = useState<GangMember[]>([]);
  const [gangs, setGangs] = useState<Gang[]>([]);
  const [stats, setStats] = useState<Stats>({ totalMembers: 0, activeMembers: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<GangMember[]>('/gang-intel').catch(() => []),
      apiFetch<Gang[]>('/gang-intel/gangs').catch(() => []),
      apiFetch<Stats>('/gang-intel/stats').catch(() => ({ totalMembers: 0, activeMembers: 0 })),
    ]).then(([m, g, s]) => { setMembers(m); setGangs(g); setStats(s); setLoading(false); });
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="GANG INTELLIGENCE" icon={ShieldAlert} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL MEMBERS" value={String(stats.totalMembers)} icon={Users} />
        <StatsCard label="ACTIVE" value={String(stats.activeMembers)} icon={TrendingUp} />
        <StatsCard label="GANGS TRACKED" value={String(gangs.length)} icon={Spray} />
        <StatsCard label="THREAT LEVEL" value="MEDIUM" icon={ShieldAlert} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-beveled p-3">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-2">Known Gang Members</h3>
          <table className="table-dark w-full">
            <thead><tr><th>Name</th><th>Moniker</th><th>Gang</th><th>Status</th></tr></thead>
            <tbody>
              {members.slice(0, 20).map(m => (
                <tr key={m.id}><td className="text-[11px]">{m.name}</td><td className="text-[11px] text-rmpg-400">{m.moniker || '--'}</td><td className="text-[11px]">{m.gang_name}</td><td><span className={`badge ${m.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>{m.status}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-beveled p-3">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-2">Tracked Gangs</h3>
          <table className="table-dark w-full">
            <thead><tr><th>Gang Name</th><th>Colors</th><th>Members</th><th>Threat</th></tr></thead>
            <tbody>
              {gangs.map(g => (
                <tr key={g.id}><td className="text-[11px]">{g.name}</td><td className="text-[11px] text-rmpg-400">{g.colors || '--'}</td><td className="text-[11px]">{g.member_count}</td><td><span className={`badge ${g.threat_level === 'critical' ? 'badge-p1' : g.threat_level === 'high' ? 'badge-p2' : 'badge-p3'}`}>{g.threat_level}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
