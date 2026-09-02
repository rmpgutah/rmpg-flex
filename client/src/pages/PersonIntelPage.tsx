// client/src/pages/PersonIntelPage.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search, Plus, Clock, AlertTriangle, CheckCircle2, Loader2, ChevronRight, User } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { formatDate } from '../utils/dateUtils';
import { formatEnumValue } from '../utils/formatters';

interface IntelSeed {
  name?: string;
  dob?: string;
  age?: string;
  phone?: string;
  email?: string;
  plate?: string;
  address?: string;
  city?: string;
  state?: string;
}

interface Dossier {
  id: number;
  subject_name: string;
  subject_dob: string | null;
  status: 'pending' | 'running' | 'complete' | 'error';
  phase: number;
  risk_score: number;
  risk_flags: string | null;
  linked_person_id: number | null;
  data_points_found: number;
  cross_refs_found?: number;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-rmpg-400',
  running: 'text-blue-400',
  complete: 'text-green-400',
  error: 'text-red-400',
};

const PHASE_LABEL = ['—', 'Phase 1: Internal', 'Phase 2: OSINT', 'Phase 3: Webcrawl'];

function RiskBadge({ score }: { score: number }) {
  if (score >= 70) return <span className="text-[10px] bg-red-600/20 text-red-400 border border-red-600/40 rounded px-1.5 py-0.5">HIGH {score}</span>;
  if (score >= 40) return <span className="text-[10px] bg-amber-600/20 text-amber-400 border border-amber-600/40 rounded px-1.5 py-0.5">MED {score}</span>;
  if (score > 0) return <span className="text-[10px] bg-blue-600/20 text-blue-400 border border-blue-600/40 rounded px-1.5 py-0.5">LOW {score}</span>;
  return null;
}

export default function PersonIntelPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { addToast } = useToast();

  const canCreate = ['admin', 'manager'].includes(user?.role ?? '');
  const canDelete = ['admin', 'manager'].includes(user?.role ?? '');

  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [seed, setSeed] = useState<IntelSeed>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Delete confirm ──
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Deep-link: ?person_id= | ?subject= ──
  // Read once on mount; strip immediately so URL stays clean.
  const deepLinkIdRef = useRef<number | null>(null);
  const deepLinkSubjectRef = useRef<string | null>(null);
  const deepLinkHandledRef = useRef(false);
  const rowRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const [highlightId, setHighlightId] = useState<number | null>(null);

  useEffect(() => {
    const personId = searchParams.get('person_id');
    const subject = searchParams.get('subject');
    const dirty = searchParams.has('person_id') || searchParams.has('subject');
    if (personId) deepLinkIdRef.current = Number(personId);
    if (subject) deepLinkSubjectRef.current = subject;
    if (dirty) {
      const next = new URLSearchParams(searchParams);
      next.delete('person_id');
      next.delete('subject');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Dossier[]>('/person-intel');
      setDossiers(data ?? []);
      setHasLoaded(true);

      // Hydrate deep-link after data arrives
      if (!deepLinkHandledRef.current) {
        deepLinkHandledRef.current = true;
        const targetId = deepLinkIdRef.current;
        const targetSubject = deepLinkSubjectRef.current;
        if (targetId !== null) {
          const found = (data ?? []).find(d => d.id === targetId);
          if (found) {
            setHighlightId(found.id);
            addToast(`Jumped to: ${found.subject_name}`, 'info');
          } else {
            addToast('Investigation not found or not accessible', 'warning');
          }
        } else if (targetSubject) {
          setSearchQuery(targetSubject);
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  // Scroll highlighted row into view
  useEffect(() => {
    if (highlightId === null) return;
    const row = rowRefs.current.get(highlightId);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // ── N shortcut — open new investigation form or focus search ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (deleteTargetId !== null) { setDeleteTargetId(null); return; }
        if (showForm) { setShowForm(false); setSeed({}); setNotes(''); setError(null); return; }
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (deleteTargetId !== null) return;
        e.preventDefault();
        if (!canCreate) {
          addToast('Insufficient permissions to create an investigation', 'warning');
          return;
        }
        if (showForm) {
          searchInputRef.current?.focus();
        } else {
          setShowForm(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showForm, deleteTargetId, canCreate, addToast]);

  const submit = async () => {
    const hasSeed = Object.values(seed).some(v => v?.trim());
    if (!hasSeed) { setError('Enter at least one identifier'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; dossierId: number }>('/person-intel', {
        method: 'POST',
        body: JSON.stringify({ seed, notes }),
      });
      navigate(`/person-intel/${res.dossierId}`);
    } catch (e: any) {
      setError(e.message ?? 'Failed to start investigation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId === null) return;
    setDeleting(true);
    try {
      await apiFetch(`/person-intel/${deleteTargetId}`, { method: 'DELETE' });
      setDossiers(prev => prev.filter(d => d.id !== deleteTargetId));
      addToast('Investigation deleted', 'success');
    } catch (e: any) {
      addToast(e.message ?? 'Failed to delete investigation', 'error');
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  };

  const deleteTarget = dossiers.find(d => d.id === deleteTargetId);

  // ── Filtered list ──
  const filtered = searchQuery.trim()
    ? dossiers.filter(d =>
        d.subject_name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : dossiers;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PanelTitleBar title="PERSON INTELLIGENCE" icon={Search} />
        {canCreate && (
          <button
            className="ml-auto flex items-center gap-1 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded px-3 py-1.5"
            onClick={() => setShowForm(v => !v)}
          >
            <Plus className="w-3.5 h-3.5" />
            New Investigation
          </button>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/30 rounded p-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-surface-raised rounded p-4 space-y-3 border border-border-default">
          <p className="text-xs font-semibold text-rmpg-200">New OSINT Investigation — name plus DOB or age is required to auto-link records</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'name', label: 'Full Name', placeholder: 'John Doe' },
              { key: 'dob', label: 'Date of Birth', placeholder: '10/11/2001 or YYYY-MM-DD' },
              { key: 'age', label: 'Age', placeholder: '24' },
              { key: 'city', label: 'City', placeholder: 'Salt Lake City' },
              { key: 'state', label: 'State', placeholder: 'UT' },
              { key: 'address', label: 'Address', placeholder: 'Residential address' },
              { key: 'phone', label: 'Phone', placeholder: '8015551234' },
              { key: 'email', label: 'Email', placeholder: 'john@example.com' },
              { key: 'plate', label: 'License Plate', placeholder: 'ABC123' },
            ].map(f => (
              <div key={f.key} className={f.key === 'name' || f.key === 'address' ? 'col-span-2' : ''}>
                <label className="block text-[10px] text-rmpg-400 mb-0.5">{f.label}</label>
                <input
                  type="text"
                  placeholder={f.placeholder}
                  className="w-full text-xs bg-surface-base border border-rmpg-700 rounded px-2 py-1 text-rmpg-100 placeholder-rmpg-600 focus:outline-none focus:border-brand-400"
                  value={(seed as any)[f.key] ?? ''}
                  onChange={e => setSeed(s => ({ ...s, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Notes (optional)</label>
              <textarea
                rows={2}
                className="w-full text-xs bg-surface-base border border-rmpg-700 rounded px-2 py-1 text-rmpg-100 placeholder-rmpg-600 focus:outline-none focus:border-brand-400 resize-none"
                placeholder="Reason for investigation, incident #, etc."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="text-xs text-rmpg-400 hover:text-rmpg-200 px-3 py-1"
              onClick={() => { setShowForm(false); setSeed({}); setNotes(''); setError(null); }}
            >Cancel</button>
            <button
              disabled={submitting}
              className="text-xs bg-brand-600 hover:bg-brand-500 text-white rounded px-4 py-1 disabled:opacity-50 flex items-center gap-1"
              onClick={submit}
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              {submitting ? 'Starting…' : 'Launch Investigation'}
            </button>
          </div>
        </div>
      )}

      {/* Search bar — only show once data has loaded and there are rows */}
      {hasLoaded && dossiers.length > 0 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search investigations…"
            className="w-full text-xs bg-surface-raised border border-rmpg-700 rounded pl-8 pr-3 py-1.5 text-rmpg-100 placeholder-rmpg-600 focus:outline-none focus:border-brand-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-rmpg-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading investigations…
        </div>
      ) : !hasLoaded ? null : dossiers.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <User className="w-8 h-8 text-rmpg-600 mx-auto" />
          <p className="text-sm text-rmpg-400">No investigations yet</p>
          <p className="text-xs text-rmpg-600">
            {canCreate ? 'Start a new investigation using the button above' : 'No investigations have been started'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Search className="w-8 h-8 text-rmpg-600 mx-auto" />
          <p className="text-sm text-rmpg-400">No results for "{searchQuery}"</p>
          <p className="text-xs text-rmpg-600">Try a different name</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(d => {
            const flags: string[] = d.risk_flags ? JSON.parse(d.risk_flags) : [];
            return (
              <div key={d.id} className="relative group">
                <button
                  ref={el => { rowRefs.current.set(d.id, el); }}
                  className={`w-full text-left rounded p-3 flex items-center gap-3 transition-colors ${
                    highlightId === d.id
                      ? 'bg-brand-400/10'
                      : 'bg-surface-raised hover:bg-surface-overlay'
                  }`}
                  onClick={() => navigate(`/person-intel/${d.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-rmpg-100 truncate">{d.subject_name}</span>
                      <RiskBadge score={d.risk_score ?? 0} />
                      {d.linked_person_id && <div title="Linked to person record"><CheckCircle2 className="w-3 h-3 text-green-400" /></div>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {d.status === 'running' ? (
                        <span className="flex items-center gap-1 text-[10px] text-blue-400">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          {PHASE_LABEL[d.phase] ?? 'Running…'}
                        </span>
                      ) : (
                        <span className={`text-[10px] ${STATUS_COLOR[d.status] ?? 'text-rmpg-400'}`}>
                          {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                        </span>
                      )}
                      <span className="text-[10px] text-rmpg-500">{d.data_points_found} data points</span>
                      {!!d.cross_refs_found && (
                        <span className="text-[10px] text-brand-400">{d.cross_refs_found} xrefs</span>
                      )}
                      {flags.slice(0, 3).map(f => (
                        <span key={f} className="text-[10px] text-red-400">{f.toUpperCase()}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-[10px] text-rmpg-500 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDate(d.created_at)}
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-rmpg-600" />
                  </div>
                </button>

                {canDelete && (
                  <button
                    className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-600/40 rounded"
                    onClick={e => { e.stopPropagation(); setDeleteTargetId(d.id); }}
                    aria-label={`Delete investigation for ${d.subject_name}`}
                  >
                    Del
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Investigation"
        message="Permanently delete this investigation and all associated data points?"
        details={deleteTarget && (
          <>
            <div><span className="text-rmpg-400">Subject:</span> {deleteTarget.subject_name}</div>
            <div><span className="text-rmpg-400">Data points:</span> {deleteTarget.data_points_found}</div>
            <div><span className="text-rmpg-400">Status:</span> {formatEnumValue(deleteTarget.status)}</div>
          </>
        )}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
