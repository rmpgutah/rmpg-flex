import React, { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, CheckCircle, AlertTriangle, Loader2, Search } from 'lucide-react';
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
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isManager = ['admin', 'manager', 'supervisor'].includes(userRole);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const params = filterCat !== 'all' ? `?category=${filterCat}` : '';
      try { const data = await apiFetch<any[]>(`/hr/documents${params}`); setDocs(data); } catch { addToast('Failed to load documents', 'error'); }
    } finally { setLoading(false); }
  };

  const loadAcks = async (docId: number) => {
    try { const data = await apiFetch<any[]>(`/hr/acknowledgments?document_id=${docId}`); setAcks(data); } catch { addToast('Failed to load acknowledgments', 'error'); }
  };

  useEffect(() => { loadDocs(); }, [filterCat]);
  useEffect(() => { if (selectedDocId) loadAcks(selectedDocId); }, [selectedDocId]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleCreate = async () => {
    if (!form.title.trim()) { addToast('Title is required', 'error'); return; }
    setSubmitting(true);
    try { await apiFetch('/hr/documents', { method: 'POST', body: JSON.stringify(form) }); addToast('Document created', 'success'); setShowForm(false); setForm({ title: '', category: 'policy', description: '' }); loadDocs(); } catch { addToast('Failed to create document', 'error'); } finally { setSubmitting(false); }
  };

  const handleAcknowledge = async (docId: number) => {
    try { await apiFetch('/hr/acknowledgments', { method: 'POST', body: JSON.stringify({ document_id: docId }) }); addToast('Acknowledged', 'success'); loadAcks(docId); } catch { addToast('Failed to acknowledge document', 'error'); }
  };

  const handleDelete = async (docId: number) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    try { await apiFetch<any[]>(`/hr/documents/${docId}`, { method: 'DELETE' }); addToast('Document deleted', 'success'); loadDocs(); } catch { addToast('Failed to delete document', 'error'); }
  };

  const myAcks = new Set(acks.filter(a => a.officer_id === Number(user?.id)).map(a => a.document_id));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><FileText className="w-4 h-4" /> HR Document Library</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500 pointer-events-none" aria-hidden="true" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search documents..." aria-label="Search HR documents by name, category, or officer" className="input-field text-xs py-1 pl-6 pr-2 w-48 focus:ring-1 focus:ring-brand-500/50 transition-shadow duration-150" />
          </div>
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
              <label className="field-label">Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input-field w-full text-xs" placeholder="Document title" maxLength={200} />
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
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={3} placeholder="Brief description of the document..." maxLength={1000} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={submitting || !form.title.trim()} className="toolbar-btn toolbar-btn-success text-xs disabled:opacity-50">{submitting ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Creating...</> : 'Create'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-12 text-xs"><Loader2 className="w-5 h-5 animate-spin text-brand-400" role="status" aria-label="Loading documents" /> Loading documents...</div>
      ) : (
        <div className="space-y-2" role="list" aria-label="HR documents">
          {docs.filter(doc => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return doc.title.toLowerCase().includes(q) || doc.description?.toLowerCase().includes(q) || doc.category.toLowerCase().includes(q);
          }).map(doc => (
            <div key={doc.id} role="listitem" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDocId(doc.id); }} className={`panel-beveled p-3 cursor-pointer transition-all duration-150 hover:bg-surface-raised/30 hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-brand-500/40 ${selectedDocId === doc.id ? 'border-brand-500 shadow-sm' : ''}`} onClick={() => setSelectedDocId(doc.id)}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-brand-400" />
                    <span className="text-xs font-bold text-white">{doc.title}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 bg-rmpg-700 text-rmpg-300 uppercase rounded-sm border border-rmpg-700">{doc.category}</span>
                  </div>
                  {doc.description && <p className="text-[10px] text-rmpg-400 mt-1">{doc.description}</p>}
                  <span className="text-[10px] text-rmpg-500">Uploaded by {doc.uploaded_by_name} on {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
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
                <div className="mt-3 border-t border-rmpg-700 pt-2">
                  <p className="text-[10px] text-rmpg-400 font-bold mb-1">Acknowledgments ({acks.length})</p>
                  <div className="grid grid-cols-3 gap-1">
                    {acks.map(a => (
                      <div key={a.id} className="text-[10px] text-rmpg-300">{a.officer_name} - {a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</div>
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
