// ============================================================
// RMPG Flex — Onboarding Module
// Two sub-tabs: Checklists (templates), Progress (per-employee)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Plus, RefreshCw, Edit2, Trash2, GripVertical,
  CheckSquare, Square, Upload, FileText, Eye, ChevronDown,
  ChevronUp, Save, X, ListChecks,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';

// ─── Types ─────────────────────────────────────────────────

interface ChecklistTask {
  id: number;
  title: string;
  description: string;
  sort_order: number;
  is_required: boolean;
}

interface Checklist {
  id: number;
  name: string;
  description: string;
  task_count: number;
  is_active: boolean;
  tasks?: ChecklistTask[];
  created_at: string;
}

interface EmployeeChecklist {
  id: number;
  user_id: string;
  employee_name: string;
  badge_number?: string;
  checklist_id: number;
  checklist_name: string;
  assigned_at: string;
  completed_at?: string;
  progress: number;
  tasks: {
    id: number;
    task_id: number;
    title: string;
    is_required: boolean;
    completed: boolean;
    completed_at?: string;
    completed_by_name?: string;
  }[];
}

interface HrDocument {
  id: number;
  user_id: string;
  employee_name: string;
  document_name: string;
  document_type: string;
  file_path: string;
  requires_acknowledgment: boolean;
  acknowledged_at?: string;
  uploaded_at: string;
  uploaded_by_name: string;
}

const SUB_TABS = [
  { id: 'checklists', label: 'Checklists' },
  { id: 'progress', label: 'Progress' },
] as const;

// ─── Component ─────────────────────────────────────────────

export default function Onboarding() {
  const [subTab, setSubTab] = useState<string>('checklists');

  return (
    <div className="flex flex-col h-full">
      <PanelTitleBar title="Onboarding" icon={UserPlus}>
        <div className="flex items-center gap-0.5">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-2.5 py-1 text-[11px] rounded-sm transition-colors ${
                subTab === t.id
                  ? 'bg-brand-500/25 text-white'
                  : 'text-rmpg-400 hover:text-white hover:bg-[#1a2636]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PanelTitleBar>

      <div className="flex-1 overflow-auto p-3">
        {subTab === 'checklists' && <ChecklistsTab />}
        {subTab === 'progress' && <ProgressTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Checklists Tab (Templates)
// ═══════════════════════════════════════════════════════════

function ChecklistsTab() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingChecklist, setEditingChecklist] = useState<Checklist | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTasks, setFormTasks] = useState<{ title: string; description: string; is_required: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  const loadChecklists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Checklist[]>('/hr/onboarding/checklists');
      setChecklists(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadChecklists(); }, [loadChecklists]);

  const loadChecklistDetail = async (id: number) => {
    try {
      const data = await apiFetch<Checklist>(`/hr/onboarding/checklists/${id}`);
      setChecklists(prev => prev.map(c => c.id === id ? { ...c, tasks: data.tasks } : c));
    } catch { /* ignore */ }
  };

  const handleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      const cl = checklists.find(c => c.id === id);
      if (!cl?.tasks) loadChecklistDetail(id);
    }
  };

  const startCreate = () => {
    setFormName('');
    setFormDesc('');
    setFormTasks([{ title: '', description: '', is_required: true }]);
    setEditingChecklist(null);
    setShowCreate(true);
  };

  const startEdit = (cl: Checklist) => {
    setFormName(cl.name);
    setFormDesc(cl.description || '');
    setFormTasks(cl.tasks?.map(t => ({ title: t.title, description: t.description, is_required: t.is_required })) || []);
    setEditingChecklist(cl);
    setShowCreate(true);
    if (!cl.tasks) loadChecklistDetail(cl.id);
  };

  const addTask = () => {
    setFormTasks([...formTasks, { title: '', description: '', is_required: true }]);
  };

  const removeTask = (idx: number) => {
    setFormTasks(formTasks.filter((_, i) => i !== idx));
  };

  const updateTask = (idx: number, field: string, value: any) => {
    setFormTasks(formTasks.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    const validTasks = formTasks.filter(t => t.title.trim());
    if (validTasks.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        description: formDesc.trim(),
        tasks: validTasks.map((t, i) => ({ ...t, sort_order: i + 1 })),
      };
      if (editingChecklist) {
        await apiFetch(`/hr/onboarding/checklists/${editingChecklist.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/hr/onboarding/checklists', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowCreate(false);
      setEditingChecklist(null);
      loadChecklists();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleToggleActive = async (cl: Checklist) => {
    try {
      await apiFetch(`/hr/onboarding/checklists/${cl.id}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !cl.is_active }),
      });
      loadChecklists();
    } catch { /* ignore */ }
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-rmpg-400">{checklists.length} checklists</span>
          <button onClick={loadChecklists} className="text-rmpg-500 hover:text-white p-1" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
        >
          <Plus className="w-3.5 h-3.5" /> New Checklist
        </button>
      </div>

      {/* Create/Edit Form */}
      {showCreate && (
        <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs text-white font-medium">
              {editingChecklist ? 'Edit Checklist' : 'New Checklist'}
            </h4>
            <button onClick={() => setShowCreate(false)} className="text-rmpg-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Name</label>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className={inputClass + ' w-full'}
                placeholder="e.g. New Officer Onboarding"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5">Description</label>
              <input
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                className={inputClass + ' w-full'}
                placeholder="Optional description..."
              />
            </div>
          </div>

          {/* Task editor */}
          <div className="border-t border-[#1e3048] pt-2 mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-rmpg-500 font-medium uppercase">Tasks</span>
              <button onClick={addTask} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Task
              </button>
            </div>
            <div className="space-y-1.5">
              {formTasks.map((task, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <GripVertical className="w-3.5 h-3.5 text-rmpg-600 mt-2 shrink-0" />
                  <div className="flex-1 grid grid-cols-[1fr_1fr_auto] gap-1.5">
                    <input
                      value={task.title}
                      onChange={e => updateTask(idx, 'title', e.target.value)}
                      className={inputClass}
                      placeholder="Task title..."
                    />
                    <input
                      value={task.description}
                      onChange={e => updateTask(idx, 'description', e.target.value)}
                      className={inputClass}
                      placeholder="Description (optional)..."
                    />
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-1 text-[10px] text-rmpg-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={task.is_required}
                          onChange={e => updateTask(idx, 'is_required', e.target.checked)}
                          className="accent-brand-500"
                        />
                        Req
                      </label>
                      <button
                        onClick={() => removeTask(idx)}
                        className="p-0.5 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowCreate(false)} className="px-2.5 py-1 text-xs text-rmpg-400 hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> {saving ? 'Saving...' : editingChecklist ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Checklists list */}
      {loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading checklists...</div>
      ) : checklists.length === 0 ? (
        <div className="text-xs text-rmpg-500 text-center py-8">No checklists created yet.</div>
      ) : (
        <div className="space-y-2">
          {checklists.map(cl => (
            <div key={cl.id} className="bg-[#0d1520] border border-[#1e3048] rounded-sm">
              <div
                className="px-3 py-2.5 flex items-center justify-between cursor-pointer hover:bg-[#141e2b]"
                onClick={() => handleExpand(cl.id)}
              >
                <div className="flex items-center gap-2">
                  {expandedId === cl.id ? <ChevronUp className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" />}
                  <ListChecks className="w-4 h-4 text-brand-400" />
                  <span className="text-xs text-white font-medium">{cl.name}</span>
                  <span className="text-[10px] text-rmpg-500">{cl.task_count} tasks</span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded-sm border ${
                    cl.is_active
                      ? 'bg-green-500/20 text-green-300 border-green-500/40'
                      : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
                  }`}>
                    {cl.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => { loadChecklistDetail(cl.id).then(() => startEdit({ ...cl, tasks: checklists.find(c => c.id === cl.id)?.tasks })); }}
                    className="p-1 text-brand-400 hover:text-brand-300 hover:bg-brand-500/10 rounded-sm"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(cl)}
                    className={`px-2 py-0.5 text-[10px] rounded-sm border ${
                      cl.is_active
                        ? 'border-red-500/40 text-red-300 hover:bg-red-500/10'
                        : 'border-green-500/40 text-green-300 hover:bg-green-500/10'
                    }`}
                  >
                    {cl.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
              {expandedId === cl.id && cl.tasks && (
                <div className="px-3 pb-3 border-t border-[#1e3048]/50">
                  {cl.description && (
                    <p className="text-[10px] text-rmpg-400 mt-2 mb-1">{cl.description}</p>
                  )}
                  <div className="space-y-1 mt-2">
                    {cl.tasks.map((task, i) => (
                      <div key={task.id || i} className="flex items-center gap-2 text-xs">
                        <span className="text-rmpg-600 font-mono w-5 text-right">{i + 1}.</span>
                        <span className="text-white">{task.title}</span>
                        {task.is_required && (
                          <span className="text-[9px] text-red-400">REQ</span>
                        )}
                        {task.description && (
                          <span className="text-rmpg-500 italic text-[10px]">- {task.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Progress Tab (Per-employee onboarding)
// ═══════════════════════════════════════════════════════════

function ProgressTab() {
  const [employees, setEmployees] = useState<{ id: string; full_name: string; badge_number?: string }[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employeeChecklists, setEmployeeChecklists] = useState<EmployeeChecklist[]>([]);
  const [documents, setDocuments] = useState<HrDocument[]>([]);
  const [availableChecklists, setAvailableChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignChecklistId, setAssignChecklistId] = useState<number>(0);
  const [assigning, setAssigning] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; full_name: string; badge_number?: string }[]>('/hr/employees').then(setEmployees).catch(err => console.warn('[HR] Failed to load data:', err));
    apiFetch<Checklist[]>('/hr/onboarding/checklists?active=true').then(setAvailableChecklists).catch(err => console.warn('[HR] Failed to load data:', err));
  }, []);

  const loadEmployeeData = useCallback(async (userId: string) => {
    if (!userId) return;
    setLoading(true);
    try {
      const [cls, docs] = await Promise.all([
        apiFetch<EmployeeChecklist[]>(`/hr/onboarding/progress/${userId}`),
        apiFetch<HrDocument[]>(`/hr/documents/${userId}`),
      ]);
      setEmployeeChecklists(cls);
      setDocuments(docs);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedEmployee) loadEmployeeData(selectedEmployee);
  }, [selectedEmployee, loadEmployeeData]);

  const handleToggleTask = async (assignmentId: number, taskId: number, completed: boolean) => {
    try {
      await apiFetch(`/hr/onboarding/progress/${assignmentId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ completed }),
      });
      if (selectedEmployee) loadEmployeeData(selectedEmployee);
    } catch { /* ignore */ }
  };

  const handleAssignChecklist = async () => {
    if (!selectedEmployee || !assignChecklistId) return;
    setAssigning(true);
    try {
      await apiFetch('/hr/onboarding/assign', {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedEmployee, checklist_id: assignChecklistId }),
      });
      setShowAssign(false);
      setAssignChecklistId(0);
      loadEmployeeData(selectedEmployee);
    } catch { /* ignore */ }
    setAssigning(false);
  };

  const handleUploadDocument = async () => {
    if (!selectedEmployee || !uploadFile || !uploadName.trim()) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('user_id', selectedEmployee);
      formData.append('document_name', uploadName.trim());
      formData.append('requires_acknowledgment', String(requiresAck));

      await fetch('/api/hr/documents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('rmpg_token')}`,
        },
        body: formData,
      });
      setUploadName('');
      setUploadFile(null);
      setRequiresAck(false);
      loadEmployeeData(selectedEmployee);
    } catch { /* ignore */ }
    setUploading(false);
  };

  const inputClass = 'bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none';

  return (
    <>
      {/* Employee selector */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-rmpg-400">Employee:</label>
        <select
          value={selectedEmployee}
          onChange={e => setSelectedEmployee(e.target.value)}
          className={inputClass + ' w-64'}
        >
          <option value="">Select employee...</option>
          {employees.map(u => (
            <option key={u.id} value={u.id}>
              {u.full_name}{u.badge_number ? ` (#${u.badge_number})` : ''}
            </option>
          ))}
        </select>
        {selectedEmployee && (
          <button
            onClick={() => setShowAssign(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600"
          >
            <Plus className="w-3.5 h-3.5" /> Assign Checklist
          </button>
        )}
      </div>

      {!selectedEmployee ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Select an employee to view their onboarding progress.</div>
      ) : loading ? (
        <div className="text-xs text-rmpg-500 text-center py-8">Loading...</div>
      ) : (
        <div className="space-y-4">
          {/* Checklists */}
          {employeeChecklists.length === 0 ? (
            <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm p-4 text-center">
              <p className="text-xs text-rmpg-500">No checklists assigned to this employee.</p>
            </div>
          ) : (
            employeeChecklists.map(ecl => {
              const completedCount = ecl.tasks.filter(t => t.completed).length;
              const totalCount = ecl.tasks.length;
              const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

              return (
                <div key={ecl.id} className="bg-[#0d1520] border border-[#1e3048] rounded-sm">
                  <div className="px-3 py-2.5 border-b border-[#1e3048]/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ListChecks className="w-4 h-4 text-brand-400" />
                        <span className="text-xs text-white font-medium">{ecl.checklist_name}</span>
                        <span className="text-[10px] text-rmpg-500">{completedCount}/{totalCount} tasks</span>
                      </div>
                      <span className="text-xs font-mono text-rmpg-400">{pct}%</span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-1.5 bg-[#141e2b] rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="p-3 space-y-1">
                    {ecl.tasks.map(task => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 py-1 px-1 hover:bg-[#141e2b] rounded-sm cursor-pointer"
                        onClick={() => handleToggleTask(ecl.id, task.id, !task.completed)}
                      >
                        {task.completed ? (
                          <CheckSquare className="w-4 h-4 text-green-400 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-rmpg-600 shrink-0" />
                        )}
                        <span className={`text-xs ${task.completed ? 'text-rmpg-500 line-through' : 'text-white'}`}>
                          {task.title}
                        </span>
                        {task.is_required && !task.completed && (
                          <span className="text-[9px] text-red-400">REQ</span>
                        )}
                        {task.completed && task.completed_by_name && (
                          <span className="text-[10px] text-rmpg-600 ml-auto">
                            {task.completed_by_name} - {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : ''}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* HR Documents */}
          <div className="bg-[#0d1520] border border-[#1e3048] rounded-sm">
            <div className="px-3 py-2.5 border-b border-[#1e3048]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                <span className="text-xs text-white font-medium">HR Documents</span>
                <span className="text-[10px] text-rmpg-500">{documents.length} documents</span>
              </div>
            </div>

            {/* Upload section */}
            <div className="px-3 py-2 border-b border-[#1e3048]/30">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-rmpg-500 mb-0.5">Document Name</label>
                  <input
                    value={uploadName}
                    onChange={e => setUploadName(e.target.value)}
                    className={inputClass + ' w-full'}
                    placeholder="e.g. Employment Agreement"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-500 mb-0.5">File</label>
                  <input
                    type="file"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    className="text-[10px] text-rmpg-400 file:mr-2 file:py-1 file:px-2 file:rounded-sm file:border-0 file:text-xs file:bg-[#1a2636] file:text-rmpg-300 hover:file:bg-[#1e3048]"
                  />
                </div>
                <label className="flex items-center gap-1 text-[10px] text-rmpg-400 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={requiresAck}
                    onChange={e => setRequiresAck(e.target.checked)}
                    className="accent-brand-500"
                  />
                  Requires Ack
                </label>
                <button
                  onClick={handleUploadDocument}
                  disabled={uploading || !uploadFile || !uploadName.trim()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="w-3 h-3" /> {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>

            {/* Documents list */}
            <div className="p-3">
              {documents.length === 0 ? (
                <p className="text-xs text-rmpg-500 text-center py-2">No documents uploaded.</p>
              ) : (
                <div className="space-y-1">
                  {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between py-1.5 px-2 hover:bg-[#141e2b] rounded-sm">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-rmpg-500" />
                        <span className="text-xs text-white">{doc.document_name}</span>
                        {doc.requires_acknowledgment && (
                          <span className={`text-[9px] px-1 py-0.5 rounded-sm border ${
                            doc.acknowledged_at
                              ? 'bg-green-500/20 text-green-300 border-green-500/40'
                              : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                          }`}>
                            {doc.acknowledged_at ? 'ACKNOWLEDGED' : 'NEEDS ACK'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-rmpg-500 font-mono">
                          {new Date(doc.uploaded_at).toLocaleDateString()}
                        </span>
                        <a
                          href={`/api/hr/documents/${doc.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 text-brand-400 hover:text-brand-300"
                          title="View"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assign Checklist Modal */}
      {showAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAssign(false)}>
          <div className="bg-[#141e2b] border border-[#1e3048] rounded-sm w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-2 border-b border-[#1e3048]">
              <h3 className="text-sm font-semibold text-white">Assign Checklist</h3>
            </div>
            <div className="p-4">
              <label className="block text-xs text-rmpg-400 mb-1">Checklist</label>
              <select
                value={assignChecklistId}
                onChange={e => setAssignChecklistId(Number(e.target.value))}
                className={inputClass + ' w-full'}
              >
                <option value={0}>Select checklist...</option>
                {availableChecklists.map(cl => (
                  <option key={cl.id} value={cl.id}>{cl.name} ({cl.task_count} tasks)</option>
                ))}
              </select>
            </div>
            <div className="px-4 py-2 border-t border-[#1e3048] flex justify-end gap-2">
              <button onClick={() => setShowAssign(false)} className="px-3 py-1.5 text-xs text-rmpg-400 hover:text-white">Cancel</button>
              <button
                onClick={handleAssignChecklist}
                disabled={assigning || !assignChecklistId}
                className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-sm hover:bg-brand-600 disabled:opacity-50"
              >
                {assigning ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
