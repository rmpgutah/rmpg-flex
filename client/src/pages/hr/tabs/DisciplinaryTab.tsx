// ============================================================
// RMPG Flex — Disciplinary Records Tab
// Manager view: filter, list/timeline views, create/edit/delete
// Officer view: read-only list of own records
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Star, Plus, Pencil, Trash2, List, Clock, Loader2,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Scale,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import type { DisciplinaryRecord, DisciplinaryType, DisciplinarySeverity, DisciplinaryStatus } from '../../../types';
import { SEVERITY_COLORS, DISCIPLINARY_TYPE_LABELS } from '../utils/hrConstants';
import DisciplinaryFormModal from '../modals/DisciplinaryFormModal';
import ExportButton from '../../../components/ExportButton';

interface DisciplinaryTabProps {
  userRole: string;
  userId: number;
}

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

function isManagerPlus(role: string) {
  return MANAGER_ROLES.includes(role);
}

// ─── Type badge colors ──────────────────────────────────────
function typeBadgeStyle(type: DisciplinaryType) {
  switch (type) {
    case 'commendation':
      return 'bg-amber-900/30 text-amber-400 border-amber-600/30';
    case 'verbal_warning':
      return 'bg-yellow-900/20 text-yellow-400 border-yellow-600/30';
    case 'written_warning':
      return 'bg-orange-900/20 text-orange-400 border-orange-600/30';
    case 'suspension':
      return 'bg-red-900/20 text-red-400 border-red-600/30';
    case 'termination':
      return 'bg-red-900/30 text-red-300 border-red-500/40';
    case 'counseling':
      return 'bg-blue-900/20 text-blue-400 border-blue-600/30';
    default:
      return 'bg-rmpg-800/50 text-rmpg-300 border-rmpg-600/30';
  }
}

function statusBadge(status: DisciplinaryStatus) {
  switch (status) {
    case 'open':
      return { bg: 'bg-amber-900/20 text-amber-400 border-amber-600/30', label: 'Open' };
    case 'closed':
      return { bg: 'bg-green-900/20 text-green-400 border-green-600/30', label: 'Closed' };
    case 'appealed':
      return { bg: 'bg-blue-900/20 text-blue-400 border-blue-600/30', label: 'Appealed' };
    default:
      return { bg: 'bg-rmpg-800 text-rmpg-400', label: status };
  }
}

function followUpStatus(date: string | null): 'none' | 'upcoming' | 'overdue' | 'past' {
  if (!date) return 'none';
  const d = new Date(date);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return 'overdue';
  if (days < 7) return 'upcoming';
  return 'past';
}

// ─── Main component ─────────────────────────────────────────
export default function DisciplinaryTab({ userRole, userId }: DisciplinaryTabProps) {
  const toast = useToast();
  const manager = isManagerPlus(userRole);

  // Data
  const [records, setRecords] = useState<DisciplinaryRecord[]>([]);
  const [officers, setOfficers] = useState<Array<{ id: number; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [timelineRecords, setTimelineRecords] = useState<DisciplinaryRecord[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Filters
  const [filterOfficer, setFilterOfficer] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // View
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [selectedOfficerId, setSelectedOfficerId] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<DisciplinaryRecord | null>(null);

  // Expanded descriptions
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // ─── Fetch records ──────────────────────────────────────
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterOfficer) params.set('officer_id', filterOfficer);
      if (filterType) params.set('type', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterStatus) params.set('status', filterStatus);
      const qs = params.toString();
      const data = await apiFetch<DisciplinaryRecord[]>(`/hr/disciplinary${qs ? `?${qs}` : ''}`);
      setRecords(data);
    } catch {
      toast.addToast('Failed to load disciplinary records', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterOfficer, filterType, filterSeverity, filterStatus, toast]);

  // ─── Fetch officers ──────────────────────────────────────
  useEffect(() => {
    if (!manager) return;
    apiFetch<Array<{ id: number; full_name: string }>>('/personnel')
      .then(data => {
        // personnel endpoint may return more fields; just keep id & full_name
        setOfficers(data.map((o: any) => ({ id: o.id, full_name: o.full_name })));
      })
      .catch(() => {});
  }, [manager]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // ─── Fetch timeline ──────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'timeline' || !selectedOfficerId) {
      setTimelineRecords([]);
      return;
    }
    setTimelineLoading(true);
    apiFetch<DisciplinaryRecord[]>(`/hr/disciplinary/${selectedOfficerId}/timeline`)
      .then(setTimelineRecords)
      .catch(() => toast.addToast('Failed to load timeline', 'error'))
      .finally(() => setTimelineLoading(false));
  }, [viewMode, selectedOfficerId, toast]);

  // ─── Handlers ────────────────────────────────────────────
  const handleCreate = () => {
    setEditRecord(null);
    setModalOpen(true);
  };

  const handleEdit = (rec: DisciplinaryRecord) => {
    setEditRecord(rec);
    setModalOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this disciplinary record? This cannot be undone.')) return;
    try {
      await apiFetch(`/hr/disciplinary/${id}`, { method: 'DELETE' });
      toast.addToast('Record deleted', 'success');
      fetchRecords();
    } catch {
      toast.addToast('Failed to delete record', 'error');
    }
  };

  const handleSubmit = async (data: any) => {
    if (editRecord) {
      await apiFetch(`/hr/disciplinary/${editRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      toast.addToast('Record updated', 'success');
    } else {
      await apiFetch('/hr/disciplinary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      toast.addToast('Record created', 'success');
    }
    fetchRecords();
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Officer read-only view ──────────────────────────────
  if (!manager) {
    const commendations = records.filter(r => r.type === 'commendation');
    const others = records.filter(r => r.type !== 'commendation');

    return (
      <div className="p-4 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield size={14} className="text-brand-400" />
          My Disciplinary Records
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-rmpg-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-rmpg-500 text-sm">No records found.</div>
        ) : (
          <>
            {/* Commendations at top */}
            {commendations.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                  <Star size={12} /> Commendations
                </h3>
                {commendations.map(rec => (
                  <RecordCard
                    key={rec.id}
                    rec={rec}
                    expanded={expandedIds.has(rec.id)}
                    onToggle={() => toggleExpand(rec.id)}
                    manager={false}
                    isAdmin={false}
                  />
                ))}
              </div>
            )}

            {/* Other records */}
            {others.length > 0 && (
              <div className="space-y-2">
                {commendations.length > 0 && (
                  <h3 className="text-xs font-medium text-rmpg-400 mt-4">Records</h3>
                )}
                {others.map(rec => (
                  <RecordCard
                    key={rec.id}
                    rec={rec}
                    expanded={expandedIds.has(rec.id)}
                    onToggle={() => toggleExpand(rec.id)}
                    manager={false}
                    isAdmin={false}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── Manager / Admin view ────────────────────────────────
  return (
    <div className="p-4 space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Shield size={14} className="text-brand-400" />
          Disciplinary Records
        </h2>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border border-[#1e3048] rounded-sm overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`px-2 py-1 text-xs flex items-center gap-1 ${
                viewMode === 'list'
                  ? 'bg-brand-600 text-white'
                  : 'bg-[#0d1520] text-rmpg-400 hover:text-white'
              }`}
            >
              <List size={12} /> List
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-2 py-1 text-xs flex items-center gap-1 ${
                viewMode === 'timeline'
                  ? 'bg-brand-600 text-white'
                  : 'bg-[#0d1520] text-rmpg-400 hover:text-white'
              }`}
            >
              <Clock size={12} /> Timeline
            </button>
          </div>
          <ExportButton exportUrl="/api/hr/disciplinary/export/csv" exportFilename="disciplinary.csv" />
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white rounded-sm flex items-center gap-1.5"
          >
            <Plus size={12} /> Add Record
          </button>
        </div>
      </div>

      {/* Filter bar (list view only) */}
      {viewMode === 'list' && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterOfficer}
            onChange={e => setFilterOfficer(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="">All Officers</option>
            {officers.map(o => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="">All Types</option>
            {Object.entries(DISCIPLINARY_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="">All Severities</option>
            <option value="minor">Minor</option>
            <option value="moderate">Moderate</option>
            <option value="major">Major</option>
            <option value="critical">Critical</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1 text-xs text-white"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="appealed">Appealed</option>
          </select>
        </div>
      )}

      {/* List view */}
      {viewMode === 'list' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-rmpg-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-rmpg-500 text-sm">
              No records match the current filters.
            </div>
          ) : (
            <div className="space-y-2">
              {records.map(rec => (
                <RecordCard
                  key={rec.id}
                  rec={rec}
                  expanded={expandedIds.has(rec.id)}
                  onToggle={() => toggleExpand(rec.id)}
                  manager
                  isAdmin={userRole === 'admin'}
                  onEdit={() => handleEdit(rec)}
                  onDelete={() => handleDelete(rec.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Timeline view */}
      {viewMode === 'timeline' && (
        <div className="space-y-4">
          <select
            value={selectedOfficerId}
            onChange={e => setSelectedOfficerId(e.target.value)}
            className="bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-sm text-white w-full sm:w-64"
          >
            <option value="">Select officer...</option>
            {officers.map(o => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </select>

          {!selectedOfficerId ? (
            <div className="text-center py-12 text-rmpg-500 text-sm">
              Select an officer to view their timeline.
            </div>
          ) : timelineLoading ? (
            <div className="flex items-center justify-center py-12 text-rmpg-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : timelineRecords.length === 0 ? (
            <div className="text-center py-12 text-rmpg-500 text-sm">
              No records for this officer.
            </div>
          ) : (
            <TimelineView records={timelineRecords} />
          )}
        </div>
      )}

      {/* Modal */}
      <DisciplinaryFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editRecord={editRecord}
        officers={officers}
      />
    </div>
  );
}

// ─── Record Card ────────────────────────────────────────────
function RecordCard({
  rec,
  expanded,
  onToggle,
  manager,
  isAdmin,
  onEdit,
  onDelete,
}: {
  rec: DisciplinaryRecord;
  expanded: boolean;
  onToggle: () => void;
  manager: boolean;
  isAdmin: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isComm = rec.type === 'commendation';
  const borderColor = isComm ? '#d4a017' : (SEVERITY_COLORS[rec.severity] ?? '#3b82f6');
  const sBadge = statusBadge(rec.status);
  const fuStatus = followUpStatus(rec.follow_up_date);

  return (
    <div
      className={`rounded border border-[#1e3048] border-l-4 ${
        isComm ? 'bg-amber-950/10' : 'bg-[#0d1520]'
      }`}
      style={{ borderLeftColor: borderColor }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Icon */}
        <div className="mt-0.5">
          {isComm ? (
            <Star size={16} className="text-amber-400" />
          ) : (
            <Shield size={16} style={{ color: borderColor }} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Top row: type badge + officer + date */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${typeBadgeStyle(rec.type)}`}
            >
              {DISCIPLINARY_TYPE_LABELS[rec.type] ?? rec.type}
            </span>
            {rec.officer_name && (
              <span className="text-xs text-rmpg-300">{rec.officer_name}</span>
            )}
            <span className="text-[10px] text-rmpg-500">
              {new Date(rec.incident_date).toLocaleDateString()}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-sm border ${sBadge.bg}`}
            >
              {sBadge.label}
            </span>
          </div>

          {/* Description */}
          <p className="text-xs text-rmpg-300">
            {expanded || rec.description.length <= 120
              ? rec.description
              : `${rec.description.slice(0, 120)}...`}
          </p>
          {rec.description.length > 120 && (
            <button
              onClick={onToggle}
              className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}

          {/* Follow-up */}
          {rec.follow_up_date && (
            <div
              className={`text-[10px] flex items-center gap-1 ${
                fuStatus === 'overdue'
                  ? 'text-red-400'
                  : fuStatus === 'upcoming'
                    ? 'text-amber-400'
                    : 'text-rmpg-500'
              }`}
            >
              <AlertTriangle size={10} />
              Follow-up: {new Date(rec.follow_up_date).toLocaleDateString()}
              {fuStatus === 'overdue' && ' (overdue)'}
              {fuStatus === 'upcoming' && ' (upcoming)'}
            </div>
          )}

          {/* Issuer (manager only) */}
          {manager && rec.issuer_name && (
            <div className="text-[10px] text-rmpg-500">Issued by: {rec.issuer_name}</div>
          )}
        </div>

        {/* Actions */}
        {manager && (
          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <button
                onClick={onEdit}
                className="p-1 text-rmpg-400 hover:text-white rounded-sm hover:bg-[#1a2636]"
                title="Edit"
              >
                <Pencil size={13} />
              </button>
            )}
            {isAdmin && onDelete && (
              <button
                onClick={onDelete}
                className="p-1 text-rmpg-400 hover:text-red-400 rounded-sm hover:bg-[#1a2636]"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Timeline View ──────────────────────────────────────────
function TimelineView({ records }: { records: DisciplinaryRecord[] }) {
  return (
    <div className="relative pl-6 space-y-4">
      {/* Vertical line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-[#1e3048]" />

      {records.map(rec => {
        const isComm = rec.type === 'commendation';
        const color = isComm ? '#d4a017' : (SEVERITY_COLORS[rec.severity] ?? '#3b82f6');

        return (
          <div key={rec.id} className="relative flex gap-3">
            {/* Node dot */}
            <div
              className="absolute -left-6 top-1 w-[10px] h-[10px] rounded-full border-2 bg-[#141e2b]"
              style={{ borderColor: color }}
            />

            {/* Content */}
            <div className="flex-1 rounded-sm border border-[#1e3048] bg-[#0d1520] p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                {isComm ? (
                  <Star size={12} className="text-amber-400" />
                ) : (
                  <Shield size={12} style={{ color }} />
                )}
                <span className="font-medium text-white">
                  {DISCIPLINARY_TYPE_LABELS[rec.type] ?? rec.type}
                </span>
                <span className="text-rmpg-500">
                  {new Date(rec.incident_date).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-rmpg-300">
                {rec.description.length > 200
                  ? `${rec.description.slice(0, 200)}...`
                  : rec.description}
              </p>
              {rec.action_taken && (
                <p className="text-[10px] text-rmpg-500">
                  Action: {rec.action_taken}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
