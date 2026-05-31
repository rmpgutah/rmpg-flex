import React, { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import StatsCard from '../components/StatsCard';
import { UserPlus, Users, CheckCircle, GraduationCap, Clock } from 'lucide-react';

interface RecruitStats { applicants: number; inProcess: number; hired: number; academyClasses: number; }

export default function RecruitmentPage() {
  const [stats, setStats] = useState<RecruitStats>({ applicants: 0, inProcess: 0, hired: 0, academyClasses: 0 });

  useEffect(() => {
    apiFetch<RecruitStats>('/recruitment/stats').catch(() => null).then(d => d && setStats(d));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RECRUITMENT" icon={UserPlus} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL APPLICANTS" value={String(stats.applicants)} icon={Users} />
        <StatsCard label="IN PROCESS" value={String(stats.inProcess)} icon={Clock} />
        <StatsCard label="HIRED (YTD)" value={String(stats.hired)} icon={CheckCircle} />
        <StatsCard label="ACADEMY CLASSES" value={String(stats.academyClasses)} icon={GraduationCap} />
      </div>
      <div className="panel-beveled p-4">
        <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Hiring Process Overview</h3>
        <div className="text-[10px] text-rmpg-400 space-y-1">
          <p><span className="text-rmpg-300 font-semibold">1. Application</span> — Online application & initial screening</p>
          <p><span className="text-rmpg-300 font-semibold">2. Testing</span> — Written exam & physical agility test</p>
          <p><span className="text-rmpg-300 font-semibold">3. Oral Board</span> — Panel interview with command staff</p>
          <p><span className="text-rmpg-300 font-semibold">4. Background</span> — Comprehensive background investigation</p>
          <p><span className="text-rmpg-300 font-semibold">5. Conditional Offer</span> — Medical, psychological, polygraph</p>
          <p><span className="text-rmpg-300 font-semibold">6. Academy</span> — POST-certified basic academy</p>
          <p><span className="text-rmpg-300 font-semibold">7. FTO Program</span> — Field training with certified FTO</p>
        </div>
      </div>
    </div>
  );
}
