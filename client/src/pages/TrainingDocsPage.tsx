// ============================================================
// RMPG Flex — Training & Docs: Company Policies, SOPs, Manuals
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import RichTextArea from '../components/RichTextArea';
import {
  BookOpen, Plus, Search, FileText, ExternalLink, Download, Trash2,
  Edit2, Loader2, X, Upload, Link as LinkIcon, Star, Eye, EyeOff,
  FileVideo, FileSpreadsheet, FileImage, File, Printer,
} from 'lucide-react';
import { BLANK_FORMS, downloadBlankForm } from '../utils/blankFormGenerator';
import { useAuth } from '../context/AuthContext';
import {
  apiFetchCompanyDocuments,
  apiCreateCompanyDocument,
  apiUpdateCompanyDocument,
  apiDeleteCompanyDocument,
  apiUploadFiles,
} from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import type { CompanyDocCategory } from '../types';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';
import { safeDateStr } from '../utils/dateUtils';

// ── Category config ─────────────────────────────────────────
const CATEGORIES: { key: CompanyDocCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'policy', label: 'Policies' },
  { key: 'procedure', label: 'Procedures' },
  { key: 'sop', label: 'SOPs' },
  { key: 'training_manual', label: 'Training Manuals' },
  { key: 'form', label: 'Forms' },
  { key: 'reference', label: 'Reference' },
  { key: 'general', label: 'General' },
];

const CATEGORY_COLORS: Record<string, string> = {
  policy: 'bg-red-900/40 text-red-400 border-red-700/50',
  procedure: 'bg-gray-900/40 text-gray-400 border-gray-700/50',
  sop: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
  training_manual: 'bg-green-900/40 text-green-400 border-green-700/50',
  form: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
  reference: 'bg-gray-900/40 text-gray-400 border-gray-700/50',
  general: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

function fileIcon(mimeType?: string) {
  if (!mimeType) return <File className="w-5 h-5 text-rmpg-400" />;
  if (mimeType.startsWith('image/')) return <FileImage className="w-5 h-5 text-gray-400" />;
  if (mimeType.startsWith('video/')) return <FileVideo className="w-5 h-5 text-purple-400" />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <FileSpreadsheet className="w-5 h-5 text-green-400" />;
  if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-red-400" />;
  return <FileText className="w-5 h-5 text-amber-400" />;
}

function formatFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Main component ──────────────────────────────────────────
const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function TrainingDocsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access

  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<CompanyDocCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editDoc, setEditDoc] = useState<any | null>(null);
  const [showBlankForms, setShowBlankForms] = useState(false);

  // Document title
  useEffect(() => { document.title = 'Policies & Training Docs \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { setShowModal(false); setEditDoc(null); }
      if ((e.key === 'n' || e.key === 'N') && isAdmin) { setEditDoc(null); setShowModal(true); }
      if (e.key === 'r' || e.key === 'R') { loadDocuments(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdmin]);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetchCompanyDocuments(category !== 'all' ? category : undefined);
      setDocuments(data || []);
    } catch (err) {
      console.error('Failed to load documents:', err);
      addToast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useLiveSync('company-documents', loadDocuments);

  const filtered = useMemo(() => {
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter(
      (d) => d.title?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q),
    );
  }, [documents, search]);

  const handleDelete = async (doc: any) => {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await apiDeleteCompanyDocument(doc.id);
      addToast('Document deleted successfully', 'success');
      loadDocuments();
    } catch (err) {
      console.error('Delete failed:', err);
      addToast('Failed to delete document', 'error');
    }
  };

  const handleDownload = (doc: any) => {
    if (doc.content_type === 'link' && doc.external_url) {
      // Validate URL protocol and reject javascript: / data: schemes to prevent open redirect
      try {
        const parsed = new URL(doc.external_url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          window.open(doc.external_url, '_blank', 'noopener,noreferrer');
        }
      } catch { /* invalid URL — ignore */ }
      return;
    }
    if (doc.file_id) {
      // Use JWT token fallback for download (signatures are not available from this endpoint)
      const token = localStorage.getItem('rmpg_token') || '';
      window.open(`/api/uploads/${doc.file_id}/download?token=${encodeURIComponent(token)}`, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-sunken">
      {/* Header */}
      <div className="panel-beveled border-b border-rmpg-700 p-3 flex items-center justify-between flex-shrink-0 print:hidden">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-brand-400" />
          <h1 className="text-sm font-bold text-rmpg-100 uppercase tracking-wider">
            Company Policies & Training Documents
          </h1>
          <span className="text-[9px] font-mono text-rmpg-400 bg-rmpg-700/50 px-1.5 py-0.5 rounded-sm ml-2">{filtered.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
            <input
              type="text"
              placeholder="Search documents..." aria-label="Search documents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-dark text-[11px] pl-6 pr-2 py-1 w-48 min-h-[36px]"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-rmpg-500 hover:text-rmpg-300" />
              </button>
            )}
          </div>
          <button type="button"
            onClick={() => setShowBlankForms(v => !v)}
            className={`toolbar-btn text-[10px] px-3 py-1 flex items-center gap-1 ${showBlankForms ? 'toolbar-btn-primary' : ''}`}
            title="Printable Blank Forms"
          >
            <Printer className="w-3 h-3" />
            Blank Forms
          </button>
          <ExportButton exportUrl="/api/company-documents/export/csv" exportFilename="training-docs.csv" />
          {isAdmin && (
            <button type="button"
              onClick={() => { setEditDoc(null); setShowModal(true); }}
              className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              Add Document
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="panel-inset mx-3 mt-3 p-1.5 flex items-center gap-1 flex-wrap flex-shrink-0" role="tablist" aria-label="Document categories">
        {CATEGORIES.map((cat) => (
          <button type="button"
            key={cat.key}
            role="tab"
            aria-selected={category === cat.key}
            onClick={() => setCategory(cat.key)}
            className={`text-[10px] px-2.5 py-1 transition-colors duration-150 ${
              category === cat.key ? 'toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Blank Forms Grid */}
      {showBlankForms && (
        <div className="mx-3 mt-3 panel-beveled border border-rmpg-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Printer className="w-4 h-4 text-brand-400" />
            <h2 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Printable Blank Forms</h2>
            <span className="text-[9px] text-rmpg-500 ml-2">Download blank PDF forms for field use</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {(['incident', 'record', 'operations', 'administrative'] as const).map(cat => (
              <div key={cat}>
                <h3 className="text-[10px] font-bold text-rmpg-400 uppercase mb-2 tracking-wider">{cat}</h3>
                {BLANK_FORMS.filter(f => f.category === cat).map(form => (
                  <button
                    key={form.id}
                    onClick={() => downloadBlankForm(form.id)}
                    className="w-full text-left mb-2 px-3 py-2 bg-surface-raised hover:bg-surface-raised/80 border border-rmpg-700/50 transition-colors"
                    style={{ borderRadius: '2px' }}
                  >
                    <div className="text-[11px] font-bold text-white">{form.name}</div>
                    <div className="text-[9px] text-rmpg-400 mt-0.5">{form.formNumber}</div>
                    <div className="text-[9px] text-rmpg-500 mt-0.5">{form.description}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-dark" role="tabpanel">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" />
            <span className="ml-2 text-xs text-rmpg-400">Loading documents...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16" role="status">
            <div className="w-16 h-16 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
              <BookOpen className="w-8 h-8 text-rmpg-600" />
            </div>
            <p className="text-sm text-rmpg-400 font-medium">
              {search ? 'No documents match your search' : 'No documents have been added yet'}
            </p>
            {isAdmin && !search && (
              <p className="text-[10px] text-rmpg-600 mt-1">Click "Add Document" to upload the first policy or training manual</p>
            )}
          </div>
        ) : (
          filtered.map((doc) => (
            <div
              key={doc.id}
              className="panel-beveled p-3 bg-surface-base hover:bg-rmpg-800/30 hover:shadow-sm transition-all duration-150 border-l-2 border-l-brand-500/50"
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {doc.content_type === 'link' ? (
                    <ExternalLink className="w-5 h-5 text-gray-400" />
                  ) : (
                    fileIcon(doc.mime_type)
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-rmpg-100 truncate">{doc.title}</span>
                    {doc.is_required_reading === 1 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-red-900/50 text-red-400 border border-red-700/50 flex-shrink-0">
                        <Star className="w-2 h-2" />
                        Required
                      </span>
                    )}
                    {doc.published === 0 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50 flex-shrink-0">
                        <EyeOff className="w-2 h-2" />
                        Draft
                      </span>
                    )}
                    <span className={`inline-block px-1.5 py-0.5 text-[8px] font-bold uppercase border flex-shrink-0 ${
                      CATEGORY_COLORS[doc.category] || CATEGORY_COLORS.general
                    }`}>
                      {doc.category?.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {doc.description && (
                    <p className="text-[11px] text-rmpg-400 line-clamp-2 mb-1">{doc.description}</p>
                  )}

                  <div className="flex items-center gap-3 text-[10px] text-rmpg-500">
                    {doc.creator_name && <span>By {doc.creator_name}</span>}
                    <span title={safeDateStr(doc.created_at)}>{timeAgo(doc.created_at)}</span>
                    {doc.file_size > 0 && <span>{formatFileSize(doc.file_size)}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button"
                    onClick={() => handleDownload(doc)}
                    className="toolbar-btn p-1.5"
                    title={doc.content_type === 'link' ? 'Open Link' : 'Download'}
                  >
                    {doc.content_type === 'link' ? (
                      <ExternalLink className="w-3.5 h-3.5" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {isAdmin && (
                    <>
                      <button type="button"
                        onClick={() => { setEditDoc(doc); setShowModal(true); }}
                        className="toolbar-btn p-1.5"
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button type="button"
                        onClick={() => handleDelete(doc)}
                        className="toolbar-btn p-1.5 text-red-400 hover:text-red-300"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <DocumentModal
          doc={editDoc}
          onClose={() => { setShowModal(false); setEditDoc(null); }}
          onSaved={() => { setShowModal(false); setEditDoc(null); loadDocuments(); }}
        />
      )}
    </div>
  );
}

// ── Add/Edit Document Modal ─────────────────────────────────
interface ModalProps {
  doc: any | null;
  onClose: () => void;
  onSaved: () => void;
}

function DocumentModal({ doc, onClose, onSaved }: ModalProps) {
  const isEdit = !!doc;
  const { addToast } = useToast();
  const [title, setTitle] = useState(doc?.title || '');
  const [description, setDescription] = useState(doc?.description || '');
  const [category, setCategory] = useState<CompanyDocCategory>(doc?.category || 'general');
  const [contentType, setContentType] = useState<'file' | 'link'>(doc?.content_type || 'file');
  const [externalUrl, setExternalUrl] = useState(doc?.external_url || '');
  const [isRequired, setIsRequired] = useState(doc?.is_required_reading === 1);
  const [published, setPublished] = useState(doc?.published !== 0);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (contentType === 'link' && !externalUrl.trim()) { setError('URL is required for link documents'); return; }
    if (contentType === 'file' && !isEdit && !file && !doc?.file_id) { setError('Please select a file to upload'); return; }

    setSaving(true);
    setError('');
    try {
      let fileId = doc?.file_id || null;

      // Upload file if provided
      if (file) {
        const uploaded = await apiUploadFiles([file], 'company_document');
        if (uploaded.length > 0) {
          fileId = uploaded[0].file_id;
        }
      }

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        category,
        content_type: contentType,
        file_id: contentType === 'file' ? fileId : null,
        external_url: contentType === 'link' ? externalUrl.trim() : null,
        is_required_reading: isRequired,
        published,
      };

      if (isEdit) {
        await apiUpdateCompanyDocument(doc.id, payload);
        addToast('Document updated successfully', 'success');
      } else {
        await apiCreateCompanyDocument(payload);
        addToast('Document created successfully', 'success');
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save document');
      addToast('Failed to save document', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="panel-beveled bg-surface-base w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-rmpg-700">
          <h2 className="text-sm font-bold text-rmpg-100">
            {isEdit ? 'Edit Document' : 'Add Document'}
          </h2>
          <button type="button" onClick={onClose} className="toolbar-btn p-1" aria-label="Close" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="text-[11px] text-red-400 bg-red-900/30 border border-red-700/50 px-3 py-1.5">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="field-label mb-1 block">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
              placeholder="e.g. Use of Force Policy"
            />
          </div>

          {/* Description */}
          <div>
            <label className="field-label mb-1 block">Description</label>
            <RichTextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-dark w-full text-[11px] px-2 py-1.5 h-16 resize-none min-h-[36px]"
              placeholder="Brief description of this document..."
            />
          </div>

          {/* Category */}
          <div>
            <label className="field-label mb-1 block">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CompanyDocCategory)}
              className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
            >
              <option value="general">General</option>
              <option value="policy">Policy</option>
              <option value="procedure">Procedure</option>
              <option value="sop">SOP</option>
              <option value="training_manual">Training Manual</option>
              <option value="form">Form</option>
              <option value="reference">Reference</option>
            </select>
          </div>

          {/* Content Type Toggle */}
          <div>
            <label className="field-label mb-1 block">Document Type</label>
            <div className="flex gap-2">
              <button type="button"
                onClick={() => setContentType('file')}
                className={`flex-1 text-[10px] px-3 py-1.5 flex items-center justify-center gap-1.5 ${
                  contentType === 'file' ? 'toolbar-btn-primary' : 'toolbar-btn'
                }`}
              >
                <Upload className="w-3 h-3" />
                File Upload
              </button>
              <button type="button"
                onClick={() => setContentType('link')}
                className={`flex-1 text-[10px] px-3 py-1.5 flex items-center justify-center gap-1.5 ${
                  contentType === 'link' ? 'toolbar-btn-primary' : 'toolbar-btn'
                }`}
              >
                <LinkIcon className="w-3 h-3" />
                External Link
              </button>
            </div>
          </div>

          {/* File Upload or URL */}
          {contentType === 'file' ? (
            <div>
              <label className="field-label mb-1 block">
                File {!isEdit && '*'}
              </label>
              <label className="flex items-center gap-2 p-3 border border-dashed border-rmpg-600 bg-rmpg-900/30 cursor-pointer hover:border-brand-500/50 transition-colors">
                <Upload className="w-4 h-4 text-rmpg-400" />
                <span className="text-[11px] text-rmpg-400">
                  {file ? file.name : (doc?.file_name || 'Click to select file...')}
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              {file && (
                <p className="text-[10px] text-rmpg-500 mt-1">{formatFileSize(file.size)}</p>
              )}
            </div>
          ) : (
            <div>
              <label className="field-label mb-1 block">URL *</label>
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                className="input-dark w-full text-[11px] px-2 py-1.5 min-h-[36px]"
                placeholder="https://..."
              />
            </div>
          )}

          {/* Toggles */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="accent-brand-500"
              />
              <span className="text-[11px] text-rmpg-300">Required Reading</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="accent-brand-500"
              />
              <span className="text-[11px] text-rmpg-300">Published</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-3 border-t border-rmpg-700">
          <button type="button" onClick={onClose} className="toolbar-btn text-[10px] px-4 py-1.5">
            Cancel
          </button>
          <button type="button"
            onClick={handleSave}
            disabled={saving}
            className="toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />}
            {isEdit ? 'Save Changes' : 'Add Document'}
          </button>
        </div>
      </div>
    </div>
  );
}
