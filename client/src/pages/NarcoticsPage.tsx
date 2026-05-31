import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { Pill, TrendingUp, Scale, Shield, DollarSign } from 'lucide-react';

interface NarcStats { totalInvestigations: number; totalSeizures: number; totalStreetValue: number; activeCIs: number; }

export default function NarcoticsPage() {
  const [stats, setStats] = useState<NarcStats>({ totalInvestigations: 0, totalSeizures: 0, totalStreetValue: 0, activeCIs: 0 });

  useEffect(() => {
    apiFetch<NarcStats>('/narcotics/stats').catch(() => null).then(d => d && setStats(d));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="NARCOTICS & VICE" icon={Pill} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="ACTIVE INVESTIGATIONS" value={String(stats.totalInvestigations)} icon={Shield} />
        <StatsCard label="TOTAL SEIZURES" value={String(stats.totalSeizures)} icon={Scale} />
        <StatsCard label="STREET VALUE" value={`$${(stats.totalStreetValue || 0).toLocaleString()}`} icon={DollarSign} />
        <StatsCard label="ACTIVE CIs" value={String(stats.activeCIs)} icon={TrendingUp} />
      </div>
      <div className="panel-beveled p-4">
        <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Drug Trend Monitoring</h3>
        <div className="text-[10px] text-rmpg-400">
          <p>Drug trend data, seizure analysis, and overdose mapping are available through <span className="text-brand-gold">Crime Analysis Dashboard</span>.</p>
        </div>
      </div>
    </div>
  );
}
