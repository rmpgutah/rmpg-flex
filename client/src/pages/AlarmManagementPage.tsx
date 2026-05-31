import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { Bell, AlertTriangle, ShieldCheck, DollarSign } from 'lucide-react';

interface AlarmStats { totalAlarms: number; falseAlarms: number; permitsActive: number; permitsExpired: number; revenueCollected: number; }

export default function AlarmManagementPage() {
  const [stats, setStats] = useState<AlarmStats>({ totalAlarms: 0, falseAlarms: 0, permitsActive: 0, permitsExpired: 0, revenueCollected: 0 });

  useEffect(() => {
    apiFetch<AlarmStats>('/alarms/stats').catch(() => null).then(d => d && setStats(d));
  }, []);

  const falseRate = stats.totalAlarms > 0 ? Math.round(stats.falseAlarms / stats.totalAlarms * 100) : 0;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ALARM MANAGEMENT" icon={Bell} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL ALARMS" value={String(stats.totalAlarms)} icon={Bell} />
        <StatsCard label="FALSE ALARM RATE" value={`${falseRate}%`} icon={AlertTriangle} />
        <StatsCard label="ACTIVE PERMITS" value={String(stats.permitsActive)} icon={ShieldCheck} />
        <StatsCard label="REVENUE" value={`$${(stats.revenueCollected || 0).toLocaleString()}`} icon={DollarSign} />
      </div>
      <div className="panel-beveled p-4">
        <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Alarm Response Protocol</h3>
        <div className="text-[10px] text-rmpg-400 space-y-1">
          <p className="text-rmpg-300 font-semibold">Priority 1 (Immediate Response):</p>
          <p className="ml-4">• Panic / Holdup alarms • Verified alarms with video/audio confirmation • Multiple zone activation</p>
          <p className="text-rmpg-300 font-semibold mt-2">Priority 2 (Standard Response):</p>
          <p className="ml-4">• Verified burglary alarms • Commercial alarms during business hours</p>
          <p className="text-rmpg-300 font-semibold mt-2">No Response Policy:</p>
          <p className="ml-4">• Unverified alarms at addresses with 5+ false alarms and no valid permit • Expired permits with no response protocol on file</p>
        </div>
      </div>
    </div>
  );
}
