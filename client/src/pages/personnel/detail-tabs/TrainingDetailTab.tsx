// ============================================================
// RMPG Flex — Officer Detail: Training Records Tab
// ============================================================

import React, { useMemo } from 'react';
import {
  GraduationCap, Plus, CheckCircle, Clock, BookOpen, AlertTriangle,
  Award, Hash, Calendar, Loader2,
} from 'lucide-react';
import type { TrainingRecord } from '../../../types';
import { TRAINING_CATEGORY_COLORS } from '../utils/personnelConstants';
import FileAttachments from '../../../components/FileAttachments';

interface Props {
  training: TrainingRecord[];
  loading: boolean;
  onAddTraining: (officerId: string) => void;
  officerId: string;
}

export default function TrainingDetailTab({ training, loading, onAddTraining, officerId }: Props) {
  const completed = training.filter((t) => t.status === 'completed').length;
  const inProgress = training.filter((t) => t.status === 'in_progress').length;
  const totalHours = useMemo(() => training.reduce((sum, t) => sum + (t.hours || 0), 0), [training]);

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const borderColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-l-green-500';
      case 'in_progress': return 'border-l-blue-500';
      case 'scheduled': return 'border-l-amber-500';
      case 'overdue':
      case 'expired': return 'border-l-red-500';
      default: return 'border-l-rmpg-600';
    }
  };

  const topBorderColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-t-green-500';
      case 'in_progress': return 'border-t-blue-500';
      case 'scheduled': return 'border-t-amber-500';
      case 'overdue':
      case 'expired': return 'border-t-red-500';
      default: return 'border-t-rmpg-600';
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 70) return 'text-amber-400';
    return 'text-red-400';
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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading training records...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="section-header">
        <GraduationCap className="w-3.5 h-3.5 section-icon" />
        <h3>Training Records</h3>
        <div className="flex-1" />
        <button
          onClick={() => onAddTraining(officerId)}
          className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add Training
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="stat-pod panel-beveled p-2.5 text-center border-t-2 border-t-green-500 summary-card-shimmer" style={{ background: '#0a1a0a', '--pod-glow': 'rgba(34, 197, 94, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold font-mono text-green-400 stat-value">{completed}</p>
          <p className="field-label text-green-400/70">Completed</p>
        </div>
        <div className="stat-pod panel-beveled p-2.5 text-center border-t-2 border-t-blue-500 summary-card-shimmer" style={{ background: '#0a0f1a', '--pod-glow': 'rgba(59, 130, 246, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold font-mono text-blue-400 stat-value">{inProgress}</p>
          <p className="field-label text-blue-400/70">In Progress</p>
        </div>
        <div className="stat-pod panel-beveled p-2.5 text-center bg-surface-base border-t-2 border-t-brand-400 summary-card-shimmer" style={{ '--pod-glow': 'rgba(26, 90, 158, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold font-mono text-brand-400 stat-value">{totalHours}</p>
          <p className="field-label text-brand-400/70">Hours Total</p>
        </div>
      </div>

      {/* Training Cards */}
      {training.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#0d1520' }}>
            <GraduationCap className="w-7 h-7 text-rmpg-600 empty-state-icon" />
          </div>
          <p className="text-xs text-rmpg-500">No training records for this officer.</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click &quot;Add Training&quot; to create the first record.</p>
        </div>
      ) : (
        <div className="personnel-table">
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th className="text-left">Course</th>
                <th className="text-left">Category</th>
                <th className="text-left">Provider</th>
                <th className="text-left">Date</th>
                <th className="text-right">Hours</th>
                <th className="text-right">Score</th>
                <th className="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {training.map((record) => (
                <tr key={record.id} className={record.status === 'overdue' || record.status === 'expired' ? 'row-alert' : ''}>
                  <td>
                    <span className="text-xs font-semibold text-rmpg-100">{record.course_name}</span>
                    {record.certificate_number && (
                      <span className="block text-[9px] font-mono text-rmpg-500">#{record.certificate_number}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge-pill inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      TRAINING_CATEGORY_COLORS[record.category] || TRAINING_CATEGORY_COLORS.other
                    }`}>
                      {record.category.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <span className="text-[11px] text-rmpg-300">{record.provider || '-'}</span>
                  </td>
                  <td>
                    <span className="text-[11px] text-rmpg-200 font-mono">{formatDate(record.completed_date)}</span>
                    {record.expiry_date && (
                      <span className="block text-[9px] text-rmpg-500 font-mono">exp: {formatDate(record.expiry_date)}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="text-[11px] text-rmpg-200 font-mono">{record.hours}</span>
                  </td>
                  <td className="text-right">
                    {record.score != null ? (
                      <span className={`text-[11px] font-mono font-bold ${scoreColor(record.score)}`}>{record.score}%</span>
                    ) : (
                      <span className="text-[11px] text-rmpg-600">-</span>
                    )}
                  </td>
                  <td>
                    {statusBadge(record.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
