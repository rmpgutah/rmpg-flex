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
      case 'in_progress': return 'border-l-gray-500';
      case 'scheduled': return 'border-l-amber-500';
      case 'overdue':
      case 'expired': return 'border-l-red-500';
      default: return 'border-l-rmpg-600';
    }
  };

  const topBorderColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-t-green-500';
      case 'in_progress': return 'border-t-gray-500';
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
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50">
            <CheckCircle className="w-2.5 h-2.5" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-gray-900/50 text-gray-400 border border-gray-700/50">
            <Clock className="w-2.5 h-2.5" />
            In Progress
          </span>
        );
      case 'scheduled':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-900/50 text-amber-400 border border-amber-700/50">
            <BookOpen className="w-2.5 h-2.5" />
            Scheduled
          </span>
        );
      case 'overdue':
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-red-900/50 text-red-400 border border-red-700/50">
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
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        <span className="ml-2 text-xs text-rmpg-400">Loading training records...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rmpg-100 flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5 text-brand-400" />
          Training Records
        </h3>
        <button type="button"
          onClick={() => onAddTraining(officerId)}
          className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add Training
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-green-500" style={{ background: '#0a1a0a' }}>
          <p className="text-lg font-bold font-mono text-green-400">{completed}</p>
          <p className="field-label text-green-400/70">Completed</p>
        </div>
        <div className="panel-beveled p-2.5 text-center border-t-2 border-t-gray-500" style={{ background: '#0a0a0a' }}>
          <p className="text-lg font-bold font-mono text-gray-400">{inProgress}</p>
          <p className="field-label text-gray-400/70">In Progress</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-surface-base border-t-2 border-t-brand-400">
          <p className="text-lg font-bold font-mono text-brand-400">{totalHours}</p>
          <p className="field-label text-brand-400/70">Hours Total</p>
        </div>
      </div>

      {/* Training Cards */}
      {training.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#050505' }}>
            <GraduationCap className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-500">No training records for this officer.</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click &quot;Add Training&quot; to create the first record.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {training.map((record) => (
            <div
              key={record.id}
              className={`panel-beveled p-3 border-l-2 border-t-2 bg-surface-base ${borderColor(record.status)} ${topBorderColor(record.status)}`}
            >
              {/* Title Row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-rmpg-100 truncate">{record.course_name}</span>
                  <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase flex-shrink-0 ${
                    TRAINING_CATEGORY_COLORS[record.category] || TRAINING_CATEGORY_COLORS.other
                  }`}>
                    {record.category.replace(/_/g, ' ')}
                  </span>
                </div>
                {statusBadge(record.status)}
              </div>

              {/* Detail Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1">
                <div>
                  <p className="field-label">Provider</p>
                  <p className="text-[11px] text-rmpg-200">{record.provider || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Date Completed</p>
                  <p className="text-[11px] text-rmpg-200 font-mono">{formatDate(record.completed_date)}</p>
                </div>
                <div>
                  <p className="field-label">Hours</p>
                  <p className="text-[11px] text-rmpg-200 font-mono">{record.hours}</p>
                </div>
                {record.score != null && (
                  <div>
                    <p className="field-label">Score</p>
                    <p className={`text-[11px] font-mono font-bold ${scoreColor(record.score)}`}>{record.score}%</p>
                  </div>
                )}
                {record.certificate_number && (
                  <div>
                    <p className="field-label">Certificate #</p>
                    <p className="text-[11px] text-rmpg-200 font-mono">{record.certificate_number}</p>
                  </div>
                )}
                {record.expiry_date && (
                  <div>
                    <p className="field-label">Expiry</p>
                    <p className="text-[11px] text-rmpg-200 font-mono">{formatDate(record.expiry_date)}</p>
                  </div>
                )}
              </div>

              {/* Attachments (certificates, completion docs, etc.) */}
              <div className="mt-2 pt-2 border-t border-rmpg-800">
                <FileAttachments entityType="training" entityId={record.id} compact />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
