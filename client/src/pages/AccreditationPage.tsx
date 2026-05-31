import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { Award, CheckCircle, Clock, FileText } from 'lucide-react';

interface AccStats { standardsTotal: number; standardsCompliant: number; compliancePct: number; nextAssessment: string; }

export default function AccreditationPage() {
  const [stats, setStats] = useState<AccStats>({ standardsTotal: 0, standardsCompliant: 0, compliancePct: 0, nextAssessment: '' });

  useEffect(() => {
    apiFetch<AccStats>('/accreditation/stats').catch(() => null).then(d => d && setStats(d));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ACCREDITATION" icon={Award} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL STANDARDS" value={String(stats.standardsTotal)} icon={FileText} />
        <StatsCard label="COMPLIANT" value={String(stats.standardsCompliant)} icon={CheckCircle} />
        <StatsCard label="COMPLIANCE RATE" value={`${stats.compliancePct}%`} icon={Award} />
        <StatsCard label="NEXT ASSESSMENT" value={stats.nextAssessment || 'N/A'} icon={Clock} />
      </div>
      <div className="panel-beveled p-4">
        <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Accreditation Status</h3>
        <div className="text-[11px] text-rmpg-300">
          <p className="mb-2">Accreditation Body: <span className="text-rmpg-400">CALEA / State POST</span></p>
          <p className="mb-2">Current Status: <span className={`badge ${stats.compliancePct >= 95 ? 'badge-available' : stats.compliancePct >= 60 ? 'badge-dispatched' : 'badge-busy'}`}>{stats.compliancePct >= 95 ? 'CERTIFIED' : stats.compliancePct >= 60 ? 'IN PROGRESS' : 'NEEDS ATTENTION'}</span></p>
        </div>
      </div>
    </div>
  );
}
