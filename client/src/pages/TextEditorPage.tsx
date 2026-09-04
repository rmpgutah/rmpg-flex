import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Loader2, Download, FileText, RotateCcw, Copy, Check, Trash2 } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { authedImageUrl } from '../hooks/useApi';

function langLabel(mime: string, name: string): string {
  if (mime === 'application/json') return 'JSON';
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'Markdown';
  if (mime === 'text/csv') return 'CSV';
  if (mime === 'text/xml' || mime === 'application/xml') return 'XML';
  if (mime === 'text/javascript' || mime === 'application/javascript') return 'JavaScript';
  if (mime === 'text/x-python') return 'Python';
  if (mime === 'text/x-sh') return 'Shell';
  if (mime === 'text/x-yaml' || mime === 'application/x-yaml') return 'YAML';
  if (mime === 'text/html') return 'HTML';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'md') return 'Markdown';
  if (ext === 'json') return 'JSON';
  if (ext === 'csv') return 'CSV';
  if (ext === 'xml') return 'XML';
  if (ext === 'js' || ext === 'ts') return 'JS/TS';
  if (ext === 'py') return 'Python';
  if (ext === 'sh') return 'Shell';
  if (ext === 'yaml' || ext === 'yml') return 'YAML';
  if (ext === 'html') return 'HTML';
  return 'Plain text';
}

export default function TextEditorPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();

  // Support both ?fileId= (Documents page navigation) and ?doc_id= (deep-link alias)
  const fileId = searchParams.get('fileId') ?? searchParams.get('doc_id') ?? '';
  const fileName = searchParams.get('name') ?? 'untitled.txt';
  const folderId = searchParams.get('folderId') ?? null;
  const mimeType = searchParams.get('mime') ?? 'text/plain';

  // Role gates: supervisor+ can save/edit; all roles can view
  const canEdit = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  // ConfirmDialog state for revert — replaces window.confirm
  const [revertOpen, setRevertOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [wrap, setWrap] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // useRef guard: prevent re-firing deep-link toast on re-render
  const deepLinkApplied = useRef(false);

  const isDirty = content !== originalContent;

  // Strip deep-link ?doc_id= param after mount so Back navigation doesn't re-apply it
  useEffect(() => {
    const docId = searchParams.get('doc_id');
    if (docId) {
      const next = new URLSearchParams(searchParams);
      next.delete('doc_id');
      if (!next.has('fileId')) next.set('fileId', docId);
      setSearchParams(next, { replace: true });
    }
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchContent = useCallback(async () => {
    if (!fileId) { setLoading(false); return; }
    setLoading(true);
    setLoadFailed(false);
    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/uploads/${fileId}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setContent(text);
      setOriginalContent(text);
    } catch (err) {
      setLoadFailed(true);
      addToast(err instanceof Error ? err.message : 'Failed to load file', 'error');
    } finally {
      setLoading(false);
    }
  }, [fileId, addToast]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const save = async () => {
    if (!fileId || saving || !canEdit) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/uploads/${fileId}/content`, {
        method: 'PUT',
        headers,
        body: content,
      });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error || `HTTP ${res.status}`); }
      setOriginalContent(content);
      addToast('Saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRevertConfirm = () => {
    setContent(originalContent);
    setRevertOpen(false);
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Ctrl+S / Cmd+S save (editor-level shortcut — not suppressed inside textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isDirty && canEdit) save(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, canEdit, content]);

  // N shortcut + Esc cascade (capture phase so Esc reaches dialog before textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inEditor = document.activeElement === textareaRef.current;

      // Esc cascade: close revert dialog first, stop propagation so textarea doesn't also handle it
      if (e.key === 'Escape') {
        if (revertOpen) {
          e.stopPropagation();
          setRevertOpen(false);
        }
        return;
      }

      // N shortcut: navigate to Documents when no file is loaded and focus is outside the editor
      if ((e.key === 'n' || e.key === 'N') && !inEditor && !fileId && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        navigate('/documents');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [revertOpen, fileId, navigate]);

  // Tab key inserts \t instead of focusing the next element
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current!;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = content.substring(0, start) + '\t' + content.substring(end);
      setContent(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
    }
  };

  const label = langLabel(mimeType, fileName);
  const lineCount = content.split('\n').length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const findHits = findQuery.trim()
    ? content.toLowerCase().split(findQuery.trim().toLowerCase()).length - 1
    : 0;

  // Empty state: no fileId provided (navigated directly to /text-editor without a file)
  if (!fileId && !loading) {
    return (
      <div className="h-full flex flex-col">
        <PanelTitleBar title="TEXT EDITOR" icon={FileText} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-rmpg-500">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-xs">No document selected.</p>
          <button
            type="button"
            onClick={() => navigate('/documents')}
            className="toolbar-btn"
          >
            Browse Documents
          </button>
          <p className="text-[10px] text-rmpg-600">
            Press <kbd className="px-1 border border-rmpg-600 rounded-sm">N</kbd> to open Documents
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title={`TEXT EDITOR — ${fileName}`} icon={FileText}>
        {loadFailed && (
          <button type="button" onClick={() => { void fetchContent(); }} className="toolbar-btn">
            Retry load
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => { if (isDirty) setRevertOpen(true); }}
            disabled={!isDirty}
            title="Revert to last saved"
            className="toolbar-btn disabled:opacity-40"
          >
            <RotateCcw style={{ width: 10, height: 10 }} /> Revert
          </button>
        )}
        <button type="button" onClick={copyAll} className="toolbar-btn">
          {copied ? <Check style={{ width: 10, height: 10 }} className="text-green-400" /> : <Copy style={{ width: 10, height: 10 }} />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
        {fileId && (
          <a href={authedImageUrl(`/api/uploads/${fileId}/download`)} download={fileName}
            className="toolbar-btn">
            <Download style={{ width: 10, height: 10 }} /> Download
          </a>
        )}
        {canEdit && (
          <button type="button" onClick={save} disabled={!isDirty || saving}
            className="toolbar-btn toolbar-btn-primary disabled:opacity-40">
            {saving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Save style={{ width: 10, height: 10 }} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </PanelTitleBar>

      {/* Sub-toolbar: breadcrumb + metadata */}
      <div className="px-4 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-3 text-[9px] text-rmpg-500">
        <button type="button" onClick={() => navigate(folderId ? '/documents' : '/documents')}
          className="flex items-center gap-1 text-brand-400 hover:text-brand-300">
          <ArrowLeft className="w-3 h-3" /> Documents
        </button>
        <span className="w-px h-3 bg-rmpg-700" />
        <span className="text-rmpg-400">{label}</span>
        <span className="w-px h-3 bg-rmpg-700" />
        <span>{lineCount.toLocaleString()} lines</span>
        <span className="w-px h-3 bg-rmpg-700" />
        <span>{wordCount.toLocaleString()} words</span>
        <span className="w-px h-3 bg-rmpg-700" />
        <span>{content.length.toLocaleString()} chars</span>
        <input
          value={findQuery}
          onChange={(e) => setFindQuery(e.target.value)}
          placeholder="Find…"
          aria-label="Find in document"
          className="ml-auto input-dark text-[10px] h-6 w-36"
        />
        {findQuery.trim() && <span>{findHits} match{findHits === 1 ? '' : 'es'}</span>}
        <label className="flex items-center gap-1 text-[10px]">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Wrap
        </label>
        {isDirty && <span className="ml-1 text-brand-gold-500 font-semibold">● unsaved</span>}
        {!canEdit && <span className="ml-auto text-rmpg-600 italic">view only</span>}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-rmpg-400" />
        </div>
      ) : loadFailed ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-fg-muted" role="alert">
          <p className="text-xs">Failed to load this file. The editor is empty until reload succeeds.</p>
          <button type="button" className="toolbar-btn" onClick={() => { void fetchContent(); }}>Retry</button>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => { if (canEdit) setContent(e.target.value); }}
          onKeyDown={handleKeyDown}
          readOnly={!canEdit}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 resize-none bg-surface-base text-rmpg-100 p-4 font-mono text-[12px] leading-[1.6] outline-none border-none focus:ring-0 tab-scroll"
          style={{ tabSize: 2, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
          placeholder={`${fileName} — ${canEdit ? 'start typing…' : 'read-only'}`}
        />
      )}

      {/* Revert confirm — replaces window.confirm */}
      <ConfirmDialog
        isOpen={revertOpen}
        onClose={() => setRevertOpen(false)}
        onConfirm={handleRevertConfirm}
        title="Discard Changes"
        message="Revert to the last saved version? All unsaved edits will be lost."
        confirmLabel="Discard"
        confirmVariant="warning"
      />
    </div>
  );
}
