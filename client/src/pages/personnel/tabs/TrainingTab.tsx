// ============================================================
// RMPG Flex — Personnel: Training & Qualifications Tab
// ============================================================

import React, {useState, useMemo, useEffect} from 'react';
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
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-green-900/50 text-green-400 border border-green-700/50">
            <CheckCircle className="w-2.5 h-2.5" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-blue-900/50 text-blue-400 border border-blue-700/50">
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
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        <span className="ml-2 text-xs text-rmpg-400">Loading training records...</span>
      </div>
    );
  }

  // Set document title
  useEffect(() => { document.title = 'Personnel - Training \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" role="group" aria-label="Training summary">
        <div className="panel-beveled p-2.5 text-center bg-surface-base border-t-2 border-t-rmpg-500 transition-colors duration-200 hover:brightness-110">
          <p className="text-lg font-bold font-mono text-rmpg-100">{training.length}</p>
          <p className="text-[8px] uppercase text-rmpg-400 font-bold tracking-wider">Total Records</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#0a1a0a] border-t-2 border-t-green-500 transition-colors duration-200 hover:brightness-110">
          <p className="text-lg font-bold font-mono text-green-400">{completed}</p>
          <p className="text-[8px] uppercase text-green-400/70 font-bold tracking-wider">Completed</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#0a0f1a] border-t-2 border-t-blue-500 transition-colors duration-200 hover:brightness-110">
          <p className="text-lg font-bold font-mono text-blue-400">{inProgress}</p>
          <p className="text-[8px] uppercase text-blue-400/70 font-bold tracking-wider">In Progress</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#1a170a] border-t-2 border-t-amber-500 transition-colors duration-200 hover:brightness-110">
          <p className="text-lg font-bold font-mono text-amber-400">{scheduled}</p>
          <p className="text-[8px] uppercase text-amber-400/70 font-bold tracking-wider">Scheduled</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#1a0a0a] border-t-2 border-t-red-500 transition-colors duration-200 hover:brightness-110">
          <p className="text-lg font-bold font-mono text-red-400">{overdue}</p>
          <p className="text-[8px] uppercase text-red-400/70 font-bold tracking-wider">Overdue</p>
        </div>
      </div>

      {/* Header & Filters */}
      <div className="flex items-center justify-between">
        <div className="panel-inset p-2 flex items-center gap-1.5 flex-wrap">
          <button type="button"
            onClick={() => setCategoryFilter('all')}
            className={`text-[10px] px-2.5 py-1 ${
              categoryFilter === 'all' ? 'toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button type="button"
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
        <button type="button" onClick={onAddTraining} className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
          <Plus className="w-3 h-3" />
          Add Training
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16" role="status">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <GraduationCap className="w-8 h-8 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No training records found</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Add training records or adjust the category filter</p>
        </div>
      ) : (
        <div className="panel-beveled overflow-x-auto">
          <table className="table-dark w-full text-[11px]">
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
                <tr key={record.id} className="border-t border-rmpg-800 hover:bg-rmpg-800/30 transition-colors">
                  <td className="py-1.5 px-2 text-rmpg-100">{record.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-medium">{record.course_name}</td>
                  <td className="py-1.5 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
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
  );
}
