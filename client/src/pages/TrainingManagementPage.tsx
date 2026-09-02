import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { GraduationCap, BookOpen, Award, Clock, Plus, Pencil, Trash2, Eye, X, FileText, Download, Search } from 'lucide-react';
import { toDisplayLabel } from '../utils/formatters';
import { downloadTextFile, trainingCoursesToCsv } from '../utils/rmsListExport';

export default function TrainingManagementPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Role gate: admin / manager / human_resources only
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'human_resources';
  const canWrite = user?.role === 'admin' || user?.role === 'manager';

  const [courses, setCourses] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ courses: 0, enrollments: 0, active_certs: 0, expiring_certs: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<Record<string, any> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courseQuery, setCourseQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mandatoryOnly, setMandatoryOnly] = useState(false);
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [r, s] = await Promise.all([
        apiFetch<{ data: Record<string, any>[] }>('/training/courses'),
        apiFetch<{ courses: number; enrollments: number; active_certs: number; expiring_certs: number }>('/training/stats'),
      ]);
      setCourses(r.data || []);
      setStats(s);
    } catch { setError('Failed to load data'); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  // Deep-link: ?course_id= — open edit form for that course once loaded
  useEffect(() => {
    const courseId = searchParams.get('course_id');
    if (!courseId || courses.length === 0) return;
    const found = courses.find((c) => String(c.id) === courseId);
    if (found) openEdit(found);
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, searchParams]);

  const BLANK_FORM = { course_name: '', course_code: '', category: 'other', duration_hours: '', instructor_id: '', location: '', is_mandatory: 0 };

  const openNew = () => {
    setEditingRecord(null);
    setFormData(BLANK_FORM);
    setShowForm(true);
  };
  const openEdit = (rec: Record<string, any>) => {
    setEditingRecord(rec);
    setFormData({ ...rec });
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditingRecord(null);
  };

  const handleSave = async () => {
    if (!formData.course_name?.trim()) {
      addToast('Course name is required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/training/courses/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/training/courses', { method: 'POST', body: JSON.stringify(formData) });
      }
      closeForm();
      fetchData();
      addToast(editingRecord ? 'Course updated' : 'Course created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed to save', 'error'); }
    finally { setSubmitting(false); }
  };

  const confirmDelete = async () => {
    if (!courseToDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/training/courses/${courseToDelete.id}`, { method: 'DELETE' });
      setCourseToDelete(null);
      fetchData();
      addToast('Course deleted', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
    finally { setDeleting(false); }
  };

  // Keyboard shortcuts: Esc cascade + N (new course)
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (courseToDelete) { setCourseToDelete(null); return; }
        if (showForm) { closeForm(); return; }
        return;
      }
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canWrite) { openNew(); }
      if (e.key === '/') { e.preventDefault(); document.getElementById('training-course-search')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [courseToDelete, showForm, canWrite]);

  const visibleCourses = courses.filter((c) => {
    if (categoryFilter && String(c.category) !== categoryFilter) return false;
    if (mandatoryOnly && !c.is_mandatory) return false;
    const q = courseQuery.trim().toLowerCase();
    if (!q) return true;
    return [c.course_name, c.course_code, c.location].some((v) => String(v ?? '').toLowerCase().includes(q));
  });

  const columns = [
    { key: 'course_name', label: 'Course' },
    { key: 'course_code', label: 'Code' },
    { key: 'category', label: 'Category' },
    { key: 'duration_hours', label: 'Hours' },
    { key: 'instructor_name', label: 'Instructor' },
    {
      key: 'actions', label: '', width: '100px',
      render: (row: any) => (
        <div className="flex gap-2">
          {canWrite && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label={`Edit course ${row.course_name}`}><Pencil size={12} /></button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setCourseToDelete(row); }} className="text-red-500 hover:text-red-300" aria-label={`Delete course ${row.course_name}`}><Trash2 size={12} /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  // Role gate: officers and dispatchers cannot access this page
  if (!isAdmin) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-rmpg-400">Training management is restricted to administrators, managers, and human resources.</p>
      </div>
    );
  }

  if (loading) return <div className="p-6 text-rmpg-400">Loading training records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TRAINING MANAGEMENT" icon={GraduationCap}>
        <button type="button"
          onClick={() => navigate('/training-docs')}
          className="toolbar-btn flex items-center gap-1.5"
          style={{ height: 28, padding: '0 10px' }}
          title="Open training documents library"
        >
          <FileText size={13} /> Docs Library
        </button>
        {canWrite && (
          <button type="button"
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
          >
            <Plus size={13} /> New Course
          </button>
        )}
      </PanelTitleBar>

      {error && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatsCard icon={BookOpen} label="Courses" value={stats.courses} />
        <StatsCard icon={GraduationCap} label="Enrollments" value={stats.enrollments} />
        <StatsCard icon={Award} label="Active Certs" value={stats.active_certs} />
        <StatsCard icon={Clock} label="Expiring" value={stats.expiring_certs} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
          <input id="training-course-search" value={courseQuery} onChange={e => setCourseQuery(e.target.value)} placeholder="Search name / code / location"
            aria-label="Search courses by name, code, or location"
            className="w-full pl-7 pr-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-rmpg-100" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="select-dark text-xs">
          <option value="">All categories</option>
          {['firearms', 'defensive_tactics', 'legal', 'first_aid', 'de_escalation', 'professionalism', 'technical', 'other'].map(c => (
            <option key={c} value={c}>{toDisplayLabel(c)}</option>
          ))}
        </select>
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1">
          <input type="checkbox" checked={mandatoryOnly} onChange={e => setMandatoryOnly(e.target.checked)} /> Mandatory
        </label>
        <button type="button" disabled={visibleCourses.length === 0}
          onClick={() => downloadTextFile('training-courses.csv', trainingCoursesToCsv(visibleCourses))}
          className="toolbar-btn flex items-center gap-1 text-xs" style={{ height: 28, padding: '0 10px' }}>
          <Download size={12} /> CSV
        </button>
      </div>

      <DataTable
        columns={columns}
        data={visibleCourses}
        emptyMessage={courses.length === 0 ? 'No training courses found' : 'No courses match the filter'}
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row) => [
          m.action('Open / edit', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.separator(),
          m.copy('Copy course', row.course_name),
          m.copy('Copy code', row.course_code || ''),
          m.copyId(row.id),
          m.separator(),
          m.action('Delete', () => setCourseToDelete(row), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {/* New / Edit Course modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4" onClick={closeForm}>
          <div className="bg-surface-raised border border-rmpg-600 p-6 max-w-lg w-full my-auto" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-rmpg-100">{editingRecord ? 'Edit Course' : 'New Course'}</h3>
              <button type="button" onClick={closeForm} className="toolbar-btn p-1" aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="ff-trainingmanagementpage-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">Course Name <span className="text-red-500">*</span></label>
                <input id="ff-trainingmanagementpage-0" className="input-dark mt-1 w-full" value={formData.course_name || ''} onChange={e => setFormData({ ...formData, course_name: e.target.value })} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-trainingmanagementpage-1" className="text-[10px] text-rmpg-400 uppercase font-semibold">Code</label>
                  <input id="ff-trainingmanagementpage-1" className="input-dark mt-1 w-full" value={formData.course_code || ''} onChange={e => setFormData({ ...formData, course_code: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="ff-trainingmanagementpage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <select id="ff-trainingmanagementpage-2" className="select-dark mt-1 w-full" value={formData.category || 'other'} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                    {['firearms', 'defensive_tactics', 'legal', 'first_aid', 'de_escalation', 'professionalism', 'technical', 'other'].map(c => <option key={c} value={c}>{toDisplayLabel(c)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="ff-trainingmanagementpage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">Duration (hrs)</label>
                  <input id="ff-trainingmanagementpage-3" className="input-dark mt-1 w-full" type="number" min="0" step="0.5" value={formData.duration_hours || ''} onChange={e => setFormData({ ...formData, duration_hours: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="ff-trainingmanagementpage-4" className="text-[10px] text-rmpg-400 uppercase font-semibold">Instructor ID</label>
                  <input id="ff-trainingmanagementpage-4" className="input-dark mt-1 w-full" value={formData.instructor_id || ''} onChange={e => setFormData({ ...formData, instructor_id: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="ff-trainingmanagementpage-5" className="text-[10px] text-rmpg-400 uppercase font-semibold">Location</label>
                  <input id="ff-trainingmanagementpage-5" className="input-dark mt-1 w-full" value={formData.location || ''} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" onClick={closeForm} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button type="button" onClick={handleSave} disabled={submitting || !formData.course_name?.trim()} className="toolbar-btn toolbar-btn-primary px-4 disabled:opacity-50" style={{ height: 28 }}>
                {submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — replaces inline div confirm */}
      <ConfirmDialog
        isOpen={courseToDelete !== null}
        onClose={() => setCourseToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete training course?"
        message="This permanently removes the course. Existing enrollment records for this course remain in the database."
        details={
          courseToDelete && (
            <div className="space-y-0.5">
              <div className="font-medium text-rmpg-100">{courseToDelete.course_name}</div>
              {courseToDelete.course_code && <div className="text-rmpg-500">Code: {courseToDelete.course_code}</div>}
              {courseToDelete.category && <div className="text-rmpg-500">Category: {toDisplayLabel(String(courseToDelete.category))}</div>}
            </div>
          )
        }
        confirmLabel="Delete course"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
