import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { Swords, Shield, Wrench, AlertTriangle } from 'lucide-react';

interface Callout { id: string; date: string; call_type: string; location: string; resolution: string; duration_minutes: number; }
interface Equipment { id: string; equipment_type: string; serial_number: string; condition: string; assigned_to: string; }
interface Stats { totalCallouts: number; }

export default function SpecialOpsPage() {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [stats, setStats] = useState<Stats>({ totalCallouts: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<Callout[]>('/special-ops/callouts').catch(() => []),
      apiFetch<Equipment[]>('/special-ops/equipment').catch(() => []),
      apiFetch<Stats>('/special-ops/stats').catch(() => ({ totalCallouts: 0 })),
    ]).then(([c, e, s]) => { setCallouts(c); setEquipment(e); setStats(s); });
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SPECIAL OPERATIONS" icon={Swords} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL CALLOUTS" value={String(stats.totalCallouts)} icon={AlertTriangle} />
        <StatsCard label="EQUIPMENT ITEMS" value={String(equipment.length)} icon={Wrench} />
        <StatsCard label="READY RATE" value={`${equipment.length > 0 ? Math.round(equipment.filter(e => e.condition === 'ready').length / equipment.length * 100) : 100}%`} icon={Shield} />
        <StatsCard label="STATUS" value="STANDBY" icon={Swords} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-beveled p-3">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-2">Recent Callouts</h3>
          <table className="table-dark w-full">
            <thead><tr><th>Date</th><th>Type</th><th>Location</th><th>Resolution</th></tr></thead>
            <tbody>
              {callouts.slice(0, 20).map(c => (
                <tr key={c.id}><td className="text-[10px]">{c.date?.slice(0,10)}</td><td className="text-[10px]">{c.call_type}</td><td className="text-[10px] text-rmpg-400">{c.location}</td><td className="text-[10px]">{c.resolution}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-beveled p-3">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-2">Equipment Inventory</h3>
          <table className="table-dark w-full">
            <thead><tr><th>Type</th><th>Serial #</th><th>Condition</th></tr></thead>
            <tbody>
              {equipment.map(e => (
                <tr key={e.id}><td className="text-[10px]">{e.equipment_type}</td><td className="text-[10px] font-mono text-rmpg-400">{e.serial_number}</td><td><span className={`badge ${e.condition === 'ready' ? 'badge-available' : e.condition === 'repair' ? 'badge-busy' : 'badge-pending'}`}>{e.condition}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
