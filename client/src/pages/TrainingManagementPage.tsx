import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { GraduationCap } from 'lucide-react';

export default function TrainingManagementPage() {
  const [courses, setCourses] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ courses: 0, enrollments: 0, active_certs: 0, expiring_certs: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/training/courses').then(r => setCourses(r.data || [])),
      apiFetch<{ courses: number; enrollments: number; active_certs: number; expiring_certs: number }>('/training/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading training records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TRAINING MANAGEMENT" icon={GraduationCap} />
      <div className="grid grid-cols-4 gap-3">
        <StatsCard label="Courses" value={stats.courses} />
        <StatsCard label="Enrollments" value={stats.enrollments} />
        <StatsCard label="Active Certs" value={stats.active_certs} />
        <StatsCard label="Expiring" value={stats.expiring_certs} />
      </div>
      <DataTable
        columns={[
          { key: 'course_name', label: 'Course' },
          { key: 'course_code', label: 'Code' },
          { key: 'category', label: 'Category' },
          { key: 'duration_hours', label: 'Hours' },
          { key: 'instructor_name', label: 'Instructor' },
        ]}
        rows={courses}
        emptyText="No training courses found"
      />
    </div>
  );
}
