// ============================================================
// RMPG Flex — Personnel: Training & Qualifications Tab
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  GraduationCap, Plus, CheckCircle, AlertTriangle, Clock, BookOpen,
  Loader2,
} from 'lucide-react';
import type { TrainingRecord, TrainingRequirement, TrainingCategory } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { TRAINING_CATEGORY_COLORS } from '../utils/personnelConstants';

const CATEGORIES: TrainingCategory[] = [
  'firearms', 'defensive_tactics', 'first_aid', 'legal',
  'communication', 'driving', 'technology', 'leadership', 'compliance', 'other',
];

interface Props {
  training: TrainingRecord[];
  requirements: TrainingRequirement[];
  officers: OfficerWithStatus[];
  loading: boolean;
  onAddTraining: () => void;
}

export default function TrainingTab({ training, requirements, officers, loading, onAddTraining }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<'all' | TrainingCategory>('all');

  const filtered = useMemo(() => {
    if (categoryFilter === 'all') return training;
    return training.filter((t) => t.category === categoryFilter);
  }, [training, categoryFilter]);

  const completed = training.filter((t) => t.status === 'completed').length;
  const inProgress = training.filter((t) => t.status === 'in_progress').length;
  const scheduled = training.filter((t) => t.status === 'scheduled').length;
  const overdue = training.filter((t) => t.status === 'overdue' || t.status === 'expired').length;

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="badge-pill inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50">
            <CheckCircle className="w-2.5 h-2.5" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="badge-pill inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-900/50 text-blue-400 border border-blue-700/50">
            <Clock className="w-2.5 h-2.5" />
            In Progress
          </span>
        );
      case 'scheduled':
        return (
          <span className="badge-pill inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-900/50 text-amber-400 border border-amber-700/50">
            <BookOpen className="w-2.5 h-2.5" />
            Scheduled
          </span>
        );
      case 'overdue':
      case 'expired':
        return (
          <span className="badge-pill inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-900/50 text-red-400 border border-red-700/50">
            <AlertTriangle className="w-2.5 h-2.5" />
            {status === 'overdue' ? 'Overdue' : 'Expired'}
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading training records...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
        <div className="flex items-center">
          <GraduationCap className="section-icon w-4 h-4" />
          <h3 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider ml-2">Training Records</h3>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div
          className="stat-pod summary-card-shimmer cascade-item panel-beveled p-3 text-center bg-surface-base border-t-2 border-t-rmpg-500"
          style={{ '--pod-glow': 'rgba(255,255,255,0.06)' } as React.CSSProperties}
        >
          <BookOpen className="stat-icon w-4 h-4 text-rmpg-400 mx-auto mb-1.5" />
          <p className="stat-value text-lg font-bold font-mono text-rmpg-100">{training.length}</p>
          <p className="text-[8px] uppercase text-rmpg-400 font-bold tracking-wider mt-0.5">Total Records</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item panel-beveled p-3 text-center bg-[#0a1a0a] border-t-2 border-t-green-500"
          style={{ '--pod-glow': 'rgba(34,197,94,0.12)' } as React.CSSProperties}
        >
          <CheckCircle className="stat-icon w-4 h-4 text-green-400 mx-auto mb-1.5" />
          <p className="stat-value text-lg font-bold font-mono text-green-400">{completed}</p>
          <p className="text-[8px] uppercase text-green-400/70 font-bold tracking-wider mt-0.5">Completed</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item panel-beveled p-3 text-center bg-[#0a0f1a] border-t-2 border-t-blue-500"
          style={{ '--pod-glow': 'rgba(59,130,246,0.12)' } as React.CSSProperties}
        >
          <Clock className="stat-icon w-4 h-4 text-blue-400 mx-auto mb-1.5" />
          <p className="stat-value text-lg font-bold font-mono text-blue-400">{inProgress}</p>
          <p className="text-[8px] uppercase text-blue-400/70 font-bold tracking-wider mt-0.5">In Progress</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item panel-beveled p-3 text-center bg-[#1a170a] border-t-2 border-t-amber-500"
          style={{ '--pod-glow': 'rgba(245,158,11,0.12)' } as React.CSSProperties}
        >
          <BookOpen className="stat-icon w-4 h-4 text-amber-400 mx-auto mb-1.5" />
          <p className="stat-value text-lg font-bold font-mono text-amber-400">{scheduled}</p>
          <p className="text-[8px] uppercase text-amber-400/70 font-bold tracking-wider mt-0.5">Scheduled</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item panel-beveled p-3 text-center bg-[#1a0a0a] border-t-2 border-t-red-500"
          style={{ '--pod-glow': 'rgba(239,68,68,0.12)' } as React.CSSProperties}
        >
          <AlertTriangle className="stat-icon w-4 h-4 text-red-400 mx-auto mb-1.5" />
          <p className="stat-value text-lg font-bold font-mono text-red-400">{overdue}</p>
          <p className="text-[8px] uppercase text-red-400/70 font-bold tracking-wider mt-0.5">Overdue</p>
        </div>
      </div>

      {/* Overdue Alert */}
      {overdue > 0 && (
        <div className="alert-banner alert-banner-critical panel-beveled p-3 flex items-center gap-3" style={{ '--alert-color': '#ef4444' } as React.CSSProperties}>
          <span className="led-dot led-red flex-shrink-0" />
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-400 font-semibold">
            {overdue} training record{overdue !== 1 ? 's' : ''} overdue or expired
          </span>
        </div>
      )}

      {/* Category Filter Bar */}
      <div className="flex items-center gap-2">
        <div className="panel-inset p-2 flex items-center gap-1.5 flex-wrap flex-1">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`text-[10px] px-2.5 py-1 ${
              categoryFilter === 'all' ? 'toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`text-[10px] px-2.5 py-1 capitalize ${
                categoryFilter === cat ? 'toolbar-btn-primary' : 'toolbar-btn'
              }`}
            >
              {cat.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <button onClick={onAddTraining} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5 shrink-0">
          <Plus className="w-3 h-3" />
          Add Training
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="empty-state-icon w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
            <GraduationCap className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-400 font-medium">No training records found</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Add training records or adjust the category filter above.</p>
        </div>
      ) : (
        <div className="panel-beveled overflow-x-auto">
          <table className="personnel-table table-dark w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left py-1.5 px-2">Officer</th>
                <th className="text-left py-1.5 px-2">Course</th>
                <th className="text-left py-1.5 px-2">Category</th>
                <th className="text-left py-1.5 px-2">Provider</th>
                <th className="text-left py-1.5 px-2">Completed</th>
                <th className="text-left py-1.5 px-2">Expiry</th>
                <th className="text-right py-1.5 px-2">Hours</th>
                <th className="text-left py-1.5 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record) => (
                <tr
                  key={record.id}
                  className={`border-t border-rmpg-800 transition-colors ${
                    record.status === 'overdue' || record.status === 'expired' ? 'row-alert' : ''
                  }`}
                >
                  <td className="py-1.5 px-2 text-rmpg-100">{record.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-medium">{record.course_name}</td>
                  <td className="py-1.5 px-2">
                    <span className={`badge-pill inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      TRAINING_CATEGORY_COLORS[record.category] || TRAINING_CATEGORY_COLORS.other
                    }`}>
                      {record.category.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-rmpg-400">{record.provider || '-'}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(record.completed_date)}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(record.expiry_date)}</td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{record.hours}</td>
                  <td className="py-1.5 px-2">{statusBadge(record.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
