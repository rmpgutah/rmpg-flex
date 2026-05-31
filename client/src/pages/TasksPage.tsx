import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { CheckSquare, Clock, CheckCircle, Users, AlertTriangle, RefreshCw } from 'lucide-react';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalTasks: 0, overdue: 0, completed: 0 });

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/tasks').then(r => setTasks(r.data || [])),
      apiFetch<{ totalTasks: number; overdue: number; completed: number }>('/tasks/stats').then(r => setStats(r)),
    ]).catch(() => setError('Failed to load tasks.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="flex flex-col items-center justify-center py-20 px-4 text-center"><AlertTriangle size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} /><p className="text-[10px] text-[#fca5a5] mb-3">{error}</p><button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button></div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TASK MANAGEMENT" icon={CheckSquare} />
      {loading ? <div className="space-y-3"><div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div><div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" /></div> : <>
        <div className="grid grid-cols-3 gap-3"><StatsCard icon={Clock} label="Total Tasks" value={stats.totalTasks} /><StatsCard icon={AlertTriangle} label="Overdue" value={stats.overdue} /><StatsCard icon={CheckCircle} label="Completed" value={stats.completed} /></div>
        <DataTable columns={[{ key: 'title', label: 'Task' },{ key: 'assignee', label: 'Assignee' },{ key: 'priority', label: 'Priority' },{ key: 'status', label: 'Status' },{ key: 'due_date', label: 'Due' }]} data={tasks} emptyMessage="No tasks" />
      </>}
    </div>
  );
}
