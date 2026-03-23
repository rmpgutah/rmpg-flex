import React, { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';

interface HRDocument {
  id: number;
  title: string;
  category: string;
  description: string;
  file_name: string;
  uploaded_by_name: string;
  created_at: string;
}

interface Acknowledgment {
  id: number;
  officer_id: number;
  officer_name: string;
  document_id: number;
  document_title: string;
  acknowledged_at: string;
}

const CATEGORIES = ['policy', 'handbook', 'procedure', 'training', 'compliance', 'safety', 'benefits', 'other'];

export default function DocumentsTab({ userRole }: { userRole: string }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [docs, setDocs] = useState<HRDocument[]>([]);
  const [acks, setAcks] = useState<Acknowledgment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState('all');
  const [form, setForm] = useState({ title: '', category: 'policy', description: '' });

  const isManager = ['admin', 'manager', 'supervisor'].includes(userRole);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const params = filterCat !== 'all' ? `?category=${filterCat}` : '';
      try { const data = await apiFetch<any[]>(`/hr/documents${params}`); setDocs(data); } catch { /* handled */ }
    } finally { setLoading(false); }
  };

  const loadAcks = async (docId: number) => {
    try { const data = await apiFetch<any[]>(`/hr/acknowledgments?document_id=${docId}`); setAcks(data); } catch { /* handled */ }
  };

  useEffect(() => { loadDocs(); }, [filterCat]);
  useEffect(() => { if (selectedDocId) loadAcks(selectedDocId); }, [selectedDocId]);

  const handleCreate = async () => {
    if (!form.title) { addToast('Title required', 'error'); return; }
    try { await apiFetch('/hr/documents', { method: 'POST', body: JSON.stringify(form) }); addToast('Document created', 'success'); setShowForm(false); setForm({ title: '', category: 'policy', description: '' }); loadDocs(); } catch { /* handled */ }
  };

  const handleAcknowledge = async (docId: number) => {
    try { await apiFetch('/hr/acknowledgments', { method: 'POST', body: JSON.stringify({ document_id: docId }) }); addToast('Acknowledged', 'success'); loadAcks(docId); } catch { /* handled */ }
  };

  const handleDelete = async (docId: number) => {
    try { await apiFetch<any[]>(`/hr/documents/${docId}`, { method: 'DELETE' }); addToast('Document deleted', 'success'); loadDocs(); } catch { /* handled */ }
  };

  const myAcks = new Set(acks.filter(a => a.officer_id === Number(user?.id)).map(a => a.document_id));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><FileText className="w-4 h-4" /> HR Document Library</h2>
        <div className="flex items-center gap-2">
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input-field text-xs py-1 px-2">
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          {isManager && <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> Add Document</button>}
        </div>
      </div>

      {showForm && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input-field w-full text-xs" />
            </div>
            <div>
              <label className="field-label">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input-field w-full text-xs">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={3} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} className="toolbar-btn toolbar-btn-success text-xs">Create</button>
            <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">Loading...</div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDocId(doc.id); }} className={`panel-beveled p-3 cursor-pointer ${selectedDocId === doc.id ? 'border-brand-500' : ''}`} onClick={() => setSelectedDocId(doc.id)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-brand-400" />
                    <span className="text-xs font-bold text-white">{doc.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-rmpg-700 text-rmpg-300 uppercase">{doc.category}</span>
                  </div>
                  {doc.description && <p className="text-[10px] text-rmpg-400 mt-1">{doc.description}</p>}
                  <span className="text-[10px] text-rmpg-500">Uploaded by {doc.uploaded_by_name} on {doc.created_at?.substring(0, 10)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {!myAcks.has(doc.id) ? (
                    <button type="button" onClick={e => { e.stopPropagation(); handleAcknowledge(doc.id); }} className="toolbar-btn toolbar-btn-success text-[9px]">
                      <CheckCircle className="w-3 h-3" /> Acknowledge
                    </button>
                  ) : (
                    <span className="text-[10px] text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Acknowledged</span>
                  )}
                  {isManager && (
                    <button type="button" onClick={e => { e.stopPropagation(); handleDelete(doc.id); }} className="toolbar-btn toolbar-btn-danger text-[9px]"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              </div>

              {selectedDocId === doc.id && acks.length > 0 && (
                <div className="mt-3 border-t border-rmpg-600 pt-2">
                  <p className="text-[10px] text-rmpg-400 font-bold mb-1">Acknowledgments ({acks.length})</p>
                  <div className="grid grid-cols-3 gap-1">
                    {acks.map(a => (
                      <div key={a.id} className="text-[10px] text-rmpg-300">{a.officer_name} - {a.acknowledged_at?.substring(0, 10)}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
