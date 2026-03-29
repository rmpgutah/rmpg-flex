import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mail, Inbox, Send, Trash2, Archive, RefreshCw, Loader2,
  Search, Reply, ReplyAll, Forward, Paperclip, X, ChevronLeft,
  AlertTriangle, Download, Eye, Flag, MailOpen, Plus,
  Folder, FileText, WifiOff, FolderInput, Bold, Italic, Link,
  Settings2, ChevronDown, ChevronRight as ChevronRightIcon,
  MessageSquare, CheckSquare, Square, CheckCircle, EyeOff,
  FolderPlus, Edit3, Trash, PanelLeftClose, PanelLeftOpen, Image,
  Clock, FileStack, Users, Printer, Bell, BellOff,
  Link2, Unlink, CalendarClock, Filter, SlidersHorizontal,
  ExternalLink, Shield, Hash, Upload,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useWebSocket } from '../context/WebSocketContext';
import { useLiveSync } from '../hooks/useLiveSync';
import type { EmailMessage, EmailFolder, EmailAttachment } from '../types';
import { useToast } from '../components/ToastProvider';
import { localToday, dateToLocalYMD } from '../utils/dateUtils';

// ─── Well-known folder config ───
const WELL_KNOWN_FOLDERS = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email', 'Archive'];
const FOLDER_ICONS: Record<string, React.ElementType> = {
  Inbox, 'Sent Items': Send, 'Deleted Items': Trash2,
  Drafts: FileText, Archive, 'Junk Email': AlertTriangle,
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
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
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
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
    let cancelled = false;
    apiFetch<{ signature: string }>('/email/signature')
      .then(d => { if (!cancelled) setSignature(d.signature || ''); })
      .catch((err) => { console.warn('[EmailPage] fetch signature failed:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch('/email/signature', { method: 'PUT', body: JSON.stringify({ signature }) }); onClose(); }
    catch (err) { console.warn('[EmailPage] save signature failed:', err); } finally { setSaving(false); }
  };

  if (loading) return <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" role="status" aria-label="Loading" />;

  return (
    <div className="border-t border-border-subtle pt-2 mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider" style={{ letterSpacing: '0.1em' }}>Email Signature</span>
        <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close"><X className="w-3 h-3" /></button>
      </div>
      <textarea value={signature} onChange={e => setSignature(e.target.value)} rows={4}
        className="input-dark w-full text-xs font-mono resize-y min-h-[36px]" placeholder="Your Name&#10;Title | Organization&#10;Phone: (555) 123-4567" />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onClose} className="btn-secondary text-[10px] px-2 py-0.5">Cancel</button>
        <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-[10px] px-2 py-0.5">{saving ? 'Saving...' : 'Save Signature'}</button>
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
// Contact Autocomplete Input
// ============================================================

interface ContactSuggestion {
  email: string;
  name: string;
  source: string;
}

function ContactAutocompleteInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback((query: string) => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    if (query.length < 2) { setSuggestions([]); return; }
    fetchTimerRef.current = setTimeout(async () => {
      try {
        const data = await apiFetch<ContactSuggestion[]>(`/email/contacts/search?q=${encodeURIComponent(query)}`);
        setSuggestions(data || []);
        setShowSuggestions(true);
        setActiveIdx(-1);
      } catch { setSuggestions([]); }
    }, 250);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    // Extract the current token being typed (after last comma)
    const lastComma = val.lastIndexOf(',');
    const currentToken = val.substring(lastComma + 1).trim();
    fetchSuggestions(currentToken);
  };

  const selectSuggestion = (contact: ContactSuggestion) => {
    const lastComma = value.lastIndexOf(',');
    const prefix = lastComma >= 0 ? value.substring(0, lastComma + 1) + ' ' : '';
    const formatted = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
    onChange(prefix + formatted + ', ');
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(prev => Math.min(prev + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(prev => Math.max(prev - 1, 0)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectSuggestion(suggestions[activeIdx]); }
    else if (e.key === 'Escape') { setShowSuggestions(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="text-[10px] text-rmpg-400 block mb-0.5">{label}</label>}
      <input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="input-dark w-full text-xs min-h-[36px]"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-base border border-border-strong rounded-sm shadow-lg max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent py-1">
          {suggestions.map((contact, idx) => (
            <button type="button"
              key={`${contact.email}-${idx}`}
              onClick={() => selectSuggestion(contact)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                idx === activeIdx ? 'bg-brand-500/20 text-white' : 'text-rmpg-300 hover:bg-brand-500/10 hover:text-white'
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-brand-500/20 flex items-center justify-center text-[9px] text-brand-400 font-bold flex-shrink-0">
                {(contact.name || contact.email).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                {contact.name && <div className="text-[11px] truncate">{contact.name}</div>}
                <div className="text-[10px] text-rmpg-500 truncate">{contact.email}</div>
              </div>
              <span className="text-[8px] text-rmpg-600 uppercase">{contact.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Template Picker
// ============================================================

interface EmailTemplate {
  id: number;
  name: string;
  category: string;
  subject: string;
  body: string;
  is_system: number;
}

function TemplatePicker({ onSelect, onClose }: { onSelect: (template: EmailTemplate) => void; onClose: () => void }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<EmailTemplate[]>('/email/templates')
      .then(data => { if (!cancelled) setTemplates(data || []); })
      .catch((err) => { if (!cancelled) console.warn('[EmailPage] fetch templates failed:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const categories = [...new Set(templates.map(t => t.category))];
  const filtered = filter ? templates.filter(t => t.category === filter) : templates;

  return (
    <div ref={ref} className="absolute left-0 top-full mt-1 z-50 w-72 bg-surface-base border border-border-strong rounded-sm shadow-xl">
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider">Email Templates</span>
        <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close"><X className="w-3 h-3" /></button>
      </div>
      {/* Category filter */}
      <div className="px-2 py-1.5 border-b border-border-subtle flex items-center gap-1 flex-wrap">
        <button type="button" onClick={() => setFilter('')}
          className={`text-[9px] px-1.5 py-0.5 rounded-sm ${!filter ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-white'}`}>All</button>
        {categories.map(cat => (
          <button type="button" key={cat} onClick={() => setFilter(cat)}
            className={`text-[9px] px-1.5 py-0.5 rounded-sm capitalize ${filter === cat ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-white'}`}>{cat}</button>
        ))}
      </div>
      <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent py-1">
        {loading ? (
          <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center text-[10px] text-rmpg-500">No templates found</div>
        ) : (
          filtered.map(t => (
            <button type="button" key={t.id} onClick={() => { onSelect(t); onClose(); }}
              className="w-full text-left px-3 py-2 hover:bg-brand-500/10 transition-colors border-b border-border-subtle/30 last:border-0">
              <div className="text-[11px] text-white font-medium truncate">{t.name}</div>
              <div className="text-[9px] text-rmpg-500 truncate">{t.subject}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[8px] text-rmpg-600 capitalize bg-surface-sunken px-1 rounded-sm">{t.category}</span>
                {t.is_system ? <span className="text-[8px] text-amber-600">system</span> : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// Schedule Send Modal
// ============================================================

function ScheduleSendModal({ onSchedule, onClose }: { onSchedule: (dateTime: string) => void; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('08:00');

  // Set default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(dateToLocalYMD(tomorrow));
  }, []);

  const handleSchedule = () => {
    if (!date || !time) return;
    const dateTime = `${date}T${time}:00`;
    onSchedule(dateTime);
  };

  // Quick presets
  const presets = [
    { label: 'Tomorrow 8 AM', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; } },
    { label: 'Tomorrow 1 PM', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(13, 0, 0, 0); return d; } },
    { label: 'Monday 8 AM', getDate: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(8, 0, 0, 0); return d; } },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-surface-base border border-border-subtle rounded-sm w-80 mx-4">
        <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Clock className="w-4 h-4 text-brand-400" /> Schedule Send</h3>
          <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {/* Quick presets */}
          <div className="space-y-1">
            <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider">Quick Select</span>
            <div className="flex flex-col gap-1">
              {presets.map(preset => {
                const d = preset.getDate();
                return (
                  <button type="button" key={preset.label} onClick={() => { setDate(dateToLocalYMD(d)); setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); }}
                    className="text-left px-2 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/10 hover:text-white rounded-sm transition-colors">
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border-subtle pt-3">
            <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider block mb-2">Custom Date & Time</span>
            <div className="flex items-center gap-2">
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="input-dark text-xs flex-1 min-h-[36px]" min={localToday()} />
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="input-dark text-xs w-28 min-h-[36px]" />
            </div>
          </div>
        </div>
        <div className="px-4 py-2 border-t border-border-subtle flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs px-3 py-1">Cancel</button>
          <button type="button" onClick={handleSchedule} disabled={!date || !time} className="btn-primary text-xs px-3 py-1 flex items-center gap-1.5 disabled:opacity-40">
            <Clock className="w-3.5 h-3.5" /> Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Draft Auto-Save Helpers
// ============================================================

const DRAFT_STORAGE_KEY = 'email_compose_draft';

interface DraftState {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  savedAt: string;
}

function saveDraft(draft: Omit<DraftState, 'savedAt'>): void {
  try {
    if (!draft.to && !draft.cc && !draft.subject && !draft.body) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }));
  } catch { /* quota exceeded or private browsing — ignore */ }
}

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftState;
    // Discard drafts older than 24 hours
    if (Date.now() - new Date(draft.savedAt).getTime() > 24 * 60 * 60 * 1000) { localStorage.removeItem(DRAFT_STORAGE_KEY); return null; }
    return draft;
  } catch { return null; }
}

function clearDraft(): void { localStorage.removeItem(DRAFT_STORAGE_KEY); }

// ============================================================
// Email-Incident Link Panel
// ============================================================

interface EmailLink {
  id: number;
  email_graph_id: string;
  incident_id: number | null;
  call_id: number | null;
  warrant_id: number | null;
  person_id: number | null;
  link_type: string;
  notes: string | null;
  linked_by: number;
  created_at: string;
}

function EmailIncidentLinks({ emailId, onSnackbar }: { emailId: string; onSnackbar: (msg: string, type?: 'success' | 'error') => void }) {
  const [links, setLinks] = useState<EmailLink[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [linkTarget, setLinkTarget] = useState<'incident' | 'call' | 'warrant' | 'person'>('incident');
  const [linkRelation, setLinkRelation] = useState<'related' | 'evidence' | 'notification' | 'correspondence'>('related');
  const [linkId, setLinkId] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      const data = await apiFetch<EmailLink[]>(`/email/links/${emailId}`);
      setLinks(data || []);
    } catch { /* ignore */ }
  }, [emailId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleLink = async () => {
    if (!linkId.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        emailGraphId: emailId,
        linkType: linkRelation,
        notes: linkNotes || undefined,
      };
      payload[`${linkTarget}Id`] = parseInt(linkId, 10);
      await apiFetch('/email/link', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setShowForm(false);
      setLinkId('');
      setLinkNotes('');
      fetchLinks();
      onSnackbar('Email linked successfully');
    } catch (err: any) { onSnackbar(err.message || 'Failed to link', 'error'); }
    finally { setSaving(false); }
  };

  const handleUnlink = async (id: number) => {
    try {
      await apiFetch(`/email/link/${id}`, { method: 'DELETE' });
      fetchLinks();
      onSnackbar('Link removed');
    } catch { onSnackbar('Failed to remove link', 'error'); }
  };

  const getLinkLabel = (link: EmailLink) => {
    if (link.incident_id) return `Incident #${link.incident_id}`;
    if (link.call_id) return `Call #${link.call_id}`;
    if (link.warrant_id) return `Warrant #${link.warrant_id}`;
    if (link.person_id) return `Person #${link.person_id}`;
    return 'Unknown';
  };

  const getLinkIcon = (link: EmailLink) => {
    if (link.incident_id) return Shield;
    if (link.call_id) return Hash;
    if (link.warrant_id) return FileText;
    return Users;
  };

  return (
    <div className="border-t border-border-subtle">
      <div className="px-4 py-1.5 flex items-center gap-1.5 bg-surface-base/50">
        <Link2 className="w-3 h-3 text-rmpg-500" />
        <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider flex-1">Case Links</span>
        <span className="text-[9px] text-rmpg-600">{links.length}</span>
        <button type="button" onClick={() => setShowForm(!showForm)} className="p-0.5 text-brand-400 hover:text-brand-300" title="Link to case">
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {links.length > 0 && (
        <div className="px-4 pb-1.5 flex flex-wrap gap-1">
          {links.map(link => {
            const Icon = getLinkIcon(link);
            return (
              <div key={link.id} className="flex items-center gap-1 px-2 py-0.5 bg-surface-sunken border border-border-subtle rounded-sm text-[10px] text-rmpg-300 group">
                <Icon className="w-3 h-3 text-brand-400" />
                <span>{getLinkLabel(link)}</span>
                {link.link_type && <span className="text-[8px] text-rmpg-600 capitalize">{link.link_type}</span>}
                <button type="button" onClick={() => handleUnlink(link.id)} className="opacity-0 group-hover:opacity-100 text-rmpg-500 hover:text-red-400 transition-opacity">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="px-4 pb-2 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={linkTarget} onChange={e => setLinkTarget(e.target.value as any)}
              className="input-dark text-[10px] px-2 py-1 w-24 min-h-[36px]">
              <option value="incident">Incident</option>
              <option value="call">Call</option>
              <option value="warrant">Warrant</option>
              <option value="person">Person</option>
            </select>
            <input value={linkId} onChange={e => setLinkId(e.target.value)} placeholder="ID #"
              className="input-dark text-[10px] px-2 py-1 w-20 min-h-[36px]" type="number" />
            <select value={linkRelation} onChange={e => setLinkRelation(e.target.value as any)}
              className="input-dark text-[10px] px-2 py-1 w-28 min-h-[36px]">
              <option value="related">Related</option>
              <option value="evidence">Evidence</option>
              <option value="notification">Notification</option>
              <option value="correspondence">Correspondence</option>
            </select>
            <input value={linkNotes} onChange={e => setLinkNotes(e.target.value)} placeholder="Notes (optional)"
              className="input-dark text-[10px] px-2 py-1 flex-1 min-h-[36px]"
              onKeyDown={e => { if (e.key === 'Enter') handleLink(); }} />
            <button type="button" onClick={handleLink} disabled={saving || !linkId.trim()} className="btn-primary text-[9px] px-2 py-1 disabled:opacity-40">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : 'Link'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setLinkId(''); setLinkNotes(''); }} className="text-rmpg-500 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Scheduled Emails Panel
// ============================================================

interface ScheduledEmail {
  id: number;
  to_addresses: string;
  subject: string;
  scheduled_at: string;
  status: string;
  created_at: string;
}

function ScheduledEmailsPanel({ onSnackbar }: { onSnackbar: (msg: string, type?: 'success' | 'error') => void }) {
  const [emails, setEmails] = useState<ScheduledEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScheduled = useCallback(async () => {
    try {
      const data = await apiFetch<ScheduledEmail[]>('/email/scheduled');
      setEmails(data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchScheduled(); }, [fetchScheduled]);

  const handleCancel = async (id: number) => {
    try {
      await apiFetch(`/email/scheduled/${id}`, { method: 'DELETE' });
      setEmails(prev => prev.filter(e => e.id !== id));
      onSnackbar('Scheduled email cancelled');
    } catch { onSnackbar('Failed to cancel', 'error'); }
  };

  if (loading) return <div className="py-2 text-center"><Loader2 className="w-4 h-4 animate-spin text-brand-400 mx-auto" role="status" aria-label="Loading" /></div>;
  if (emails.length === 0) return <div className="py-3 text-center text-[10px] text-rmpg-600">No scheduled emails</div>;

  return (
    <div className="space-y-1 py-1">
      {emails.map(email => {
        const toList = (() => { try { return JSON.parse(email.to_addresses) as string[]; } catch { return [email.to_addresses]; } })();
        const scheduledDate = new Date(email.scheduled_at);
        const isPast = scheduledDate.getTime() < Date.now();
        return (
          <div key={email.id} className="px-3 py-1.5 border-b border-border-subtle/30 group">
            <div className="flex items-center gap-1.5">
              <CalendarClock className={`w-3 h-3 flex-shrink-0 ${email.status === 'sent' ? 'text-green-500' : email.status === 'failed' ? 'text-red-400' : isPast ? 'text-amber-400' : 'text-brand-400'}`} />
              <span className="text-[10px] text-rmpg-300 truncate flex-1">{email.subject || '(No subject)'}</span>
              {email.status === 'pending' && (
                <button type="button" onClick={() => handleCancel(email.id)}
                  className="opacity-0 group-hover:opacity-100 text-rmpg-500 hover:text-red-400 transition-opacity" title="Cancel">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="text-[9px] text-rmpg-500 ml-[18px]">
              To: {toList.join(', ').substring(0, 40)}{toList.join(', ').length > 40 ? '...' : ''}
            </div>
            <div className="text-[9px] ml-[18px]">
              <span className={email.status === 'sent' ? 'text-green-500' : email.status === 'failed' ? 'text-red-400' : 'text-rmpg-500'}>
                {email.status === 'pending' ? `Sends ${scheduledDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` :
                 email.status === 'sent' ? 'Sent' : 'Failed'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Email Body Frame — renders HTML email in a blob: URL iframe
// Uses blob: instead of srcdoc so the iframe inherits the page origin,
// allowing external images to load (srcdoc has null origin which many CDNs reject).
// ============================================================
const EmailBodyFrame = React.forwardRef<HTMLIFrameElement, { bodyHtml: string; onLoad?: () => void }>(
  ({ bodyHtml, onLoad }, ref) => {
    const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
    React.useEffect(() => {
      // Sanitize: strip <script> tags + inline event handlers
      const sanitized = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-blocked=');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank" rel="noopener noreferrer"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none';"><style>
        body { font-family: Segoe UI, Arial, sans-serif; font-size: 13px; color: #c0d0e0; background: #0d1520; margin: 16px; line-height: 1.6; word-wrap: break-word; }
        a { color: #3b82f6; text-decoration: underline; } a:hover { color: #60a5fa; } img { max-width: 100%; height: auto; } table { border-collapse: collapse; max-width: 100%; }
        td, th { padding: 4px 8px; } blockquote { border-left: 3px solid #1e3048; margin: 8px 0; padding: 4px 12px; color: #8899aa; }
        pre { background: #141e2b; padding: 8px; border-radius: 2px; overflow-x: auto; } hr { border: none; border-top: 1px solid #1e3048; margin: 16px 0; }
      </style></head><body>${sanitized}</body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    }, [bodyHtml]);
    if (!blobUrl) return null;
    return <iframe ref={ref} src={blobUrl} onLoad={onLoad} className="w-full border-0" style={{ minHeight: 200 }} title="Email body" />;
  }
);
EmailBodyFrame.displayName = 'EmailBodyFrame';

// ============================================================
// Print Email Helper
// ============================================================

function printEmail(message: EmailMessage, bodyHtml?: string) {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) return;

  const doc = printWindow.document;
  const toStr = message.toAddresses.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
  const ccStr = message.ccAddresses.length > 0 ? message.ccAddresses.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ') : '';
  const dateStr = new Date(message.receivedAt).toLocaleString();

  // Build print document using safe DOM methods
  const style = doc.createElement('style');
  style.textContent = `
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12pt; color: #1a1a1a; margin: 40px; line-height: 1.6; }
    .header { border-bottom: 2px solid #1a5a9e; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { font-size: 16pt; margin: 0 0 8px; color: #1a1a1a; }
    .meta { font-size: 10pt; color: #555; margin: 2px 0; }
    .meta strong { color: #333; min-width: 40px; display: inline-block; }
    .body-content { margin-top: 16px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 9pt; color: #999; }
    @media print { body { margin: 20px; } a { color: #1a5a9e; text-decoration: none; } }
  `;
  doc.head.appendChild(style);
  doc.title = message.subject;

  const header = doc.createElement('div');
  header.className = 'header';

  const h1 = doc.createElement('h1');
  h1.textContent = message.subject;
  header.appendChild(h1);

  const addMeta = (label: string, value: string) => {
    const div = doc.createElement('div');
    div.className = 'meta';
    const strong = doc.createElement('strong');
    strong.textContent = label;
    div.appendChild(strong);
    div.appendChild(doc.createTextNode(' ' + value));
    header.appendChild(div);
  };

  addMeta('From:', `${message.fromName || ''} <${message.fromAddress}>`);
  addMeta('To:', toStr);
  if (ccStr) addMeta('CC:', ccStr);
  addMeta('Date:', dateStr);

  doc.body.appendChild(header);

  const bodyDiv = doc.createElement('div');
  bodyDiv.className = 'body-content';
  if (bodyHtml) {
    // Use a sandboxed iframe approach: render HTML body inside an iframe for print
    // This is the same HTML we already render from the email server in a sandboxed iframe
    const iframe = doc.createElement('iframe');
    iframe.style.cssText = 'width:100%;border:none;min-height:200px;';
    iframe.sandbox.value = 'allow-same-origin';
    iframe.srcdoc = `<html><head><style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12pt;color:#1a1a1a;margin:0;line-height:1.6;}a{color:#1a5a9e;}img{max-width:100%;height:auto;}table{border-collapse:collapse;max-width:100%;}td,th{padding:4px 8px;}blockquote{border-left:3px solid #ccc;margin:8px 0;padding:4px 12px;color:#666;}</style></head><body>${bodyHtml}</body></html>`;
    bodyDiv.appendChild(iframe);
  } else {
    const pre = doc.createElement('pre');
    pre.textContent = message.bodyPreview;
    bodyDiv.appendChild(pre);
  }
  doc.body.appendChild(bodyDiv);

  const footer = doc.createElement('div');
  footer.className = 'footer';
  footer.textContent = `Printed from RMPG Flex — ${new Date().toLocaleString()}`;
  doc.body.appendChild(footer);

  setTimeout(() => { printWindow.print(); }, 500);
}

// ============================================================
// Search Filter Panel
// ============================================================

interface SearchFilters {
  sender: string;
  hasAttachments: boolean;
  isFlagged: boolean;
  dateFrom: string;
  dateTo: string;
  unreadOnly: boolean;
}

const EMPTY_FILTERS: SearchFilters = {
  sender: '',
  hasAttachments: false,
  isFlagged: false,
  dateFrom: '',
  dateTo: '',
  unreadOnly: false,
};

function hasActiveFilters(f: SearchFilters): boolean {
  return !!(f.sender || f.hasAttachments || f.isFlagged || f.dateFrom || f.dateTo || f.unreadOnly);
}

function SearchFilterPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<SearchFilters>(filters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleApply = () => { onChange(local); onClose(); };
  const handleReset = () => { onChange(EMPTY_FILTERS); onClose(); };

  return (
    <div ref={ref} className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface-base border border-border-strong rounded-sm shadow-xl p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-rmpg-400 font-semibold uppercase tracking-wider">Search Filters</span>
        <button type="button" onClick={onClose} className="text-rmpg-500 hover:text-white" aria-label="Close" title="Close"><X className="w-3 h-3" /></button>
      </div>

      <div>
        <label className="text-[9px] text-rmpg-500 block mb-0.5">From (sender)</label>
        <input value={local.sender} onChange={e => setLocal(prev => ({ ...prev, sender: e.target.value }))}
          className="input-dark w-full text-[10px] px-2 py-1 min-h-[36px]" placeholder="name or email" />
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
          <input type="checkbox" checked={local.hasAttachments} onChange={e => setLocal(prev => ({ ...prev, hasAttachments: e.target.checked }))}
            className="w-3 h-3 rounded-sm border-border-subtle bg-surface-sunken accent-brand-500" />
          <Paperclip className="w-3 h-3 text-rmpg-500" /> Has attachments
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
          <input type="checkbox" checked={local.isFlagged} onChange={e => setLocal(prev => ({ ...prev, isFlagged: e.target.checked }))}
            className="w-3 h-3 rounded-sm border-border-subtle bg-surface-sunken accent-brand-500" />
          <Flag className="w-3 h-3 text-rmpg-500" /> Flagged
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
          <input type="checkbox" checked={local.unreadOnly} onChange={e => setLocal(prev => ({ ...prev, unreadOnly: e.target.checked }))}
            className="w-3 h-3 rounded-sm border-border-subtle bg-surface-sunken accent-brand-500" />
          <Mail className="w-3 h-3 text-rmpg-500" /> Unread only
        </label>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-[9px] text-rmpg-500 block mb-0.5">From date</label>
          <input type="date" value={local.dateFrom} onChange={e => setLocal(prev => ({ ...prev, dateFrom: e.target.value }))}
            className="input-dark w-full text-[10px] px-2 py-1 min-h-[36px]" />
        </div>
        <div className="flex-1">
          <label className="text-[9px] text-rmpg-500 block mb-0.5">To date</label>
          <input type="date" value={local.dateTo} onChange={e => setLocal(prev => ({ ...prev, dateTo: e.target.value }))}
            className="input-dark w-full text-[10px] px-2 py-1 min-h-[36px]" />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
        {hasActiveFilters(local) ? (
          <button type="button" onClick={handleReset} className="text-[10px] text-rmpg-500 hover:text-white">Clear filters</button>
        ) : <div />}
        <button type="button" onClick={handleApply} className="btn-primary text-[10px] px-3 py-0.5">Apply</button>
      </div>
    </div>
  );
}

// ============================================================
// Desktop Notification Helper
// ============================================================

const NOTIF_PREF_KEY = 'email_notifications_enabled';

function getNotificationsEnabled(): boolean {
  try { return localStorage.getItem(NOTIF_PREF_KEY) !== 'false'; } catch { return true; }
}

function setNotificationsEnabled(enabled: boolean) {
  try { localStorage.setItem(NOTIF_PREF_KEY, String(enabled)); } catch { /* ignore */ }
}

async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showDesktopNotification(title: string, body: string) {
  if (!getNotificationsEnabled()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: 'email-notification',
      silent: false,
    });
    notif.onclick = () => { window.focus(); notif.close(); };
    setTimeout(() => notif.close(), 8000);
  } catch { /* service worker context */ }
}

// ============================================================
// Compose Modal — BCC, Attachments, Inline Images, Templates, Schedule
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
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [draftStatus, setDraftStatus] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } else if (mode === 'new') {
      // Restore draft for new compositions
      const draft = loadDraft();
      if (draft) {
        setTo(draft.to); setCc(draft.cc); setBcc(draft.bcc);
        setSubject(draft.subject); setBody(draft.body);
        if (draft.bcc) setShowBcc(true);
        setDraftStatus(`Draft restored from ${formatDate(draft.savedAt)}`);
      }
    }
  }, [mode, replyMessage]);

  // Auto-save draft on changes (debounced, only for new compositions)
  useEffect(() => {
    if (mode !== 'new') return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveDraft({ to, cc, bcc, subject, body });
      if (to || cc || subject || body) setDraftStatus('Draft saved');
    }, 2000);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [to, cc, bcc, subject, body, mode]);

  useEffect(() => { const t = setTimeout(() => textareaRef.current?.focus(), 100); return () => clearTimeout(t); }, []);

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSubject(template.subject);
    setBody(template.body);
    setDraftStatus(`Template "${template.name}" applied`);
  };

  const handleScheduleSend = async (scheduledAt: string) => {
    if (!to.trim()) { setError('Recipient is required'); return; }
    if (!subject.trim()) { setError('Subject is required'); return; }
    setSending(true);
    setError('');
    try {
      await apiFetch('/email/schedule', {
        method: 'POST',
        body: JSON.stringify({
          to: to.split(',').map(s => s.trim()).filter(Boolean),
          cc: cc.trim() ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          bcc: bcc.trim() ? bcc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          subject,
          body,
          scheduledAt,
        }),
      });
      clearDraft();
      onSent();
      onClose();
    } catch (err: any) { setError(err?.message || 'Operation failed'); }
    finally { setSending(false); setShowScheduleModal(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 25 * 1024 * 1024) { setError(`${file.name} exceeds 25MB limit`); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const parts = (reader.result as string).split(',');
        const base64 = parts.length > 1 ? parts[1] : parts[0];
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
        const imgParts = (reader.result as string).split(',');
        const base64 = imgParts.length > 1 ? imgParts[1] : imgParts[0];
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

      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      clearDraft();
      onSent();
      onClose();
    } catch (err: any) { setError(err?.message || 'Operation failed'); }
    finally { setSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (!files.length) return;
    Array.from(files).forEach(file => {
      if (file.size > 25 * 1024 * 1024) { setError(`${file.name} exceeds 25MB limit`); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const parts = (reader.result as string).split(',');
        const base64 = parts.length > 1 ? parts[1] : parts[0];
        setFileAttachments(prev => [...prev, { name: file.name, contentType: file.type || 'application/octet-stream', contentBytes: base64, size: file.size }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const totalAttachmentSize = fileAttachments.reduce((sum, a) => sum + a.size, 0);

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onKeyDown={handleKeyDown}>
      <div
        className={`bg-[#141e2b] border border-[#1e3048] rounded-t-lg sm:rounded-sm w-full max-w-2xl sm:mx-4 flex flex-col max-h-[95vh] sm:max-h-[85vh] shadow-2xl shadow-black/50 transition-all ${isDragOver ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-[#141e2b]' : ''}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e3048] bg-[#0d1520] rounded-t-lg">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            {mode === 'reply' ? <Reply className="w-4 h-4 text-brand-400" /> :
             mode === 'reply-all' ? <ReplyAll className="w-4 h-4 text-brand-400" /> :
             mode === 'forward' ? <Forward className="w-4 h-4 text-brand-400" /> :
             <Mail className="w-4 h-4 text-brand-400" />}
            {mode === 'new' ? 'New Message' : mode === 'reply' ? 'Reply' : mode === 'reply-all' ? 'Reply All' : 'Forward'}
          </h3>
          <div className="flex items-center gap-1">
            {draftStatus && <span className="text-[9px] text-green-500 italic mr-2">{draftStatus}</span>}
            <button type="button" onClick={onClose} className="p-1 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" aria-label="Close" title="Close"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-brand-500/10 border-2 border-dashed border-brand-500 rounded-sm pointer-events-none">
            <div className="text-center">
              <Upload className="w-8 h-8 text-brand-400 mx-auto mb-2" />
              <p className="text-sm text-brand-400 font-semibold">Drop files to attach</p>
            </div>
          </div>
        )}

        {/* Recipients */}
        <div className="px-4 pt-3 space-y-1.5">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-sm px-3 py-1.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
              <button type="button" onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-300"><X className="w-3 h-3" /></button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-rmpg-500 w-6 text-right flex-shrink-0">To</span>
            <div className="flex-1"><ContactAutocompleteInput value={to} onChange={setTo} placeholder="Recipients..." /></div>
            <div className="flex items-center gap-1 text-[9px] flex-shrink-0">
              <button type="button" onClick={() => setCc(cc || ' ')} className={`px-1.5 py-0.5 rounded-sm transition-colors ${cc ? 'text-brand-400 bg-brand-500/10' : 'text-rmpg-500 hover:text-white'}`}>Cc</button>
              <button type="button" onClick={() => { setShowBcc(!showBcc); if (!showBcc) setBcc(bcc || ' '); }} className={`px-1.5 py-0.5 rounded-sm transition-colors ${showBcc ? 'text-brand-400 bg-brand-500/10' : 'text-rmpg-500 hover:text-white'}`}>Bcc</button>
            </div>
          </div>

          {cc !== '' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-rmpg-500 w-6 text-right flex-shrink-0">Cc</span>
              <div className="flex-1"><ContactAutocompleteInput value={cc.trim()} onChange={setCc} placeholder="CC recipients..." /></div>
            </div>
          )}

          {showBcc && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-rmpg-500 w-6 text-right flex-shrink-0">Bcc</span>
              <div className="flex-1"><ContactAutocompleteInput value={bcc.trim()} onChange={setBcc} placeholder="BCC recipients..." /></div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-rmpg-500 w-6 text-right flex-shrink-0">Sub</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
              className="flex-1 bg-transparent text-xs text-white border-0 outline-none placeholder:text-rmpg-600 py-1" />
          </div>
        </div>

        <div className="border-t border-[#1e3048] mx-4 my-0" />

        {/* Formatting toolbar */}
        <div className="flex items-center gap-0.5 px-4 py-1">
          <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '**', '**', 'bold text')}
            className="p-1.5 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Bold (Ctrl+B)"><Bold className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '*', '*', 'italic text')}
            className="p-1.5 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Italic (Ctrl+I)"><Italic className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => textareaRef.current && insertFormat(textareaRef.current, '[', '](https://)', 'link text')}
            className="p-1.5 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Insert link"><Link className="w-3.5 h-3.5" /></button>
          <div className="w-px h-4 bg-rmpg-700 mx-1" />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="p-1.5 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Attach file"><Paperclip className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={handleInlineImage}
            className="p-1.5 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Insert inline image"><Image className="w-3.5 h-3.5" /></button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
          <div className="flex-1" />
          <div className="relative">
            <button type="button" onClick={() => setShowTemplatePicker(!showTemplatePicker)}
              className="flex items-center gap-1 px-2 py-1 text-[9px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Use template">
              <FileStack className="w-3 h-3" /> Templates
            </button>
            {showTemplatePicker && <TemplatePicker onSelect={handleTemplateSelect} onClose={() => setShowTemplatePicker(false)} />}
          </div>
          <button type="button" onClick={() => setShowSignatureEditor(!showSignatureEditor)}
            className="flex items-center gap-1 px-2 py-1 text-[9px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Edit signature">
            <Settings2 className="w-3 h-3" /> Sig
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-4 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
          <textarea ref={textareaRef} value={body} onChange={e => setBody(e.target.value)} rows={12}
            className="w-full bg-transparent text-xs text-rmpg-200 resize-none outline-none placeholder:text-rmpg-600 leading-relaxed"
            placeholder="Write your message here...

Tip: **bold**, *italic*, [link text](url)
Drag & drop files to attach • Ctrl+Enter to send" />

          {showSignatureEditor && <SignatureEditor onClose={() => setShowSignatureEditor(false)} />}
        </div>

        {/* Reply context */}
        {replyMessage && (mode === 'reply' || mode === 'reply-all') && (
          <div className="mx-4 mb-2 text-[10px] text-rmpg-500 bg-[#0d1520] border-l-2 border-l-brand-500/30 rounded-sm p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Reply className="w-3 h-3 text-brand-400" />
              <span className="text-rmpg-400 font-medium">{replyMessage.fromName || replyMessage.fromAddress}</span>
              <span className="text-rmpg-600">•</span>
              <span className="text-rmpg-600">{formatDate(replyMessage.receivedAt)}</span>
            </div>
            <div className="text-rmpg-500 line-clamp-2">{replyMessage.bodyPreview}</div>
          </div>
        )}

        {/* Attachments */}
        {fileAttachments.length > 0 && (
          <div className="mx-4 mb-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">
                {fileAttachments.length} attachment{fileAttachments.length > 1 ? 's' : ''} ({formatSize(totalAttachmentSize)})
              </span>
              <button type="button" onClick={() => setFileAttachments([])} className="text-[9px] text-rmpg-500 hover:text-red-400">Remove all</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {fileAttachments.map((att, idx) => {
                const ext = att.name.split('.').pop()?.toLowerCase() || '';
                const isImage = ['jpg','jpeg','png','gif','webp'].includes(ext);
                const isPdf = ext === 'pdf';
                const fileColor = isImage ? '#06b6d4' : isPdf ? '#ef4444' : '#8b5cf6';
                return (
                  <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0d1520] border border-[#1e3048] rounded-sm text-[10px] text-rmpg-300 group">
                    <div className="w-5 h-5 rounded-sm flex items-center justify-center text-[7px] font-bold uppercase"
                      style={{ backgroundColor: fileColor + '15', color: fileColor }}>{ext.slice(0, 3)}</div>
                    <span className="truncate max-w-[100px]">{att.name}</span>
                    <span className="text-rmpg-600 text-[9px]">{formatSize(att.size)}</span>
                    <button type="button" onClick={() => removeAttachment(idx)} className="text-rmpg-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#1e3048] bg-[#0d1520] rounded-b-lg">
          <div className="text-[9px] text-rmpg-600">
            <span className="hidden sm:inline">Signature auto-appended • Markdown formatting supported</span>
            <span className="sm:hidden">Ctrl+Enter to send</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-rmpg-300 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors">
              Discard
            </button>
            {mode === 'new' && (
              <button type="button" onClick={() => setShowScheduleModal(true)} disabled={sending}
                className="px-3 py-1.5 text-xs text-rmpg-300 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors flex items-center gap-1.5 disabled:opacity-40">
                <Clock className="w-3.5 h-3.5" /> Later
              </button>
            )}
            <button type="button" onClick={handleSend} disabled={sending}
              className="px-5 py-1.5 text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white rounded-sm transition-all flex items-center gap-1.5 shadow-sm shadow-brand-500/30 hover:shadow-md hover:shadow-brand-500/40 disabled:opacity-40">
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Schedule Send Modal */}
      {showScheduleModal && (
        <ScheduleSendModal
          onSchedule={handleScheduleSend}
          onClose={() => setShowScheduleModal(false)}
        />
      )}
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
      <button type="button" onClick={() => setOpen(!open)} className="p-1 text-rmpg-500 hover:text-white" title="Move to folder"><FolderInput className="w-3.5 h-3.5" /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-base border border-border-strong rounded-sm shadow-lg py-1 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
          {folders.filter(f => getFolderKey(f) !== currentFolder).map(f => {
            const Icon = FOLDER_ICONS[f.displayName] || Folder;
            return (
              <button type="button" key={f.id} onClick={() => { onMove(getFolderKey(f)); setOpen(false); }}
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
    <button type="button" onClick={() => { onClick(); onClose(); }}
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
    <div ref={ref} style={style} className="min-w-[180px] bg-surface-base border border-border-strong rounded-sm shadow-xl py-1">
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
          <div className="absolute left-full top-0 min-w-[150px] bg-surface-base border border-border-strong rounded-sm shadow-xl py-1 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
            {folders.filter(f => getFolderKey(f) !== currentFolder).map(f => {
              const Icon = FOLDER_ICONS[f.displayName] || Folder;
              return (
                <button type="button" key={f.id} onClick={() => { onMove(getFolderKey(f)); onClose(); }}
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

function InlineReply({ messageId, onSent, onError }: { messageId: string; onSent: () => void; onError?: (msg: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await apiFetch(`/email/messages/${messageId}/reply`, { method: 'POST', body: JSON.stringify({ body }) });
      setBody(''); setExpanded(false); onSent();
    } catch (err: any) { onError?.(err?.message || 'Failed to send reply'); } finally { setSending(false); }
  };

  if (!expanded) {
    return (
      <div className="border-t border-[#1e3048] bg-[#0d1520]">
        <div onClick={() => { setExpanded(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="mx-4 my-3 flex items-center gap-2 px-4 py-2.5 border border-[#1e3048] rounded-sm cursor-text text-xs text-rmpg-500 hover:border-brand-500/40 hover:text-rmpg-300 transition-all hover:shadow-lg hover:shadow-brand-500/5">
          <Reply className="w-3.5 h-3.5 text-rmpg-600 group-hover:text-brand-400 transition-colors" />
          <span>Click here to reply...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[#1e3048] bg-[#0d1520]">
      <div className="mx-4 my-3 border border-[#1e3048] rounded-sm bg-[#141e2b] overflow-hidden focus-within:border-brand-500/40 transition-colors">
        <textarea ref={inputRef} value={body} onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); } if (e.key === 'Escape') { setExpanded(false); setBody(''); } }}
          rows={4} className="w-full bg-transparent text-xs text-rmpg-200 p-3 resize-none focus:outline-none placeholder:text-rmpg-600 leading-relaxed"
          placeholder="Type your reply..." autoFocus />
        <div className="flex items-center justify-between px-3 py-2 bg-[#0d1520]/50">
          <span className="text-[9px] text-rmpg-600 font-mono">Ctrl+Enter to send &middot; Esc to cancel</span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => { setExpanded(false); setBody(''); }} className="px-2.5 py-1 text-[10px] text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors">Cancel</button>
            <button type="button" onClick={handleSend} disabled={sending || !body.trim()}
              className="px-4 py-1 text-[10px] font-semibold bg-brand-500 hover:bg-brand-600 text-white rounded-sm transition-colors flex items-center gap-1 disabled:opacity-40 shadow-sm shadow-brand-500/20">
              {sending ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Send className="w-3 h-3" />} Reply
            </button>
          </div>
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

export default function EmailPage() {
  const { subscribe } = useWebSocket();
  const { addToast } = useToast();
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
  const [loadingMore, setLoadingMore] = useState(false);

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

  // Search filters
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [showSearchFilters, setShowSearchFilters] = useState(false);

  // Notifications
  const [notificationsOn, setNotificationsOn] = useState(getNotificationsEnabled);

  // Scheduled emails panel
  const [showScheduledPanel, setShowScheduledPanel] = useState(false);

  // Feature 23: Auto-categorization
  const [categorizing, setCategorizing] = useState(false);

  // Feature 25: Thread view mode
  const [viewMode, setViewMode] = useState<'messages' | 'threads'>('messages');
  const [apiThreads, setApiThreads] = useState<any[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);

  const handleAutoCategorize = useCallback(async () => {
    setCategorizing(true);
    try {
      const res = await apiFetch<{ processed: number; categorized: number }>('/email/categorize/batch', { method: 'POST' });
      addToast(`Categorized ${res.categorized} of ${res.processed} messages`, 'success');
    } catch { addToast('Auto-categorization failed', 'error'); }
    finally { setCategorizing(false); }
  }, [addToast]);

  const fetchThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const params = new URLSearchParams({ folder: selectedFolder, page: '1', per_page: '25' });
      const data = await apiFetch<{ threads: any[]; hasMore: boolean }>(`/email/threads?${params}`);
      setApiThreads(data.threads || []);
    } catch { setApiThreads([]); }
    finally { setLoadingThreads(false); }
  }, [selectedFolder]);

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
      apiFetch<EmailFolder[]>('/email/folders').then(setFolders).catch((err) => { console.warn('[EmailPage] refresh folders failed:', err); });
    }, 500);
  }, []);

  // Clean up debounced folder refresh on unmount
  useEffect(() => () => { if (folderRefreshTimerRef.current) clearTimeout(folderRefreshTimerRef.current); }, []);

  // ─── Data Fetching ───

  const fetchStatus = useCallback(async () => {
    try { const data = await apiFetch<{ configured: boolean; enabled: boolean; authorized: boolean }>('/email/status'); setStatus(data); } catch (err) { console.warn('[EmailPage] fetch status failed:', err); }
  }, []);

  const fetchFolders = useCallback(async () => {
    try { const data = await apiFetch<EmailFolder[]>('/email/folders'); setFolders(data || []); } catch (err) { console.warn('[EmailPage] fetch folders failed:', err); }
  }, []);

  const fetchMessages = useCallback(async (p = 1, folder = selectedFolder, q = search) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ folder, page: String(p), per_page: '25' });
      if (q) params.set('search', q);
      const data = await apiFetch<MessagesResponse>(`/email/messages?${params}`);
      if (p === 1) setMessages(data.messages); else setMessages(prev => [...prev, ...data.messages]);
      setHasMore(data.hasMore || false);
      setPage(p);
    } catch (e) { console.warn('[Email] fetch messages failed:', e); } finally { setLoading(false); setLoadingMore(false); }
  }, [selectedFolder, search]);

  const fetchFullMessage = useCallback(async (id: string) => {
    setLoadingMessage(true);
    try {
      const msg = await apiFetch<EmailMessage>(`/email/messages/${id}`);
      setFullMessage(msg);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, isRead: true } : m));
      try { const atts = await apiFetch<EmailAttachment[]>(`/email/messages/${id}/attachments`); setAttachments(atts); }
      catch (err) { console.warn('[EmailPage] fetch attachments failed:', err); setAttachments([]); }
    } catch (e) { console.warn('[Email] fetch message failed:', e); } finally { setLoadingMessage(false); }
  }, []);

  const fetchChildFolders = useCallback(async (parentId: string) => {
    try {
      const children = await apiFetch<EmailFolder[]>(`/email/folders/${parentId}/children`);
      setChildFolders(prev => new Map(prev).set(parentId, children));
    } catch (err) { console.warn('[EmailPage] fetch child folders failed:', err); }
  }, []);

  // ─── Effects ───

  useLiveSync('admin', fetchMessages);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    if (status?.authorized) { fetchFolders(); fetchMessages(1); }
  }, [status?.authorized]); // eslint-disable-line

  useEffect(() => {
    const unsub = subscribe('email:new_messages', (data: any) => {
      if (selectedFolder === 'inbox') fetchMessages(1);
      fetchFolders();
      // Desktop notification for new emails
      if (data?.newCount > 0) {
        showDesktopNotification(
          `${data.newCount} new email${data.newCount > 1 ? 's' : ''}`,
          data.unread ? `${data.unread} unread in inbox` : 'Check your inbox'
        );
      }
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
  }, [searchInput, search, selectedFolder, fetchMessages]);

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
      if (resizingRef.current) { resizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; try { localStorage.setItem('email_list_width', String(listWidth)); } catch { /* ignore */ } }
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
      await apiFetch(`/email/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ isRead: !msg.isRead }) });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isRead: !msg.isRead } : m));
      showSnackbar(msg.isRead ? 'Marked as unread' : 'Marked as read');
      debouncedFolderRefresh();
    } catch { showSnackbar('Failed to update', 'error'); }
  };

  const handleToggleFlag = async (msg: EmailMessage) => {
    try {
      await apiFetch(`/email/messages/${msg.id}`, { method: 'PATCH', body: JSON.stringify({ isFlagged: !msg.isFlagged }) });
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
      await apiFetch(`/email/messages/${msg.id}/move`, { method: 'POST', body: JSON.stringify({ folderId: 'archive' }) });
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
      await apiFetch(`/email/messages/${target.id}/move`, { method: 'POST', body: JSON.stringify({ folderId }) });
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
      await apiFetch('/email/messages/batch', { method: 'POST', body: JSON.stringify({ action, ids }) });
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
      await apiFetch('/email/messages/mark-all-read', { method: 'POST', body: JSON.stringify({ folder: selectedFolder }) });
      setMessages(prev => prev.map(m => ({ ...m, isRead: true }))); showSnackbar('All messages marked as read'); debouncedFolderRefresh();
    } catch { showSnackbar('Failed to mark all as read', 'error'); }
  };

  // Folder management
  const handleCreateFolder = async (parentId?: string) => {
    if (!newFolderName.trim()) return;
    try {
      await apiFetch('/email/folders', { method: 'POST', body: JSON.stringify({ displayName: newFolderName.trim(), parentFolderId: parentId }) });
      setNewFolderName(''); setShowNewFolder(false); fetchFolders();
      if (parentId) fetchChildFolders(parentId);
      showSnackbar('Folder created');
    } catch { showSnackbar('Failed to create folder', 'error'); }
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!renameValue.trim()) return;
    try {
      await apiFetch(`/email/folders/${folderId}`, { method: 'PATCH', body: JSON.stringify({ displayName: renameValue.trim() }) });
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
    try { localStorage.setItem('email_folder_collapsed', String(next)); } catch { /* ignore */ }
  };

  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, msg: EmailMessage) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
  };

  // Set document title
  useEffect(() => { document.title = 'Email \u2014 RMPG Flex'; }, []);

  // ─── Not Configured ───

  if (status && !status.configured) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-md panel-beveled bg-surface-base p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
            <WifiOff className="w-8 h-8 text-red-400/60" />
          </div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Email Not Configured</h2>
          <p className="text-xs text-rmpg-400 leading-relaxed">
            Microsoft 365 email integration needs to be set up by an administrator.
          </p>
          <div className="panel-beveled bg-surface-sunken p-3 text-left space-y-1.5 text-[10px] text-rmpg-400">
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1">Setup Steps</div>
            <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-brand-500/20 text-brand-400 text-[8px] font-bold flex items-center justify-center flex-shrink-0">1</span> Go to Admin → Integrations</div>
            <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-brand-500/20 text-brand-400 text-[8px] font-bold flex items-center justify-center flex-shrink-0">2</span> Enter Microsoft Azure App credentials</div>
            <div className="flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-brand-500/20 text-brand-400 text-[8px] font-bold flex items-center justify-center flex-shrink-0">3</span> Complete OAuth authorization</div>
          </div>
          <a href="/admin?tab=integrations" className="btn-primary text-xs px-4 py-1.5 inline-flex items-center gap-1.5">
            Go to Admin Settings
          </a>
        </div>
      </div>
    );
  }

  if (status && !status.authorized) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4 max-w-md panel-beveled bg-surface-base p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <AlertTriangle className="w-8 h-8 text-amber-400/60" />
          </div>
          <h2 className="text-sm font-semibold text-white tracking-wide">Authorization Required</h2>
          <p className="text-xs text-rmpg-400 leading-relaxed">
            Microsoft email credentials are configured, but OAuth authorization hasn't been completed yet.
            An administrator needs to sign in with the Microsoft 365 account.
          </p>
          <a href="/admin?tab=integrations" className="btn-primary text-xs px-4 py-1.5 inline-flex items-center gap-1.5">
            Complete Authorization
          </a>
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

  // Apply client-side search filters
  const filteredMessages = hasActiveFilters(searchFilters)
    ? messages.filter(msg => {
        if (searchFilters.sender) {
          const s = searchFilters.sender.toLowerCase();
          if (!msg.fromName.toLowerCase().includes(s) && !msg.fromAddress.toLowerCase().includes(s)) return false;
        }
        if (searchFilters.hasAttachments && !msg.hasAttachments) return false;
        if (searchFilters.isFlagged && !msg.isFlagged) return false;
        if (searchFilters.unreadOnly && msg.isRead) return false;
        if (searchFilters.dateFrom && msg.receivedAt < searchFilters.dateFrom) return false;
        if (searchFilters.dateTo && msg.receivedAt > searchFilters.dateTo + 'T23:59:59') return false;
        return true;
      })
    : messages;

  const conversationThreads = groupByConversation(filteredMessages);
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
            <button type="button" onClick={e => { e.stopPropagation(); toggleFolderExpand(f.id); }} className="p-0.5 -ml-0.5 text-rmpg-500 hover:text-white">
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
            <span className={`text-[9px] font-bold bg-brand-500/20 text-brand-400 px-1.5 rounded-full min-w-[18px] text-center ${folderCollapsed ? 'absolute top-0 right-0 mt-0.5 mr-0.5' : ''}`}>
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
          <button type="button" onClick={toggleFolderCollapse} className="p-1 text-rmpg-500 hover:text-white" title={folderCollapsed ? 'Expand folders' : 'Collapse folders'}>
            {folderCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
          {!folderCollapsed && (
            <button type="button" onClick={() => setComposing('new')} className="flex-1 text-xs py-1.5 flex items-center justify-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-sm transition-all shadow-sm shadow-brand-500/20 hover:shadow-md hover:shadow-brand-500/30">
              <Plus className="w-3.5 h-3.5" /> Compose
            </button>
          )}
          {folderCollapsed && (
            <button type="button" onClick={() => setComposing('new')} className="p-1 text-brand-400 hover:text-brand-300" title="Compose">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Total unread badge (collapsed mode) */}
        {folderCollapsed && totalUnread > 0 && (
          <div className="text-center py-1 text-[9px] font-bold text-brand-400">{totalUnread}</div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent py-1">
          {topLevelFolders.map(f => renderFolderItem(f))}
        </div>

        {/* New folder button */}
        {!folderCollapsed && (
          <div className="px-2 py-1.5 border-t border-border-subtle">
            {showNewFolder ? (
              <div className="flex items-center gap-1">
                <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); } }}
                  className="flex-1 input-dark text-[10px] px-2 py-0.5 min-h-[36px]" placeholder="Folder name" autoFocus />
                <button type="button" onClick={() => handleCreateFolder()} className="p-0.5 text-brand-400 hover:text-brand-300"><CheckCircle className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }} className="p-0.5 text-rmpg-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowNewFolder(true)}
                className="w-full flex items-center gap-1.5 text-[10px] text-rmpg-500 hover:text-white transition-colors py-0.5">
                <FolderPlus className="w-3 h-3" /> New Folder
              </button>
            )}
          </div>
        )}

        {/* Scheduled emails section */}
        {!folderCollapsed && (
          <div className="border-t border-border-subtle">
            <button type="button" onClick={() => setShowScheduledPanel(!showScheduledPanel)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-rmpg-400 hover:text-white transition-colors">
              <CalendarClock className="w-3 h-3" />
              <span className="flex-1 text-left">Scheduled</span>
              {showScheduledPanel ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRightIcon className="w-2.5 h-2.5" />}
            </button>
            {showScheduledPanel && <ScheduledEmailsPanel onSnackbar={showSnackbar} />}
          </div>
        )}

        {/* Notification toggle + shortcuts */}
        {!folderCollapsed && (
          <div className="px-3 py-2 border-t border-border-subtle space-y-1">
            <button type="button" onClick={async () => {
              const newState = !notificationsOn;
              if (newState) {
                const granted = await requestNotificationPermission();
                if (!granted) { showSnackbar('Notifications blocked by browser', 'error'); return; }
              }
              setNotificationsEnabled(newState);
              setNotificationsOn(newState);
              showSnackbar(newState ? 'Email notifications enabled' : 'Email notifications disabled');
            }}
              className="w-full flex items-center gap-1.5 text-[10px] text-rmpg-500 hover:text-white transition-colors py-0.5">
              {notificationsOn ? <Bell className="w-3 h-3 text-brand-400" /> : <BellOff className="w-3 h-3" />}
              {notificationsOn ? 'Notifications on' : 'Notifications off'}
            </button>
            <div className="text-[8px] text-rmpg-600 space-y-0.5 font-mono">
              <div>Ctrl+N New &middot; Ctrl+R Reply</div>
              <div>Ctrl+F Forward &middot; &#x2191;&#x2193; Navigate</div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Folder context menu ─── */}
      {folderContextMenu && (
        <div className="fixed z-[100]" style={{ left: folderContextMenu.x, top: folderContextMenu.y }}>
          <div className="min-w-[140px] bg-surface-base border border-border-strong rounded-sm shadow-xl py-1"
            ref={el => {
              if (el) {
                const handler = (e: MouseEvent) => { if (!el.contains(e.target as Node)) setFolderContextMenu(null); };
                document.addEventListener('mousedown', handler, { once: true });
              }
            }}>
            <button type="button" onClick={() => { setRenamingFolder(folderContextMenu.folder.id); setRenameValue(folderContextMenu.folder.displayName); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white"><Edit3 className="w-3 h-3" /> Rename</button>
            <button type="button" onClick={() => { setShowNewFolder(true); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rmpg-300 hover:bg-brand-500/15 hover:text-white"><FolderPlus className="w-3 h-3" /> New Subfolder</button>
            <div className="border-t border-border-subtle my-1" />
            <button type="button" onClick={() => { handleDeleteFolder(folderContextMenu.folder.id); setFolderContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"><Trash className="w-3 h-3" /> Delete</button>
          </div>
        </div>
      )}

      {/* ─── Message List Panel ─── */}
      <div className={`flex-shrink-0 border-r border-border-subtle flex flex-col ${mobileView === 'detail' ? 'hidden md:flex' : 'flex'} md:flex`}
        style={{ width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : listWidth, minWidth: 240 }}>

        {/* Mobile folder selector */}
        <div className="md:hidden flex items-center gap-1.5 px-2 py-1.5 border-b border-border-subtle bg-surface-base">
          <select
            value={selectedFolder}
            onChange={e => handleSelectFolder(e.target.value)}
            className="flex-1 text-xs bg-[#0d1520] border border-[#1e3048] rounded-sm px-2 py-1.5 text-white focus:border-brand-500 focus:outline-none"
          >
            {sortedFolders.map(f => {
              const key = getFolderKey(f);
              return <option key={f.id} value={key}>{f.displayName}{f.unreadItemCount > 0 ? ` (${f.unreadItemCount})` : ''}</option>;
            })}
          </select>
          <button type="button" onClick={() => setComposing('new')} className="p-2 bg-brand-500 rounded-sm text-white" title="Compose">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Snackbar */}
        {snackbar && (
          <div className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b ${
            snackbar.type === 'success' ? 'bg-green-900/20 border-green-800/40 text-green-400' : 'bg-red-900/20 border-red-800/40 text-red-400'
          }`}>
            {snackbar.type === 'success' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span className="flex-1">{snackbar.text}</span>
            <button type="button" onClick={dismissSnackbar} className="opacity-60 hover:opacity-100" aria-label="Close" title="Close"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Batch action bar OR Search bar */}
        {selectedIds.size > 0 ? (
          <div className="px-2 py-1.5 border-b border-border-subtle flex items-center gap-1 bg-brand-500/5">
            <button type="button" onClick={selectAll} className="p-1 text-brand-400 hover:text-brand-300" title="Toggle select all">
              {selectedIds.size === messages.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <span className="text-[10px] text-brand-400 font-medium">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button type="button" onClick={() => handleBatchAction('archive')} className="p-1 text-rmpg-400 hover:text-white" title="Archive"><Archive className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => handleBatchAction('markRead')} className="p-1 text-rmpg-400 hover:text-white" title="Mark read"><Eye className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => handleBatchAction('markUnread')} className="p-1 text-rmpg-400 hover:text-white" title="Mark unread"><EyeOff className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => handleBatchAction('delete')} className="p-1 text-rmpg-400 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="p-1 text-rmpg-500 hover:text-white" title="Clear selection"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <div className="px-2 py-1.5 border-b border-border-subtle flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search emails..." aria-label="Search emails..."
                  className="input-dark w-full text-[11px] pl-7 pr-7 py-1 min-h-[36px]" />
                {searchInput && (
                  <button type="button" onClick={handleClearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white" aria-label="Close" title="Close"><X className="w-3 h-3" /></button>
                )}
                {showSearchFilters && (
                  <SearchFilterPanel filters={searchFilters} onChange={setSearchFilters} onClose={() => setShowSearchFilters(false)} />
                )}
              </div>
              <button type="button" onClick={() => setShowSearchFilters(!showSearchFilters)}
                className={`p-1 rounded-sm transition-colors ${hasActiveFilters(searchFilters) ? 'text-brand-400 bg-brand-500/10' : 'text-rmpg-500 hover:text-white'}`}
                title="Search filters">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              {unreadCount > 0 && (
                <button type="button" onClick={handleMarkAllRead} className="p-1 text-rmpg-500 hover:text-white rounded-sm" title="Mark all as read"><Eye className="w-3.5 h-3.5" /></button>
              )}
              <button type="button" onClick={handleRefresh} className="p-1 text-rmpg-500 hover:text-white rounded-sm" title="Refresh">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {/* Feature 25: Thread View Toggle */}
              <button type="button"
                onClick={() => { const next = viewMode === 'messages' ? 'threads' : 'messages'; setViewMode(next); if (next === 'threads') fetchThreads(); }}
                className={`p-1 rounded-sm transition-colors ${viewMode === 'threads' ? 'text-brand-400 bg-brand-500/10' : 'text-rmpg-500 hover:text-white'}`}
                title={viewMode === 'threads' ? 'Switch to messages view' : 'Switch to thread view'}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
              {/* Feature 23: Auto-categorize */}
              <button type="button"
                onClick={handleAutoCategorize}
                disabled={categorizing}
                className="p-1 text-rmpg-500 hover:text-white rounded-sm"
                title="Auto-categorize emails"
              >
                {categorizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Hash className="w-3.5 h-3.5" />}
              </button>
              <button type="button" onClick={() => setComposing('new')} className="p-1 text-brand-400 hover:text-brand-300 rounded-sm md:hidden" title="Compose"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            {/* Active filter indicators */}
            {hasActiveFilters(searchFilters) && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[8px] text-rmpg-500 uppercase">Filters:</span>
                {searchFilters.sender && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm">from: {searchFilters.sender}</span>}
                {searchFilters.hasAttachments && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm flex items-center gap-0.5"><Paperclip className="w-2.5 h-2.5" /> attachments</span>}
                {searchFilters.isFlagged && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm flex items-center gap-0.5"><Flag className="w-2.5 h-2.5" /> flagged</span>}
                {searchFilters.unreadOnly && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm">unread</span>}
                {searchFilters.dateFrom && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm">from: {searchFilters.dateFrom}</span>}
                {searchFilters.dateTo && <span className="text-[9px] px-1.5 py-0 bg-brand-500/10 text-brand-400 rounded-sm">to: {searchFilters.dateTo}</span>}
                <button type="button" onClick={() => setSearchFilters(EMPTY_FILTERS)} className="text-[8px] text-rmpg-500 hover:text-white ml-1">clear</button>
              </div>
            )}
          </div>
        )}

        {/* Feature 25: Thread View Mode Indicator */}
        {viewMode === 'threads' && (
          <div className="px-2 py-1 border-b border-border-subtle bg-brand-500/5 flex items-center gap-1.5 text-[9px] text-brand-400">
            <MessageSquare className="w-3 h-3" />
            <span>Thread View</span>
            <span className="text-rmpg-500">— emails grouped by conversation</span>
            {loadingThreads && <Loader2 className="w-3 h-3 animate-spin ml-auto" role="status" aria-label="Loading" />}
          </div>
        )}

        {/* Message List (threaded) */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
          {loading && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading data...</span></div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-rmpg-500 text-xs">
              <Mail className="w-8 h-8 mx-auto mb-3 opacity-40" />
              {search ? (<><div>No results for &ldquo;{search}&rdquo;</div><button type="button" onClick={handleClearSearch} className="text-brand-400 hover:text-brand-300 mt-1">Clear search</button></>) : 'No messages'}
            </div>
          ) : (
            <>
              {conversationThreads.map(thread => {
                const isMulti = thread.messages.length > 1;
                const isExpanded = expandedThreads.has(thread.conversationId);
                const displayMessages = isMulti && !isExpanded ? [thread.latest] : thread.messages;

                return (
                  <div key={thread.conversationId}>
                    {isMulti && (
                      <button type="button" onClick={() => toggleThread(thread.conversationId)}
                        className="w-full flex items-center gap-1.5 px-3 py-1 text-[9px] text-brand-400/70 hover:text-brand-400 bg-brand-500/5 border-b border-brand-500/10 transition-colors">
                        {isExpanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRightIcon className="w-2.5 h-2.5" />}
                        <MessageSquare className="w-2.5 h-2.5" />
                        <span className="font-medium">{thread.messages.length} messages in conversation</span>
                        {!isExpanded && <span className="text-rmpg-600 ml-auto">click to expand</span>}
                      </button>
                    )}

                    {displayMessages.map(msg => {
                      // Generate consistent avatar color from sender
                      const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6','#f97316'];
                      const senderKey = (msg.fromAddress || msg.fromName || '').toLowerCase();
                      const avatarColor = AVATAR_COLORS[Math.abs([...senderKey].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length];
                      const avatarInitial = (msg.fromName || msg.fromAddress || '?').charAt(0).toUpperCase();

                      return (
                      <div key={msg.id}
                        className={`group relative px-3 py-2.5 cursor-pointer border-b border-border-subtle/40 transition-all duration-150 ${
                          selectedMessage?.id === msg.id
                            ? 'bg-brand-500/10 border-l-[3px] border-l-brand-500'
                            : msg.isRead
                              ? 'hover:bg-surface-base/80 border-l-[3px] border-l-transparent'
                              : 'bg-surface-base/30 hover:bg-surface-base/60 border-l-[3px] border-l-brand-400/50'
                        } ${isMulti && isExpanded && msg !== thread.latest ? 'pl-6' : ''}`}
                        onContextMenu={e => handleContextMenu(e, msg)}>
                        <div className="flex items-start gap-2.5">
                          {/* Avatar / Select checkbox */}
                          <div className="relative flex-shrink-0 mt-0.5">
                            {selectedIds.has(msg.id) ? (
                              <button type="button" onClick={e => { e.stopPropagation(); toggleSelectId(msg.id); }}
                                className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center">
                                <CheckCircle className="w-4 h-4 text-white" />
                              </button>
                            ) : (
                              <button type="button" onClick={e => { e.stopPropagation(); toggleSelectId(msg.id); }}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold transition-all group-hover:ring-2 group-hover:ring-rmpg-600"
                                style={{ backgroundColor: avatarColor + '20', color: avatarColor }}>
                                {avatarInitial}
                              </button>
                            )}
                            {!msg.isRead && !selectedIds.has(msg.id) && (
                              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-400 border-2 border-surface-sunken shadow-sm shadow-brand-400/50" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0" onClick={() => handleSelectMessage(msg)}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`text-[11px] truncate flex-1 ${msg.isRead ? 'text-rmpg-300' : 'text-white font-semibold'}`}>
                                {msg.fromName || msg.fromAddress}
                              </span>
                              {isMulti && !isExpanded && (
                                <span className="text-[8px] bg-brand-500/15 text-brand-400 px-1.5 py-0.5 rounded-full font-mono font-bold min-w-[18px] text-center">{thread.messages.length}</span>
                              )}
                              <span className="text-[9px] text-rmpg-500 flex-shrink-0 tabular-nums">{formatDate(msg.receivedAt)}</span>
                            </div>
                            <div className={`text-[11px] truncate ${msg.isRead ? 'text-rmpg-400' : 'text-rmpg-100 font-medium'}`}>{msg.subject || '(no subject)'}</div>
                            <div className="text-[10px] text-rmpg-500 truncate mt-0.5 leading-relaxed">{msg.bodyPreview}</div>
                            {/* Indicator pills */}
                            {(msg.hasAttachments || msg.isFlagged || msg.importance === 'high') && (
                              <div className="flex items-center gap-1.5 mt-1">
                                {msg.hasAttachments && (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] text-rmpg-400 bg-rmpg-700/50 px-1.5 py-0.5 rounded-sm border border-rmpg-600/30">
                                    <Paperclip className="w-2.5 h-2.5" /> Attachment
                                  </span>
                                )}
                                {msg.isFlagged && (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] text-yellow-400 bg-yellow-900/20 px-1.5 py-0.5 rounded-sm border border-yellow-700/20">
                                    <Flag className="w-2.5 h-2.5" /> Flagged
                                  </span>
                                )}
                                {msg.importance === 'high' && (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded-sm border border-red-700/20">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Important
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Hover quick actions */}
                          <div className="flex-shrink-0 flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={e => { e.stopPropagation(); handleArchive(msg); }} className="p-1 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm" title="Archive"><Archive className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={e => { e.stopPropagation(); handleToggleRead(msg); }} className="p-1 text-rmpg-500 hover:text-white hover:bg-rmpg-700/50 rounded-sm" title={msg.isRead ? 'Mark unread' : 'Mark read'}>
                              {msg.isRead ? <MailOpen className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={e => { e.stopPropagation(); handleDelete(msg); }} className="p-1 text-rmpg-500 hover:text-red-400 hover:bg-red-900/20 rounded-sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                );
              })}
              {hasMore && (
                <button type="button" onClick={() => fetchMessages(page + 1, selectedFolder, search)} disabled={loadingMore} className="w-full py-2 text-[10px] text-brand-400 hover:text-brand-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  {loadingMore ? <><Loader2 size={10} className="animate-spin" /> Loading...</> : 'Load more...'}</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Resize Handle ─── */}
      <div className="w-1 flex-shrink-0 cursor-col-resize hover:bg-brand-500/30 active:bg-brand-500/50 transition-colors hidden md:block hover:w-1.5"
        onMouseDown={() => { resizingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }} />

      {/* ─── Reading Pane ─── */}
      <div className={`flex-1 flex flex-col bg-surface-sunken overflow-hidden ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {fullMessage ? (
          <>
            {/* Message Header */}
            <div className="border-b border-border-subtle bg-surface-base">
              {/* Subject + back button */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <button type="button" onClick={() => { setSelectedMessage(null); setFullMessage(null); setMobileView('list'); }} className="md:hidden p-1 text-rmpg-400 hover:text-white flex-shrink-0"><ChevronLeft className="w-4 h-4" /></button>
                <h2 className="text-sm font-semibold text-white flex-1 truncate">{fullMessage.subject || '(no subject)'}</h2>
                {fullMessage.importance === 'high' && (
                  <span className="text-[8px] px-1.5 py-0.5 bg-red-900/20 text-red-400 rounded-sm font-bold uppercase flex-shrink-0 border border-red-700/20 tracking-wider">Important</span>
                )}
              </div>

              {/* Sender info with avatar */}
              {(() => {
                const senderKey = (fullMessage.fromAddress || '').toLowerCase();
                const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1','#14b8a6','#f97316'];
                const avatarColor = AVATAR_COLORS[Math.abs([...senderKey].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length];
                return (
                  <div className="flex items-start gap-3 px-4 pb-2">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: avatarColor + '20', color: avatarColor }}>
                      {(fullMessage.fromName || fullMessage.fromAddress).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-white font-semibold">{fullMessage.fromName || fullMessage.fromAddress}</span>
                        <span className="text-[10px] text-rmpg-500">&lt;{fullMessage.fromAddress}&gt;</span>
                      </div>
                      <div className="text-[10px] text-rmpg-500 mt-0.5">
                        {new Date(fullMessage.receivedAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                      {fullMessage.toAddresses.length > 0 && (
                        <div className="text-[10px] text-rmpg-500 mt-0.5 truncate">
                          <span className="text-rmpg-600">To:</span> {fullMessage.toAddresses.map(a => a.name || a.email).join(', ')}
                        </div>
                      )}
                      {fullMessage.ccAddresses.length > 0 && (
                        <div className="text-[10px] text-rmpg-500 truncate">
                          <span className="text-rmpg-600">CC:</span> {fullMessage.ccAddresses.map(a => a.name || a.email).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Action Bar */}
              <div className="flex items-center gap-1 px-4 py-1.5 border-t border-border-subtle/50 bg-surface-sunken/30">
                <button type="button" onClick={() => setComposing('reply')} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-brand-400 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 rounded-sm transition-colors">
                  <Reply className="w-3 h-3" /> Reply
                </button>
                <button type="button" onClick={() => setComposing('reply-all')} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-rmpg-300 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors">
                  <ReplyAll className="w-3 h-3" /> Reply All
                </button>
                <button type="button" onClick={() => setComposing('forward')} className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-rmpg-300 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors">
                  <Forward className="w-3 h-3" /> Forward
                </button>
                <div className="w-px h-4 bg-rmpg-700 mx-1" />
                <button type="button" onClick={() => selectedMessage && handleArchive(selectedMessage)} className="p-1.5 text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Archive"><Archive className="w-3.5 h-3.5" /></button>
                <MoveToFolderDropdown folders={folders} currentFolder={selectedFolder} onMove={handleMoveToFolder} />
                <div className="flex-1" />
                <button type="button" onClick={() => selectedMessage && handleToggleRead(selectedMessage)} className="p-1.5 text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Toggle read">
                  {selectedMessage?.isRead ? <MailOpen className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => selectedMessage && handleToggleFlag(selectedMessage)} className="p-1.5 hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Toggle flag">
                  <Flag className={`w-3.5 h-3.5 ${selectedMessage?.isFlagged ? 'text-yellow-400 fill-yellow-400' : 'text-rmpg-400 hover:text-yellow-400'}`} />
                </button>
                <button type="button" onClick={() => fullMessage && printEmail(fullMessage, fullMessage.bodyHtml)} className="p-1.5 text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 rounded-sm transition-colors" title="Print"><Printer className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => selectedMessage && handleDelete(selectedMessage)} className="p-1.5 text-rmpg-400 hover:text-red-400 hover:bg-red-900/20 rounded-sm transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="px-4 py-2 border-t border-border-subtle/50">
                  <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5" style={{ letterSpacing: '0.1em' }}>
                    Attachments ({attachments.filter(a => !a.isInline).length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {attachments.filter(a => !a.isInline).map(att => {
                      const ext = att.name.split('.').pop()?.toLowerCase() || '';
                      const isImage = ['jpg','jpeg','png','gif','webp','bmp'].includes(ext);
                      const isPdf = ext === 'pdf';
                      const isDoc = ['doc','docx','rtf','odt'].includes(ext);
                      const isSheet = ['xls','xlsx','csv'].includes(ext);
                      const fileColor = isImage ? '#06b6d4' : isPdf ? '#ef4444' : isDoc ? '#3b82f6' : isSheet ? '#10b981' : '#8b5cf6';
                      return (
                        <a key={att.id} href={`/api/email/messages/${selectedMessage!.id}/attachments/${att.id}`} target="_blank" rel="noopener"
                          className="flex items-center gap-2 px-3 py-2 bg-surface-sunken border border-border-subtle rounded-sm text-[10px] text-rmpg-300 hover:text-white hover:border-brand-500/40 transition-all hover:shadow-lg group min-w-[140px]">
                          <div className="w-8 h-8 rounded-sm flex items-center justify-center text-[8px] font-bold uppercase flex-shrink-0"
                            style={{ backgroundColor: fileColor + '15', color: fileColor }}>
                            {ext.slice(0, 4)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate max-w-[140px] text-[10px] font-medium">{att.name}</div>
                            <div className="text-[9px] text-rmpg-500">{formatSize(att.size)}</div>
                          </div>
                          <Download className="w-3.5 h-3.5 text-rmpg-500 group-hover:text-brand-400 transition-colors flex-shrink-0" />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Case Links */}
              <EmailIncidentLinks emailId={fullMessage.id} onSnackbar={showSnackbar} />
            </div>

            {/* Message Body */}
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
              {loadingMessage ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" role="status" aria-label="Loading" /><span className="text-[10px] text-rmpg-500">Loading data...</span></div>
              ) : fullMessage.bodyHtml ? (
                <EmailBodyFrame ref={iframeRef} bodyHtml={fullMessage.bodyHtml} onLoad={handleIframeLoad} />
              ) : (
                <div className="p-4 text-xs text-rmpg-400 whitespace-pre-wrap font-mono">{fullMessage.bodyPreview}</div>
              )}
            </div>

            {/* Inline Quick Reply */}
            <InlineReply messageId={fullMessage.id} onSent={() => { showSnackbar('Reply sent'); handleRefresh(); }} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-xs">
              <div className="w-16 h-16 mx-auto rounded-full bg-brand-500/10 flex items-center justify-center border border-brand-500/15">
                <Mail className="w-8 h-8 text-brand-500/40" />
              </div>
              <div>
                <p className="text-sm text-rmpg-400 font-medium">Select an email to read</p>
                <p className="text-[10px] text-rmpg-600 mt-1">Click any message in the list, or compose a new one</p>
              </div>
              <button type="button" onClick={() => setComposing('new')} className="btn-primary text-xs px-4 py-1.5 inline-flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Compose New
              </button>
              <div className="text-[9px] text-rmpg-600 space-y-0.5 pt-2">
                <div className="font-mono">Ctrl+N <span className="text-rmpg-500">Compose</span> • Ctrl+R <span className="text-rmpg-500">Reply</span></div>
                <div className="font-mono">Ctrl+F <span className="text-rmpg-500">Forward</span> • ↑↓ <span className="text-rmpg-500">Navigate</span></div>
                <div className="font-mono">Del <span className="text-rmpg-500">Delete</span> • Right-click <span className="text-rmpg-500">More</span></div>
              </div>
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
