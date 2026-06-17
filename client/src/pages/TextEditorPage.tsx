import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Download, FileText, RotateCcw, Copy, Check } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { useToast } from '../components/ToastProvider';
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
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const fileId = params.get('fileId') ?? '';
  const fileName = params.get('name') ?? 'untitled.txt';
  const folderId = params.get('folderId') ?? null;
  const mimeType = params.get('mime') ?? 'text/plain';

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== originalContent;

  const fetchContent = useCallback(async () => {
    if (!fileId) { setLoading(false); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/uploads/${fileId}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setContent(text);
      setOriginalContent(text);
    } catch (err: any) {
      addToast(err.message || 'Failed to load file', 'error');
    }
    setLoading(false);
  }, [fileId, addToast]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  const save = async () => {
    if (!fileId || saving) return;
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
    } catch (err: any) {
      addToast(err.message || 'Save failed', 'error');
    }
    setSaving(false);
  };

  const revert = () => { if (!isDirty) return; if (confirm('Discard unsaved changes?')) setContent(originalContent); };

  const copyAll = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Ctrl+S / Cmd+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isDirty) save(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, content]);

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

  const backTarget = folderId ? `/documents` : `/documents`;
  const label = langLabel(mimeType, fileName);
  const lineCount = content.split('\n').length;

  return (
    <div className="h-full flex flex-col">
      <PanelTitleBar title={`TEXT EDITOR — ${fileName}`} icon={FileText}>
        <button type="button" onClick={revert} disabled={!isDirty} title="Revert to last saved"
          className="toolbar-btn disabled:opacity-40">
          <RotateCcw style={{ width: 10, height: 10 }} /> Revert
        </button>
        <button type="button" onClick={copyAll} className="toolbar-btn">
          {copied ? <Check style={{ width: 10, height: 10 }} className="text-green-400" /> : <Copy style={{ width: 10, height: 10 }} />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <a href={authedImageUrl(`/api/uploads/${fileId}/download`)} download={fileName}
          className="toolbar-btn">
          <Download style={{ width: 10, height: 10 }} /> Download
        </a>
        <button type="button" onClick={save} disabled={!isDirty || saving}
          className="toolbar-btn toolbar-btn-primary disabled:opacity-40">
          {saving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Save style={{ width: 10, height: 10 }} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </PanelTitleBar>

      {/* Sub-toolbar: breadcrumb + metadata */}
      <div className="px-4 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-3 text-[9px] text-rmpg-500">
        <button type="button" onClick={() => navigate(backTarget)}
          className="flex items-center gap-1 text-brand-400 hover:text-brand-300">
          <ArrowLeft className="w-3 h-3" /> Documents
        </button>
        <span className="w-px h-3 bg-rmpg-700" />
        <span className="text-rmpg-400">{label}</span>
        <span className="w-px h-3 bg-rmpg-700" />
        <span>{lineCount.toLocaleString()} lines</span>
        <span className="w-px h-3 bg-rmpg-700" />
        <span>{content.length.toLocaleString()} chars</span>
        {isDirty && <span className="ml-1 text-[#d4a017] font-semibold">● unsaved</span>}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-rmpg-400" />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="flex-1 resize-none bg-surface-base text-rmpg-100 p-4 font-mono text-[12px] leading-[1.6] outline-none border-none focus:ring-0 tab-scroll"
          style={{ tabSize: 2 }}
          placeholder={loading ? '' : `${fileName} — start typing…`}
        />
      )}
    </div>
  );
}
