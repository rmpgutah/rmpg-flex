// client/src/pages/PersonIntelPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Clock, AlertTriangle, CheckCircle2, Loader2, ChevronRight, User } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

interface IntelSeed {
  name?: string;
  dob?: string;
  phone?: string;
  email?: string;
  plate?: string;
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
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [seed, setSeed] = useState<IntelSeed>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Dossier[]>('/person-intel');
      setDossiers(data ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PanelTitleBar title="PERSON INTELLIGENCE" icon={Search} />
        <button
          className="ml-auto flex items-center gap-1 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded px-3 py-1.5"
          onClick={() => setShowForm(v => !v)}
        >
          <Plus className="w-3.5 h-3.5" />
          New Investigation
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/30 rounded p-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-surface-raised rounded p-4 space-y-3 border border-border-default">
          <p className="text-xs font-semibold text-rmpg-200">New OSINT Investigation — enter any known identifiers</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'name', label: 'Full Name', placeholder: 'John Doe' },
              { key: 'dob', label: 'Date of Birth', placeholder: 'YYYY-MM-DD' },
              { key: 'phone', label: 'Phone', placeholder: '8015551234' },
              { key: 'email', label: 'Email', placeholder: 'john@example.com' },
              { key: 'plate', label: 'License Plate', placeholder: 'ABC123' },
            ].map(f => (
              <div key={f.key} className={f.key === 'name' ? 'col-span-2' : ''}>
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

      {loading ? (
        <div className="text-xs text-rmpg-400 p-4 text-center">Loading investigations…</div>
      ) : dossiers.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <User className="w-8 h-8 text-rmpg-600 mx-auto" />
          <p className="text-sm text-rmpg-400">No investigations yet</p>
          <p className="text-xs text-rmpg-600">Start a new investigation using the button above</p>
        </div>
      ) : (
        <div className="space-y-1">
          {dossiers.map(d => {
            const flags: string[] = d.risk_flags ? JSON.parse(d.risk_flags) : [];
            return (
              <button
                key={d.id}
                className="w-full text-left bg-surface-raised hover:bg-surface-overlay rounded p-3 flex items-center gap-3 transition-colors"
                onClick={() => navigate(`/person-intel/${d.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-rmpg-100 truncate">{d.subject_name}</span>
                    <RiskBadge score={d.risk_score ?? 0} />
                    {d.linked_person_id && <CheckCircle2 className="w-3 h-3 text-green-400" title="Linked to person record" />}
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
                    {flags.slice(0, 3).map(f => (
                      <span key={f} className="text-[10px] text-red-400">{f.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] text-rmpg-500 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(d.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-rmpg-600" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
