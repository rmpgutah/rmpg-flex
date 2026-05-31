import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { ClipboardList } from 'lucide-react';

interface Task {
  id: number; task_title: string; priority: string; status: string;
  assigned_to_name: string; due_date: string; created_at: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, pending: 0, overdue: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Task[] }>('/tasks').then(r => setTasks(r.data || [])),
      apiFetch<{ total: number; pending: number; overdue: number }>('/tasks/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading tasks...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TASK MANAGEMENT" icon={ClipboardList} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard label="Total Tasks" value={stats.total} />
        <StatsCard label="Pending" value={stats.pending} />
        <StatsCard label="Overdue" value={stats.overdue} />
      </div>
      <DataTable
        columns={[
          { key: 'task_title', label: 'Task' },
          { key: 'priority', label: 'Priority' },
          { key: 'status', label: 'Status' },
          { key: 'assigned_to_name', label: 'Assigned To' },
          { key: 'due_date', label: 'Due Date' },
        ]}
        rows={tasks}
        emptyText="No tasks found"
      />
    </div>
  );
}
