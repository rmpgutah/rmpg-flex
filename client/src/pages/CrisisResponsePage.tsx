import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { Brain, Heart, PhoneCall, Users } from 'lucide-react';

interface CrisisStats { citCalls: number; resolvedOnScene: number; diversionRate: number; teamsAvailable: number; }

export default function CrisisResponsePage() {
  const [stats, setStats] = useState<CrisisStats>({ citCalls: 0, resolvedOnScene: 0, diversionRate: 0, teamsAvailable: 0 });

  useEffect(() => {
    apiFetch<CrisisStats>('/crisis/stats').catch(() => null).then(d => d && setStats(d));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="CRISIS RESPONSE" icon={Brain} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="CIT DEPLOYMENTS" value={String(stats.citCalls)} icon={PhoneCall} />
        <StatsCard label="RESOLVED ON SCENE" value={String(stats.resolvedOnScene)} icon={Heart} />
        <StatsCard label="DIVERSION RATE" value={`${stats.diversionRate}%`} icon={Users} />
        <StatsCard label="TEAMS AVAILABLE" value={String(stats.teamsAvailable)} icon={Brain} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-beveled p-4">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Crisis Resources</h3>
          <div className="space-y-2 text-[11px] text-rmpg-300">
            <div className="flex items-center gap-2"><PhoneCall size={14} className="text-rmpg-400" /><span>988 Suicide & Crisis Lifeline</span></div>
            <div className="flex items-center gap-2"><Heart size={14} className="text-rmpg-400" /><span>Mobile Crisis Outreach Team: (801) 555-0147</span></div>
            <div className="flex items-center gap-2"><Users size={14} className="text-rmpg-400" /><span>Receiving Facility: University Neuropsychiatric Institute</span></div>
          </div>
        </div>
        <div className="panel-beveled p-4">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">De-escalation Best Practices</h3>
          <div className="text-[10px] text-rmpg-400 space-y-1">
            <p>• Active listening — validate without agreeing</p>
            <p>• Maintain safe distance — allow escape routes</p>
            <p>• Use calm, slow speech patterns</p>
            <p>• Avoid sudden movements or loud commands</p>
            <p>• Request CIT-trained officer if available</p>
            <p>• Consider mobile crisis team co-response</p>
            <p>• Document de-escalation techniques used</p>
          </div>
        </div>
      </div>
    </div>
  );
}
