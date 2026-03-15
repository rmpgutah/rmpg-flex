import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Inbox, Send, Trash2, Archive, RefreshCw, Loader2,
  Search, Reply, ReplyAll, Forward, Paperclip, X, ChevronLeft,
  AlertTriangle, Download, Eye, Flag, MailOpen, Plus,
  Folder, FileText, WifiOff, FolderInput, Bold, Italic, Link,
  Settings2, ChevronDown, ChevronRight as ChevronRightIcon,
  MessageSquare, CheckSquare, Square, CheckCircle, EyeOff,
  FolderPlus, Edit3, Trash, PanelLeftClose, PanelLeftOpen, Image,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useWebSocket } from '../context/WebSocketContext';
import type { EmailMessage, EmailFolder, EmailAttachment } from '../types';

// ─── Well-known folder config ───
const WELL_KNOWN_FOLDERS = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email', 'Archive'];
const FOLDER_ICONS: Record<string, React.ElementType> = {
  Inbox, 'Sent Items': Send, 'Deleted Items': Trash2,
  Drafts: FileText, Archive, 'Junk Email': AlertTriangle,
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (now.getTime() - msgDate.getTime() < 7 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ============================================================
// Snackbar Hook
// ============================================================

function useSnackbar(durationMs = 3000) {
  const [snackbar, setSnackbar] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSnackbar({ text, type });
    timerRef.current = setTimeout(() => setSnackbar(null), durationMs);
  }, [durationMs]);
  const dismiss = useCallback(() => { if (timerRef.current) clearTimeout(timerRef.current); setSnackbar(null); }, []);
  return { snackbar, show, dismiss };
}

// ============================================================
// Signature Editor
// ============================================================

function SignatureEditor({ onClose }: { onClose: () => void }) {
  const [signature, setSignature] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ signature: string }>('/email/signature').then(d => setSignature(d.signature || '')).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch('/email/signature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature }) }); onClose(); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  if (loading) return <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />;

  return (
    <div className="border-t border-border-subtle pt-2 mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider">Email Signature</span>
        <button onClick={onClose} className="text-rmpg-500 hover:text-white"><X className="w-3 h-3" /></button>
      </div>
      <textarea value={signature} onChange={e => setSignature(e.target.value)} rows={4}
        className="input-dark w-full text-xs font-mono resize-y" placeholder="Your Name&#10;Title | Organization&#10;Phone: (555) 123-4567" />
      <div className="flex justify-end gap-1.5">
        <button onClick={onClose} className="btn-secondary text-[10px] px-2 py-0.5">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="btn-primary text-[10px] px-2 py-0.5">{saving ? 'Saving...' : 'Save Signature'}</button>
      </div>
    </div>
  );
}

// ============================================================
// Compose Formatting Helper
// ============================================================

function insertFormat(textarea: HTMLTextAreaElement, prefix: string, suffix: string, placeholder: string) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end) || placeholder;
  const newText = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  nativeInputValueSetter?.call(textarea, newText);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length); }, 0);
}

// ============================================================
// Compose Modal — BCC, Attachments, Inline Images
// ============================================================

interface FileAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // base64
  size: number;
}

interface ComposeModalProps {
  mode: 'new' | 'reply' | 'reply-all' | 'forward';
  replyMessage?: EmailMessage | null;
  onClose: () => void;
  onSent: () => void;
}

function ComposeModal({ mode, replyMessage, onClose, onSent }: ComposeModalProps) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replyMessage) {
      if (mode === 'reply' || mode === 'reply-all') {
        setTo(replyMessage.fromAddress);
        if (mode === 'reply-all') {
          const others = [...replyMessage.toAddresses.map(a => a.email), ...replyMessage.ccAddresses.map(a => a.email)]
            .filter(e => e && e !== replyMessage.fromAddress);
          if ([...new Set(others)].length) setCc([...new Set(others)].join(', '));
        }
        setSubject(`Re: ${replyMessage.subject.replace(/^Re:\s*/i, '')}`);
      } else if (mode === 'forward') {
        setSubject(`Fwd: ${replyMessage.subject.replace(/^Fwd:\s*/i, '')}`);
      }
    }
  }, [mode, replyMessage]);

  useEffect(() => { setTimeout(() => textareaRef.current?.focus(), 100); }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 25 * 1024 * 1024) { setError(`${file.name} exceeds 25MB limit`); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setFileAttachments(prev => [...prev, { name: file.name, contentType: file.type || 'application/octet-stream', contentBytes: base64, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeAttachment = (idx: number) => setFileAttachments(prev => prev.filter((_, i) => i !== idx));

  const handleInlineImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { setError('Image exceeds 25MB limit'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setFileAttachments(prev => [...prev, { name: file.name, contentType: file.type, contentBytes: base64, size: file.size }]);
        // Insert image placeholder in body
        const ta = textareaRef.current;
        if (ta) {
          const pos = ta.selectionStart;
          const before = body.substring(0, pos);
          const after = body.substring(pos);
          setBody(`${before}[image: ${file.name}]${after}`);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleSend = async () => {
    if (!to.trim()) { setError('Recipient is required'); return; }
    if (!subject.trim()) { setError('Subject is required'); return; }
    setSending(true);
    setError('');
    try {
      let endpoint = '/email/send';
      let payload: any = {
        to: to.split(',').map(s => s.trim()),
        subject,
        body,
        attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
      };
      if (mode === 'reply' && replyMessage) { endpoint = `/email/messages/${replyMessage.id}/reply`; payload = { body }; }
      else if (mode === 'reply-all' && replyMessage) { endpoint = `/email/messages/${replyMessage.id}/reply-all`; payload = { body }; }
      else if (mode === 'forward' && replyMessage) { endpoint = `/email/messages/${replyMessage.id}/forward`; payload = { to: to.split(',').map(s => s.trim()), body }; }

      if (cc.trim() && (mode === 'new' || mode === 'forward')) payload.cc = cc.split(',').map((s: string) => s.trim());
      if (bcc.trim() && (mode === 'new' || mode === 'forward')) payload.bcc = bcc.split(',').map((s: string) => s.trim());

      await apiFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      onSent();
      onClose();
    } catch (err: any) { setError(err.message); }
    finally { setSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onKeyDown={handleKeyDown}>
      <div className="bg-surface-base border border-border-subtle rounded w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-brand-400" />
            {mode === 'new' ? 'New Email' : mode === 'reply' ? 'Reply' : mode === 'reply-all' ? 'Reply All' : 'Forward'}
          </h3>
          <button onClick={onClose} className="text-rmpg-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-2 flex-1 overflow-y-auto">
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">{error}</div>}

          <div>
            <label className="text-[10px] text-rmpg-400 block mb-0.5">To</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com, ..." className="input-dark w-full text-xs" />
          </div>

          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <label className="text-[10px] text-rmpg-400">CC</label>
              {!showBcc && (
                <button onClick={() => setShowBcc(true)} className="text-[9px] text-brand-400 hover:text-brand-300 ml-2">+ BCC</button>
              )}
            </div>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="Optional CC recipients" className="input-dark w-full text-xs" />
          </div>

          {showBcc && (
            <div>
              <label className="text-[10px] text-rmpg-400 block mb-0.5">BCC</label>
              <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="Hidden recipients" className="input-dark w-full text-xs" />
            </div>
          )}

          <div>
            <label className="text-[10px] text-rmpg-400 block mb-0.5">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject line" className="input-dark w-full text-xs" />
          </div>

          <div>
            <label className="text-[10px] text-rmpg-400 block mb-0.5">Body</label>
            <div className="flex items-center gap-0.5 mb-1">
              <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '**', '**', 'bold text')}
                className="p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Bold"><Bold className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '*', '*', 'italic text')}
                className="p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Italic"><Italic className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '[', '](https://)', 'link text')}
                className="p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Link"><Link className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Attach file"><Paperclip className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={handleInlineImage}
                className="p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Insert image"><Image className="w-3.5 h-3.5" /></button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              <div className="flex-1" />
              <button type="button" onClick={() => setShowSignatureEditor(!showSignatureEditor)}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-rmpg-500 hover:text-white hover:bg-surface-raised rounded transition-colors" title="Edit signature">
                <Settings2 className="w-3 h-3" /> Signature
              </button>
            </div>
            <textarea ref={textareaRef} value={body} onChange={e => setBody(e.target.value)} rows={10}
              className="input-dark w-full text-xs font-mono resize-y" placeholder="Type your message... (Ctrl+Enter to send)" />
          </div>

          {/* Attachment chips */}
          {fileAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fileAttachments.map((att, idx) => (
                <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-surface-sunken border border-border-subtle rounded text-[10px] text-rmpg-300">
                  <Paperclip className="w-3 h-3 text-rmpg-500" />
                  <span className="truncate max-w-[120px]">{att.name}</span>
                  <span className="text-rmpg-500">{formatSize(att.size)}</span>
                  <button onClick={() => removeAttachment(idx)} className="text-rmpg-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}

          {replyMessage && (mode === 'reply' || mode === 'reply-all') && (
            <div className="text-[10px] text-rmpg-500 bg-surface-sunken border border-border-subtle rounded p-2">
              <span className="text-rmpg-400">Replying to:</span> {replyMessage.fromName || replyMessage.fromAddress}<br />
              <span className="text-rmpg-400">Subject:</span> {replyMessage.subject}<br />
              <span className="text-rmpg-400 italic">Original message will be included automatically by the email server.</span>
            </div>
          )}

          {showSignatureEditor && <SignatureEditor onClose={() => setShowSignatureEditor(false)} />}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle">
          <span className="text-[9px] text-rmpg-600">Signature auto-appended • **bold** *italic* [link](url)</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary text-xs px-3 py-1">Cancel</button>
            <button onClick={handleSend} disabled={sending} className="btn-primary text-xs px-4 py-1 flex items-center gap-1.5">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Move-to-Folder Dropdown
// ============================================================

function MoveToFolderDropdown({ folders, currentFolder, onMove }: { folders: EmailFolder[]; currentFolder: string; onMove: (folderId: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const getFolderKey = (f: EmailFolder) => {
    const map: Record<string, string> = { 'Inbox': 'inbox', 'Sent Items': 'sentitems', 'Deleted Items': 'deleteditems', 'Drafts': 'drafts', 'Junk Email': 'junkemail', 'Archive': 'archive' };
    return map[f.displayName] || f.id;
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="p-1 text-rmpg-500 hover:text-white" title="Move to folder"><FolderInput className="w-3.5 h-3.5" /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-base border border-border-strong rounded shadow-lg py-1 max-h-60 overflow-y-auto">
          {folders.filter(f => getFolderKey(f) !== currentFolder).map(f => {
            const Icon = FOLDER_ICONS[f.displayName] || Folder;
            return (
              <button key={f.id} onClick={() => { onMove(getFolderKey(f)); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white transition-colors">
                <Icon className="w-3 h-3" /> {f.displayName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Right-Click Context Menu
// ============================================================

interface ContextMenuState { x: number; y: number; message: EmailMessage; }

function ContextMenu({
  state, folders, currentFolder,
  onReply, onReplyAll, onForward, onMarkRead, onMarkUnread, onFlag, onArchive, onDelete, onMove, onClose,
}: {
  state: ContextMenuState;
  folders: EmailFolder[];
  currentFolder: string;
  onReply: () => void; onReplyAll: () => void; onForward: () => void;
  onMarkRead: () => void; onMarkUnread: () => void;
  onFlag: () => void; onArchive: () => void; onDelete: () => void;
  onMove: (folderId: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escHandler); };
  }, [onClose]);

  const getFolderKey = (f: EmailFolder) => {
    const map: Record<string, string> = { 'Inbox': 'inbox', 'Sent Items': 'sentitems', 'Deleted Items': 'deleteditems', 'Drafts': 'drafts', 'Junk Email': 'junkemail', 'Archive': 'archive' };
    return map[f.displayName] || f.id;
  };

  const MenuItem = ({ icon: Icon, label, onClick, danger }: { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={() => { onClick(); onClose(); }}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-rmpg-300 hover:bg-brand-500/15 hover:text-white'}`}>
      <Icon className="w-3 h-3" /> {label}
    </button>
  );

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(state.x, window.innerWidth - 200),
    top: Math.min(state.y, window.innerHeight - 350),
    zIndex: 100,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] bg-surface-base border border-border-strong rounded shadow-xl py-1">
      <MenuItem icon={Reply} label="Reply" onClick={onReply} />
      <MenuItem icon={ReplyAll} label="Reply All" onClick={onReplyAll} />
      <MenuItem icon={Forward} label="Forward" onClick={onForward} />
      <div className="border-t border-border-subtle my-1" />
      {state.message.isRead
        ? <MenuItem icon={MailOpen} label="Mark Unread" onClick={onMarkUnread} />
        : <MenuItem icon={Eye} label="Mark Read" onClick={onMarkRead} />
      }
      <MenuItem icon={Flag} label={state.message.isFlagged ? 'Unflag' : 'Flag'} onClick={onFlag} />
      <div className="border-t border-border-subtle my-1" />
      <div className="relative"
        onMouseEnter={() => setShowMoveMenu(true)}
        onMouseLeave={() => setShowMoveMenu(false)}>
        <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white cursor-default">
          <FolderInput className="w-3 h-3" /> Move to <ChevronRightIcon className="w-3 h-3 ml-auto" />
        </div>
        {showMoveMenu && (
          <div className="absolute left-full top-0 min-w-[150px] bg-surface-base border border-border-strong rounded shadow-xl py-1 max-h-60 overflow-y-auto">
            {folders.filter(f => getFolderKey(f) !== currentFolder).map(f => {
              const Icon = FOLDER_ICONS[f.displayName] || Folder;
              return (
                <button key={f.id} onClick={() => { onMove(getFolderKey(f)); onClose(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white transition-colors">
                  <Icon className="w-3 h-3" /> {f.displayName}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <MenuItem icon={Archive} label="Archive" onClick={onArchive} />
      <div className="border-t border-border-subtle my-1" />
      <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
    </div>
  );
}

// ============================================================
// Inline Quick Reply
// ============================================================

function InlineReply({ messageId, onSent }: { messageId: string; onSent: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/email/messages/${messageId}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      setBody(''); setExpanded(false); onSent();
    } catch { /* ignore */ } finally { setSending(false); }
  };

  if (!expanded) {
    return (
      <div onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="mx-4 mb-3 px-3 py-2 border border-border-subtle rounded cursor-text text-xs text-rmpg-500 hover:border-brand-500/40 hover:text-rmpg-300 transition-colors">
        Reply...
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 border border-border-subtle rounded bg-surface-base">
      <textarea ref={inputRef} value={body} onChange={e => setBody(e.target.value)}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); } if (e.key === 'Escape') { setExpanded(false); setBody(''); } }}
        rows={4} className="w-full bg-transparent text-xs text-white p-3 resize-none focus:outline-none placeholder:text-rmpg-500"
        placeholder="Type your reply... (Ctrl+Enter to send, Esc to cancel)" autoFocus />
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border-subtle/50">
        <span className="text-[9px] text-rmpg-600">Signature auto-appended</span>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { setExpanded(false); setBody(''); }} className="text-[10px] text-rmpg-500 hover:text-white px-2 py-0.5">Cancel</button>
          <button onClick={handleSend} disabled={sending || !body.trim()} className="btn-primary text-[10px] px-3 py-0.5 flex items-center gap-1 disabled:opacity-40">
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Thread Group Helper
// ============================================================

interface ThreadGroup { conversationId: string; messages: EmailMessage[]; latest: EmailMessage; }

function groupByConversation(messages: EmailMessage[]): ThreadGroup[] {
  const map = new Map<string, EmailMessage[]>();
  const order: string[] = [];
  for (const msg of messages) {
    const cid = msg.conversationId || msg.id;
    if (!map.has(cid)) { map.set(cid, []); order.push(cid); }
    map.get(cid)!.push(msg);
  }
  return order.map(cid => ({ conversationId: cid, messages: map.get(cid)!, latest: map.get(cid)![0] }));
}

// ============================================================
// Main Email Page
// ============================================================

interface MessagesResponse { messages: EmailMessage[]; hasMore: boolean; }

export default function EmailPage() {
  const { subscribe } = useWebSocket();
  const { snackbar, show: showSnackbar, dismiss: dismissSnackbar } = useSnackbar();

  // Status
  const [status, setStatus] = useState<{ configured: boolean; enabled: boolean; authorized: boolean } | null>(null);

  // Folders
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('inbox');
  const [childFolders, setChildFolders] = useState<Map<string, EmailFolder[]>>(new Map());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderCollapsed, setFolderCollapsed] = useState(() => localStorage.getItem('email_folder_collapsed') === 'true');

  // Folder management
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: EmailFolder } | null>(null);

  // Messages
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  // Selected message
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [fullMessage, setFullMessage] = useState<EmailMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);

  // Search
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compose
  const [composing, setComposing] = useState<'new' | 'reply' | 'reply-all' | 'forward' | null>(null);

  // Mobile
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  // Threading
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Resizable list panel
  const [listWidth, setListWidth] = useState(() => {
    const saved = localStorage.getItem('email_list_width');
    return saved ? Math.max(240, Math.min(500, parseInt(saved, 10))) : 320;
  });
  const resizingRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Debounced folder refresh
  const folderRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFolderRefresh = useCallback(() => {
    if (folderRefreshTimerRef.current) clearTimeout(folderRefreshTimerRef.current);
    folderRefreshTimerRef.current = setTimeout(() => {
      apiFetch<EmailFolder[]>('/email/folders').then(setFolders).catch(() => {});
    }, 500);
  }, []);

  // ─── Data Fetching ───

  const fetchStatus = useCallback(async () => {
    try { const data = await apiFetch<{ configured: boolean; enabled: boolean; authorized: boolean }>('/email/status'); setStatus(data); } catch { /* ignore */ }
  }, []);

  const fetchFolders = useCallback(async () => {
    try { const data = await apiFetch<EmailFolder[]>('/email/folders'); setFolders(data); } catch { /* ignore */ }
  }, []);

  const fetchMessages = useCallback(async (p = 1, folder = selectedFolder, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ folder, page: String(p), per_page: '25' });
      if (q) params.set('search', q);
      const data = await apiFetch<MessagesResponse>(`/email/messages?${params}`);
      if (p === 1) setMessages(data.messages); else setMessages(prev => [...prev, ...data.messages]);
      setHasMore(data.hasMore || false);
      setPage(p);
    } catch (err) { console.error('Failed to fetch emails:', err); } finally { setLoading(false); }
  }, [selectedFolder, search]);

  const fetchFullMessage = useCallback(async (id: string) => {
    setLoadingMessage(true);
    try {
      const msg = await apiFetch<EmailMessage>(`/email/messages/${id}`);
      setFullMessage(msg);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, isRead: true } : m));
      try { const atts = await apiFetch<EmailAttachment[]>(`/email/messages/${id}/attachments`); setAttachments(atts); }
      catch { setAttachments([]); }
    } catch { } finally { setLoadingMessage(false); }
  }, []);

  const fetchChildFolders = useCallback(async (parentId: string) => {
    try {
      const children = await apiFetch<EmailFolder[]>(`/email/folders/${parentId}/children`);
      setChildFolders(prev => new Map(prev).set(parentId, children));
    } catch { /* ignore */ }
  }, []);

  // ─── Effects ───

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    if (status?.authorized) { fetchFolders(); fetchMessages(1); }
  }, [status?.authorized]); // eslint-disable-line

  useEffect(() => {
    const unsub = subscribe('email:new_messages', () => {
      if (selectedFolder === 'inbox') fetchMessages(1);
      fetchFolders();
    });
    return unsub;
  }, [subscribe, selectedFolder, fetchMessages, fetchFolders]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      if (searchInput !== search) { setSearch(searchInput); setPage(1); fetchMessages(1, selectedFolder, searchInput); }
    }, 500);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchInput]); // eslint-disable-line

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'n') { e.preventDefault(); setComposing('new'); return; }
      if (mod && e.shiftKey && e.key === 'R') { e.preventDefault(); if (fullMessage) setComposing('reply-all'); return; }
      if (mod && e.key === 'r') { e.preventDefault(); if (fullMessage) setComposing('reply'); return; }
      if (mod && e.key === 'f') { e.preventDefault(); if (fullMessage) setComposing('forward'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedMessage) { e.preventDefault(); handleDelete(selectedMessage); } return; }
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return; }
        if (composing) { setComposing(null); return; }
        if (fullMessage) { setSelectedMessage(null); setFullMessage(null); setMobileView('list'); return; }
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = selectedMessage ? messages.findIndex(m => m.id === selectedMessage.id) : -1;
        const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (next >= 0 && next < messages.length) handleSelectMessage(messages[next]);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedMessage, fullMessage, composing, messages, contextMenu]); // eslint-disable-line

  // Resize handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const folderWidth = folderCollapsed ? 48 : 192;
      setListWidth(Math.max(240, Math.min(500, e.clientX - folderWidth)));
    };
    const handleMouseUp = () => {
      if (resizingRef.current) { resizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; localStorage.setItem('email_list_width', String(listWidth)); }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, [listWidth, folderCollapsed]);

  // iframe auto-resize
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try { const doc = iframe.contentDocument; if (doc?.body) iframe.style.height = `${Math.max(200, doc.body.scrollHeight + 32)}px`; } catch { /* cross-origin */ }
  }, []);

  // Auto-advance
  const autoAdvance = useCallback((removedId: string, currentMessages: EmailMessage[]) => {
    const idx = currentMessages.findIndex(m => m.id === removedId);
    const remaining = currentMessages.filter(m => m.id !== removedId);
    if (remaining.length === 0) { setSelectedMessage(null); setFullMessage(null); setMobileView('list'); return; }
    const next = remaining[Math.min(idx, remaining.length - 1)];
    setSelectedMessage(next); fetchFullMessage(next.id);
  }, [fetchFullMessage]);

  // ─── Handlers ───

  const handleSelectFolder = (folderId: string) => {
    setSelectedFolder(folderId); setSelectedMessage(null); setFullMessage(null); setSelectedIds(new Set()); setPage(1);
    fetchMessages(1, folderId, search);
  };

  const handleSelectMessage = (msg: EmailMessage) => {
    setSelectedMessage(msg); setMobileView('detail'); fetchFullMessage(msg.id);
  };

  const handleClearSearch = () => { setSearchInput(''); setSearch(''); setPage(1); fetchMessages(1, selectedFolder, ''); };
  const handleRefresh = () => { fetchFolders(); fetchMessages(1, selectedFolder, search); };

  const handleToggleRead = async (msg: EmailMessage) => {
    try {
      await apiFetch(`/email/messages/${msg.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isRead: !msg.isRead }) });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isRead: !msg.isRead } : m));
      showSnackbar(msg.isRead ? 'Marked as unread' : 'Marked as read');
      debouncedFolderRefresh();
    } catch { showSnackbar('Failed to update', 'error'); }
  };

  const handleToggleFlag = async (msg: EmailMessage) => {
    try {
      await apiFetch(`/email/messages/${msg.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isFlagged: !msg.isFlagged }) });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isFlagged: !msg.isFlagged } : m));
      showSnackbar(msg.isFlagged ? 'Flag removed' : 'Flagged');
    } catch { showSnackbar('Failed to update', 'error'); }
  };

  const handleDelete = async (msg: EmailMessage) => {
    const shouldAdvance = selectedMessage?.id === msg.id;
    try {
      await apiFetch(`/email/messages/${msg.id}`, { method: 'DELETE' });
      if (shouldAdvance) autoAdvance(msg.id, messages); else { setSelectedMessage(null); setFullMessage(null); }
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(msg.id); return n; });
      showSnackbar('Moved to trash'); debouncedFolderRefresh();
    } catch { showSnackbar('Failed to delete', 'error'); }
  };

  const handleArchive = async (msg: EmailMessage) => {
    const shouldAdvance = selectedMessage?.id === msg.id;
    try {
      await apiFetch(`/email/messages/${msg.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: 'archive' }) });
      if (shouldAdvance) autoAdvance(msg.id, messages); else { setSelectedMessage(null); setFullMessage(null); }
      setMessages(prev => prev.filter(m => m.id !== msg.id));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(msg.id); return n; });
      showSnackbar('Archived'); debouncedFolderRefresh();
    } catch { showSnackbar('Failed to archive', 'error'); }
  };

  const handleMoveToFolder = async (folderId: string, msg?: EmailMessage) => {
    const target = msg || selectedMessage;
    if (!target) return;
    try {
      await apiFetch(`/email/messages/${target.id}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId }) });
      if (selectedMessage?.id === target.id) autoAdvance(target.id, messages);
      setMessages(prev => prev.filter(m => m.id !== target.id));
      showSnackbar('Moved to folder'); debouncedFolderRefresh();
    } catch { showSnackbar('Failed to move', 'error'); }
  };

  const toggleThread = (conversationId: string) => {
    setExpandedThreads(prev => { const next = new Set(prev); if (next.has(conversationId)) next.delete(conversationId); else next.add(conversationId); return next; });
  };

  // Bulk handlers
  const toggleSelectId = (id: string) => { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const selectAll = () => { setSelectedIds(selectedIds.size === messages.length ? new Set() : new Set(messages.map(m => m.id))); };

  const handleBatchAction = async (action: 'delete' | 'archive' | 'markRead' | 'markUnread') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await apiFetch('/email/messages/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids }) });
      if (action === 'delete' || action === 'archive') {
        if (selectedMessage && selectedIds.has(selectedMessage.id)) {
          const remaining = messages.filter(m => !selectedIds.has(m.id));
          if (remaining.length > 0) handleSelectMessage(remaining[0]); else { setSelectedMessage(null); setFullMessage(null); setMobileView('list'); }
        }
        setMessages(prev => prev.filter(m => !selectedIds.has(m.id)));
      } else {
        const isRead = action === 'markRead';
        setMessages(prev => prev.map(m => selectedIds.has(m.id) ? { ...m, isRead } : m));
      }
      setSelectedIds(new Set());
      const label = action === 'delete' ? 'Deleted' : action === 'archive' ? 'Archived' : action === 'markRead' ? 'Marked as read' : 'Marked as unread';
      showSnackbar(`${label} ${ids.length} message${ids.length > 1 ? 's' : ''}`);
      debouncedFolderRefresh();
    } catch { showSnackbar(`Batch ${action} failed`, 'error'); }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/email/messages/mark-all-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: selectedFolder }) });
      setMessages(prev => prev.map(m => ({ ...m, isRead: true }))); showSnackbar('All messages marked as read'); debouncedFolderRefresh();
    } catch { showSnackbar('Failed to mark all as read', 'error'); }
  };

  // Folder management
  const handleCreateFolder = async (parentId?: string) => {
    if (!newFolderName.trim()) return;
    try {
      await apiFetch('/email/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: newFolderName.trim(), parentFolderId: parentId }) });
      setNewFolderName(''); setShowNewFolder(false); fetchFolders();
      if (parentId) fetchChildFolders(parentId);
      showSnackbar('Folder created');
    } catch { showSnackbar('Failed to create folder', 'error'); }
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!renameValue.trim()) return;
    try {
      await apiFetch(`/email/folders/${folderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: renameValue.trim() }) });
      setRenamingFolder(null); setRenameValue(''); fetchFolders();
      showSnackbar('Folder renamed');
    } catch { showSnackbar('Failed to rename folder', 'error'); }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await apiFetch(`/email/folders/${folderId}`, { method: 'DELETE' });
      fetchFolders(); showSnackbar('Folder deleted');
    } catch { showSnackbar('Failed to delete folder', 'error'); }
  };

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) { next.delete(folderId); } else { next.add(folderId); if (!childFolders.has(folderId)) fetchChildFolders(folderId); }
      return next;
    });
  };

  const toggleFolderCollapse = () => {
    const next = !folderCollapsed;
    setFolderCollapsed(next);
    localStorage.setItem('email_folder_collapsed', String(next));
  };

  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, msg: EmailMessage) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
  };

  // ─── Not Configured ───

  if (status && !status.configured) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-md">
          <WifiOff className="w-12 h-12 text-rmpg-500 mx-auto" />
          <h2 className="text-sm font-semibold text-white">Email Not Configured</h2>
          <p className="text-xs text-rmpg-400">Microsoft email integration needs to be set up by an administrator. Go to Admin → Integrations → Microsoft Email to configure.</p>
        </div>
      </div>
    );
  }

  if (status && !status.authorized) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="w-12 h-12 text-yellow-400/60 mx-auto" />
          <h2 className="text-sm font-semibold text-white">Authorization Required</h2>
          <p className="text-xs text-rmpg-400">An administrator needs to authorize the Microsoft email connection. Go to Admin → Integrations → Microsoft Email to complete authorization.</p>
        </div>
      </div>
    );
  }

  // ─── Folder helpers ───
  const getFolderKey = (f: EmailFolder) => {
    const map: Record<string, string> = { 'Inbox': 'inbox', 'Sent Items': 'sentitems', 'Deleted Items': 'deleteditems', 'Drafts': 'drafts', 'Junk Email': 'junkemail', 'Archive': 'archive' };
    return map[f.displayName] || f.id;
  };

  // Sort folders: well-known first, then custom alphabetically
  const sortedFolders = [...folders].sort((a, b) => {
    const aIdx = WELL_KNOWN_FOLDERS.indexOf(a.displayName);
    const bIdx = WELL_KNOWN_FOLDERS.indexOf(b.displayName);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  // Top-level folders only (no parentFolderId, or parentFolderId points to root)
  const topLevelFolders = sortedFolders.filter(f => !f.parentFolderId || WELL_KNOWN_FOLDERS.includes(f.displayName));

  const threads = groupByConversation(messages);
  const unreadCount = messages.filter(m => !m.isRead).length;
  const isWellKnown = (name: string) => WELL_KNOWN_FOLDERS.includes(name);

  // Total unread across all folders
  const totalUnread = folders.reduce((sum, f) => sum + (f.unreadItemCount || 0), 0);

  // ─── Render folder item ───
  const renderFolderItem = (f: EmailFolder, depth = 0) => {
    const key = getFolderKey(f);
    const Icon = FOLDER_ICONS[f.displayName] || Folder;
    const isActive = selectedFolder === key;
    const hasChildren = (f.childFolderCount || 0) > 0;
    const isExpanded = expandedFolders.has(f.id);
    const children = childFolders.get(f.id) || [];

    return (
      <div key={f.id}>
        <div
          className={`group w-full flex items-center gap-1.5 py-1.5 text-xs transition-colors cursor-pointer ${
            isActive ? 'bg-brand-500/15 text-brand-400 border-l-2 border-brand-500' : 'text-rmpg-300 hover:bg-surface-base hover:text-white border-l-2 border-transparent'
          }`}
          style={{ paddingLeft: folderCollapsed ? 12 : 12 + depth * 16 }}
          onClick={() => handleSelectFolder(key)}
          onContextMenu={(e) => {
            if (!isWellKnown(f.displayName)) {
              e.preventDefault();
              setFolderContextMenu({ x: e.clientX, y: e.clientY, folder: f });
            }
          }}
          onDoubleClick={() => {
            if (!isWellKnown(f.displayName)) { setRenamingFolder(f.id); setRenameValue(f.displayName); }
          }}
        >
          {hasChildren && !folderCollapsed ? (
            <button onClick={e => { e.stopPropagation(); toggleFolderExpand(f.id); }} className="p-0.5 -ml-0.5 text-rmpg-500 hover:text-white">
              {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRightIcon className="w-2.5 h-2.5" />}
            </button>
          ) : !folderCollapsed ? <div className="w-3.5" /> : null}

          <Icon className="w-3.5 h-3.5 flex-shrink-0" />

          {!folderCollapsed && (
            renamingFolder === f.id ? (
              <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(f.id); if (e.key === 'Escape') { setRenamingFolder(null); setRenameValue(''); } }}
                onBlur={() => { setRenamingFolder(null); setRenameValue(''); }}
                className="flex-1 bg-transparent text-xs text-white border-b border-brand-500 outline-none" autoFocus
                onClick={e => e.stopPropagation()} />
            ) : (
              <span className="flex-1 text-left truncate">{f.displayName}</span>
            )
          )}

          {f.unreadItemCount > 0 && (
            <span className={`text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 rounded-full ${folderCollapsed ? 'absolute top-0 right-0 mt-0.5 mr-0.5' : ''}`}>
              {f.unreadItemCount}
            </span>
          )}
        </div>

        {/* Child folders */}
        {hasChildren && isExpanded && !folderCollapsed && children.map(child => renderFolderItem(child, depth + 1))}
      </div>
    );
  };

  // ─── Render ───

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Folder Panel ─── */}
      <div className={`flex-shrink-0 border-r border-border-subtle bg-surface-sunken hidden md:flex flex-col transition-all ${folderCollapsed ? 'w-12' : 'w-48'}`}>
        {/* Collapse toggle + compose */}
        <div className="px-2 py-2 border-b border-border-subtle flex items-center gap-1">
          <button onClick={toggleFolderCollapse} className="p-1 text-rmpg-500 hover:text-white" title={folderCollapsed ? 'Expand folders' : 'Collapse folders'}>
            {folderCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
          {!folderCollapsed && (
            <button onClick={() => setComposing('new')} className="btn-primary flex-1 text-xs py-1.5 flex items-center justify-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Compose
            </button>
          )}
          {folderCollapsed && (
            <button onClick={() => setComposing('new')} className="p-1 text-brand-400 hover:text-brand-300" title="Compose">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Total unread badge (collapsed mode) */}
        {folderCollapsed && totalUnread > 0 && (
          <div className="text-center py-1 text-[9px] font-bold text-brand-400">{totalUnread}</div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto py-1">
          {topLevelFolders.map(f => renderFolderItem(f))}
        </div>

        {/* New folder button */}
        {!folderCollapsed && (
          <div className="px-2 py-1.5 border-t border-border-subtle">
            {showNewFolder ? (
              <div className="flex items-center gap-1">
                <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
                  className="flex-1 input-dark text-[10px] px-2 py-0.5" placeholder="Folder name" autoFocus />
                <button onClick={() => handleCreateFolder()} className="p-0.5 text-brand-400 hover:text-brand-300"><CheckCircle className="w-3.5 h-3.5" /></button>
                <button onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-0.5 text-rmpg-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setShowNewFolder(true)}
                className="w-full flex items-center gap-1.5 text-[10px] text-rmpg-500 hover:text-white transition-colors py-0.5">
                <FolderPlus className="w-3 h-3" /> New Folder
              </button>
            )}
          </div>
        )}

        {/* Keyboard shortcuts hint */}
        {!folderCollapsed && (
          <div className="px-3 py-2 border-t border-border-subtle text-[8px] text-rmpg-600 space-y-0.5">
            <div>Ctrl+N New • Ctrl+R Reply</div>
            <div>Ctrl+F Forward • ↑↓ Navigate</div>
          </div>
        )}
      </div>

      {/* ─── Folder context menu ─── */}
      {folderContextMenu && (
        <div className="fixed z-[100]" style={{ left: folderContextMenu.x, top: folderContextMenu.y }}>
          <div className="min-w-[140px] bg-surface-base border border-border-strong rounded shadow-xl py-1"
            ref={el => {
              if (el) {
                const handler = (e: MouseEvent) => { if (!el.contains(e.target as Node)) setFolderContextMenu(null); };
                document.addEventListener('mousedown', handler, { once: true });
              }
            }}>
            <button onClick={() => { setRenamingFolder(folderContextMenu.folder.id); setRenameValue(folderContextMenu.folder.displayName); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white"><Edit3 className="w-3 h-3" /> Rename</button>
            <button onClick={() => { setShowNewFolder(true); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white"><FolderPlus className="w-3 h-3" /> New Subfolder</button>
            <div className="border-t border-border-subtle my-1" />
            <button onClick={() => { handleDeleteFolder(folderContextMenu.folder.id); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"><Trash className="w-3 h-3" /> Delete</button>
          </div>
        </div>
      )}

      {/* ─── Message List Panel ─── */}
      <div className={`flex-shrink-0 border-r border-border-subtle flex flex-col ${mobileView === 'detail' ? 'hidden md:flex' : 'flex'} md:flex`}
        style={{ width: listWidth, minWidth: 240 }}>

        {/* Snackbar */}
        {snackbar && (
          <div className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b ${
            snackbar.type === 'success' ? 'bg-green-900/20 border-green-800/40 text-green-400' : 'bg-red-900/20 border-red-800/40 text-red-400'
          }`}>
            {snackbar.type === 'success' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span className="flex-1">{snackbar.text}</span>
            <button onClick={dismissSnackbar} className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Batch action bar OR Search bar */}
        {selectedIds.size > 0 ? (
          <div className="px-2 py-1.5 border-b border-border-subtle flex items-center gap-1 bg-brand-500/5">
            <button onClick={selectAll} className="p-1 text-brand-400 hover:text-brand-300" title="Toggle select all">
              {selectedIds.size === messages.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <span className="text-[10px] text-brand-400 font-medium">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button onClick={() => handleBatchAction('archive')} className="p-1 text-rmpg-400 hover:text-white" title="Archive"><Archive className="w-3.5 h-3.5" /></button>
            <button onClick={() => handleBatchAction('markRead')} className="p-1 text-rmpg-400 hover:text-white" title="Mark read"><Eye className="w-3.5 h-3.5" /></button>
            <button onClick={() => handleBatchAction('markUnread')} className="p-1 text-rmpg-400 hover:text-white" title="Mark unread"><EyeOff className="w-3.5 h-3.5" /></button>
            <button onClick={() => handleBatchAction('delete')} className="p-1 text-rmpg-400 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={() => setSelectedIds(new Set())} className="p-1 text-rmpg-500 hover:text-white" title="Clear selection"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <div className="px-2 py-1.5 border-b border-border-subtle flex items-center gap-1.5">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search emails..."
                className="input-dark w-full text-[11px] pl-7 pr-7 py-1" />
              {searchInput && (
                <button onClick={handleClearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white"><X className="w-3 h-3" /></button>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="p-1 text-rmpg-500 hover:text-white rounded" title="Mark all as read"><Eye className="w-3.5 h-3.5" /></button>
            )}
            <button onClick={handleRefresh} className="p-1 text-rmpg-500 hover:text-white rounded" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setComposing('new')} className="p-1 text-brand-400 hover:text-brand-300 rounded md:hidden" title="Compose"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        )}

        {/* Message List (threaded) */}
        <div className="flex-1 overflow-y-auto">
          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-rmpg-500 text-xs">
              <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
              {search ? (<><div>No results for &ldquo;{search}&rdquo;</div><button onClick={handleClearSearch} className="text-brand-400 hover:text-brand-300 mt-1">Clear search</button></>) : 'No messages'}
            </div>
          ) : (
            <>
              {threads.map(thread => {
                const isMulti = thread.messages.length > 1;
                const isExpanded = expandedThreads.has(thread.conversationId);
                const displayMessages = isMulti && !isExpanded ? [thread.latest] : thread.messages;

                return (
                  <div key={thread.conversationId}>
                    {isMulti && (
                      <button onClick={() => toggleThread(thread.conversationId)}
                        className="w-full flex items-center gap-1 px-3 py-0.5 text-[9px] text-rmpg-500 hover:text-rmpg-300 bg-surface-sunken/50 border-b border-border-subtle/30">
                        {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRightIcon className="w-2.5 h-2.5" />}
                        <MessageSquare className="w-2.5 h-2.5" /><span>{thread.messages.length} messages in thread</span>
                      </button>
                    )}

                    {displayMessages.map(msg => (
                      <div key={msg.id}
                        className={`group relative px-3 py-2 cursor-pointer border-b border-border-subtle/50 transition-colors ${
                          selectedMessage?.id === msg.id ? 'bg-brand-500/10 border-l-2 border-l-brand-500' : 'hover:bg-surface-base border-l-2 border-l-transparent'
                        } ${isMulti && isExpanded && msg !== thread.latest ? 'pl-6' : ''}`}
                        onContextMenu={e => handleContextMenu(e, msg)}>
                        <div className="flex items-start gap-1.5">
                          <button onClick={e => { e.stopPropagation(); toggleSelectId(msg.id); }}
                            className={`mt-0.5 flex-shrink-0 transition-opacity ${
                              selectedIds.has(msg.id) ? 'opacity-100 text-brand-400' : 'opacity-0 group-hover:opacity-60 text-rmpg-500 hover:text-white'
                            }`}>
                            {selectedIds.has(msg.id) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                          </button>

                          <div className="flex-1 min-w-0" onClick={() => handleSelectMessage(msg)}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {!msg.isRead && <div className="w-1.5 h-1.5 rounded-full bg-brand-400 flex-shrink-0" />}
                              <span className={`text-[11px] truncate flex-1 ${msg.isRead ? 'text-rmpg-300' : 'text-white font-semibold'}`}>{msg.fromName || msg.fromAddress}</span>
                              {isMulti && !isExpanded && <span className="text-[8px] bg-rmpg-700 text-rmpg-300 px-1 rounded font-mono">{thread.messages.length}</span>}
                              <span className="text-[9px] text-rmpg-500 flex-shrink-0">{formatDate(msg.receivedAt)}</span>
                            </div>
                            <div className={`text-[11px] truncate ${msg.isRead ? 'text-rmpg-400' : 'text-rmpg-200'}`}>{msg.subject}</div>
                            <div className="text-[10px] text-rmpg-500 truncate mt-0.5">{msg.bodyPreview}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {msg.hasAttachments && <Paperclip className="w-2.5 h-2.5 text-rmpg-500" />}
                              {msg.isFlagged && <Flag className="w-2.5 h-2.5 text-yellow-400" />}
                              {msg.importance === 'high' && <AlertTriangle className="w-2.5 h-2.5 text-red-400" />}
                            </div>
                          </div>

                          {/* Hover quick actions */}
                          <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={e => { e.stopPropagation(); handleArchive(msg); }} className="p-0.5 text-rmpg-500 hover:text-white" title="Archive"><Archive className="w-3 h-3" /></button>
                            <button onClick={e => { e.stopPropagation(); handleToggleRead(msg); }} className="p-0.5 text-rmpg-500 hover:text-white" title={msg.isRead ? 'Mark unread' : 'Mark read'}>
                              {msg.isRead ? <MailOpen className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleDelete(msg); }} className="p-0.5 text-rmpg-500 hover:text-red-400" title="Delete"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {hasMore && (
                <button onClick={() => fetchMessages(page + 1, selectedFolder, search)} className="w-full py-2 text-[10px] text-brand-400 hover:text-brand-300">Load more...</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Resize Handle ─── */}
      <div className="w-1 flex-shrink-0 cursor-col-resize hover:bg-brand-500/30 active:bg-brand-500/50 transition-colors hidden md:block"
        onMouseDown={() => { resizingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }} />

      {/* ─── Reading Pane ─── */}
      <div className={`flex-1 flex flex-col bg-surface-sunken overflow-hidden ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {fullMessage ? (
          <>
            {/* Message Header */}
            <div className="px-4 py-3 border-b border-border-subtle bg-surface-base space-y-2">
              <div className="flex items-center gap-2">
                <button onClick={() => { setSelectedMessage(null); setFullMessage(null); setMobileView('list'); }} className="md:hidden p-1 text-rmpg-400 hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
                <h2 className="text-sm font-semibold text-white flex-1 truncate">{fullMessage.subject}</h2>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <div className="w-7 h-7 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 font-bold text-[10px] flex-shrink-0">
                  {(fullMessage.fromName || fullMessage.fromAddress).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium">{fullMessage.fromName || fullMessage.fromAddress}</div>
                  <div className="text-rmpg-500 text-[10px]">&lt;{fullMessage.fromAddress}&gt; • {new Date(fullMessage.receivedAt).toLocaleString()}</div>
                  {fullMessage.toAddresses.length > 0 && <div className="text-rmpg-500 text-[10px] truncate">To: {fullMessage.toAddresses.map(a => a.name || a.email).join(', ')}</div>}
                  {fullMessage.ccAddresses.length > 0 && <div className="text-rmpg-500 text-[10px] truncate">CC: {fullMessage.ccAddresses.map(a => a.name || a.email).join(', ')}</div>}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                <button onClick={() => setComposing('reply')} className="btn-secondary text-[10px] px-2 py-0.5 flex items-center gap-1"><Reply className="w-3 h-3" /> Reply</button>
                <button onClick={() => setComposing('reply-all')} className="btn-secondary text-[10px] px-2 py-0.5 flex items-center gap-1"><ReplyAll className="w-3 h-3" /> Reply All</button>
                <button onClick={() => setComposing('forward')} className="btn-secondary text-[10px] px-2 py-0.5 flex items-center gap-1"><Forward className="w-3 h-3" /> Forward</button>
                <button onClick={() => selectedMessage && handleArchive(selectedMessage)} className="btn-secondary text-[10px] px-2 py-0.5 flex items-center gap-1" title="Archive"><Archive className="w-3 h-3" /> Archive</button>
                <div className="flex-1" />
                <MoveToFolderDropdown folders={folders} currentFolder={selectedFolder} onMove={handleMoveToFolder} />
                <button onClick={() => selectedMessage && handleToggleRead(selectedMessage)} className="p-1 text-rmpg-500 hover:text-white" title="Toggle read">
                  {selectedMessage?.isRead ? <MailOpen className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => selectedMessage && handleToggleFlag(selectedMessage)} className="p-1 text-rmpg-500 hover:text-yellow-400" title="Toggle flag">
                  <Flag className={`w-3.5 h-3.5 ${selectedMessage?.isFlagged ? 'text-yellow-400 fill-yellow-400' : ''}`} />
                </button>
                <button onClick={() => selectedMessage && handleDelete(selectedMessage)} className="p-1 text-rmpg-500 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {attachments.filter(a => !a.isInline).map(att => (
                    <a key={att.id} href={`/api/email/messages/${selectedMessage!.id}/attachments/${att.id}`} target="_blank" rel="noopener"
                      className="flex items-center gap-1.5 px-2 py-1 bg-surface-sunken border border-border-subtle rounded text-[10px] text-rmpg-300 hover:text-white hover:border-brand-500/40 transition-colors">
                      <Paperclip className="w-3 h-3 text-rmpg-500" />
                      <span className="truncate max-w-[150px]">{att.name}</span>
                      <span className="text-rmpg-500">{formatSize(att.size)}</span>
                      <Download className="w-3 h-3 text-rmpg-500" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Message Body */}
            <div className="flex-1 overflow-auto">
              {loadingMessage ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
              ) : fullMessage.bodyHtml ? (
                <iframe ref={iframeRef} onLoad={handleIframeLoad}
                  srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                    body { font-family: Segoe UI, Arial, sans-serif; font-size: 13px; color: #c0d0e0; background: #0d1520; margin: 16px; line-height: 1.6; word-wrap: break-word; }
                    a { color: #3b82f6; } img { max-width: 100%; height: auto; } table { border-collapse: collapse; max-width: 100%; }
                    td, th { padding: 4px 8px; } blockquote { border-left: 3px solid #1e3048; margin: 8px 0; padding: 4px 12px; color: #8899aa; }
                    pre { background: #141e2b; padding: 8px; border-radius: 2px; overflow-x: auto; } hr { border: none; border-top: 1px solid #1e3048; margin: 16px 0; }
                  </style></head><body>${fullMessage.bodyHtml}</body></html>`}
                  sandbox="allow-same-origin" className="w-full border-0" style={{ minHeight: 200 }} title="Email body" />
              ) : (
                <div className="p-4 text-xs text-rmpg-400 whitespace-pre-wrap font-mono">{fullMessage.bodyPreview}</div>
              )}
            </div>

            {/* Inline Quick Reply */}
            <InlineReply messageId={fullMessage.id} onSent={() => { showSnackbar('Reply sent'); handleRefresh(); }} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <Mail className="w-10 h-10 text-rmpg-600 mx-auto" />
              <p className="text-xs text-rmpg-500">Select an email to read</p>
              <p className="text-[9px] text-rmpg-600">Ctrl+N to compose • ↑↓ to navigate • Right-click for options</p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          folders={folders}
          currentFolder={selectedFolder}
          onReply={() => { setSelectedMessage(contextMenu.message); fetchFullMessage(contextMenu.message.id); setComposing('reply'); }}
          onReplyAll={() => { setSelectedMessage(contextMenu.message); fetchFullMessage(contextMenu.message.id); setComposing('reply-all'); }}
          onForward={() => { setSelectedMessage(contextMenu.message); fetchFullMessage(contextMenu.message.id); setComposing('forward'); }}
          onMarkRead={() => handleToggleRead({ ...contextMenu.message, isRead: false })}
          onMarkUnread={() => handleToggleRead({ ...contextMenu.message, isRead: true })}
          onFlag={() => handleToggleFlag(contextMenu.message)}
          onArchive={() => handleArchive(contextMenu.message)}
          onDelete={() => handleDelete(contextMenu.message)}
          onMove={(folderId) => handleMoveToFolder(folderId, contextMenu.message)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ─── Compose Modal ─── */}
      {composing && (
        <ComposeModal
          mode={composing}
          replyMessage={fullMessage || selectedMessage}
          onClose={() => setComposing(null)}
          onSent={() => { showSnackbar('Email sent'); handleRefresh(); }}
        />
      )}
    </div>
  );
}
