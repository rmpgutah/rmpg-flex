import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { useToast } from '../components/ToastProvider';
import { GraduationCap, BookOpen, Award, Clock, Plus, Pencil, Trash2 } from 'lucide-react';

export default function TrainingManagementPage() {
  const [courses, setCourses] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ courses: 0, enrollments: 0, active_certs: 0, expiring_certs: 0 });
  const [editingRecord, setEditingRecord] = useState<Record<string, any> | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { addToast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Record<string, any>[] }>('/training/courses');
      setCourses(r.data || []);
      const s = await apiFetch<{ courses: number; enrollments: number; active_certs: number; expiring_certs: number }>('/training/stats');
      setStats(s);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  const openNew = () => { setEditingRecord(null); setFormData({ course_name: '', course_code: '', category: 'other', duration_hours: '', instructor_id: '', location: '', is_mandatory: 0 }); };
  const openEdit = (rec: Record<string, any>) => { setEditingRecord(rec); setFormData({ ...rec }); };
  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/training/courses/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/training/courses', { method: 'POST', body: JSON.stringify(formData) });
      }
      setEditingRecord(null); fetchData(); addToast(editingRecord ? 'Updated' : 'Created', 'success');
    } catch (err) { addToast(err instanceof Error ? err.message : 'Failed', 'error'); }
    finally { setSubmitting(false); }
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await apiFetch(`/training/courses/${deleteId}`, { method: 'DELETE' }); setDeleteId(null); fetchData(); addToast('Deleted', 'success'); }
    catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); }
  };

  const showForm = editingRecord !== null;
  const columns = [
    { key: 'course_name', label: 'Course' }, { key: 'course_code', label: 'Code' },
    { key: 'category', label: 'Category' }, { key: 'duration_hours', label: 'Hours' }, { key: 'instructor_name', label: 'Instructor' },
    { key: 'actions', label: '', width: '100px', render: (row: any) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-white"><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300"><Trash2 size={12} /></button>
      </div>
    )},
  ];

  if (loading) return <div className="p-6 text-[#888888]">Loading training records...</div>;
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TRAINING MANAGEMENT" icon={GraduationCap}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}><Plus size={13} /> New Course</button>
      </PanelTitleBar>
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={BookOpen} label="Courses" value={stats.courses} />
        <StatsCard icon={GraduationCap} label="Enrollments" value={stats.enrollments} />
        <StatsCard icon={Award} label="Active Certs" value={stats.active_certs} />
        <StatsCard icon={Clock} label="Expiring" value={stats.expiring_certs} />
      </div>
      <DataTable columns={columns} data={courses} emptyMessage="No training courses found" onRowClick={(row) => openEdit(row)} />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setEditingRecord(null)}>
          <div className="bg-surface-raised border border-[#333] p-6 max-w-lg w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-4">{editingRecord ? 'Edit Course' : 'New Course'}</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Course Name <span className="text-red-500">*</span></label>
                <input id="ff-trainingmanagementpage-0" className="input-dark mt-1" value={formData.course_name || ''} onChange={e => setFormData({...formData, course_name: e.target.value})} autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Code</label>
                  <input id="ff-trainingmanagementpage-1" className="input-dark mt-1" value={formData.course_code || ''} onChange={e => setFormData({...formData, course_code: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <select id="ff-trainingmanagementpage-2" className="select-dark mt-1" value={formData.category || 'other'} onChange={e => setFormData({...formData, category: e.target.value})}>
                    {['firearms','defensive_tactics','legal','first_aid','de_escalation','professionalism','technical','other'].map(c=><option key={c} value={c}>{c}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Duration (hrs)</label>
                  <input id="ff-trainingmanagementpage-3" className="input-dark mt-1" value={formData.duration_hours || ''} onChange={e => setFormData({...formData, duration_hours: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Instructor ID</label>
                  <input id="ff-trainingmanagementpage-4" className="input-dark mt-1" value={formData.instructor_id || ''} onChange={e => setFormData({...formData, instructor_id: e.target.value})} /></div>
                <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Location</label>
                  <input id="ff-trainingmanagementpage-5" className="input-dark mt-1" value={formData.location || ''} onChange={e => setFormData({...formData, location: e.target.value})} /></div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEditingRecord(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button onClick={handleSave} disabled={submitting} className="toolbar-btn-primary px-4" style={{ height: 28 }}>{submitting ? 'Saving...' : editingRecord ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
      {deleteId !== null && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setDeleteId(null)}><div className="bg-surface-raised border border-red-800 p-6 max-w-sm w-full" style={{ borderRadius: 2 }} onClick={e => e.stopPropagation()}><h3 className="text-sm font-bold text-red-400 mb-2">Delete Course</h3><p className="text-xs text-[#888888] mb-4">This permanently removes the course.</p><div className="flex justify-end gap-3"><button onClick={() => setDeleteId(null)} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button><button onClick={handleDelete} className="toolbar-btn-primary px-4" style={{ height: 28, borderColor: '#991b1b', color: '#f87171' }}>Delete</button></div></div></div>)}
    </div>
  );
}
