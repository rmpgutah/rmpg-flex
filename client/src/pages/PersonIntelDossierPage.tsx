// client/src/pages/PersonIntelDossierPage.tsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search, ArrowLeft, Loader2, AlertTriangle, CheckCircle2, Clock,
  Shield, MapPin, Phone, Mail, Car, User, Globe, Briefcase, Gavel,
  Network, ChevronDown, ChevronRight, ExternalLink, Flag
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import PersonIntelGraphTab from './PersonIntelGraphTab';

interface DataPoint {
  id: number;
  category: string;
  field: string;
  value: string;
  sources: string;
  confidence: number;
  officer_note: string | null;
  officer_flagged: number;
  promoted: number;
}

interface Connection {
  id: number;
  from_subject: string;
  relationship: string;
  to_subject: string;
  confidence: number;
  sources: string;
}

interface SourceResult {
  id: number;
  source_name: string;
  phase: number;
  status: string;
  response_time_ms: number;
  data_points_found: number;
  error_message: string | null;
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
  sources_queried: number;
  sources_succeeded: number;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  dataPoints: DataPoint[];
  connections: Connection[];
  sources: SourceResult[];
}

const CATEGORY_ICON: Record<string, React.ElementType> = {
  address: MapPin, phone: Phone, email: Mail, vehicle: Car,
  associate: User, social: Globe, business: Briefcase, legal: Gavel,
  online: Globe,
};

const CATEGORY_LABEL: Record<string, string> = {
  address: 'Addresses', phone: 'Phone Numbers', email: 'Email Addresses',
  vehicle: 'Vehicles', associate: 'Associates', social: 'Social Profiles',
  business: 'Business', legal: 'Legal Records', online: 'Online Presence',
};

function ConfidencePill({ conf }: { conf: number }) {
  if (conf >= 0.80) return <span className="text-[10px] text-green-400 border border-green-400/30 rounded px-1">VERIFIED</span>;
  if (conf >= 0.60) return <span className="text-[10px] text-blue-400 border border-blue-400/30 rounded px-1">PROBABLE</span>;
  if (conf >= 0.40) return <span className="text-[10px] text-amber-400 border border-amber-400/30 rounded px-1">POSSIBLE</span>;
  return <span className="text-[10px] text-rmpg-500 border border-rmpg-700 rounded px-1">LOW</span>;
}

function PhaseBar({ phase, status }: { phase: number; status: string }) {
  const phases = ['Internal Records', 'OSINT APIs', 'Web Crawl'];
  return (
    <div className="flex gap-1 items-center">
      {phases.map((label, i) => {
        const idx = i + 1;
        const done = phase > idx || status === 'complete';
        const active = phase === idx && status === 'running';
        return (
          <div key={label} className="flex items-center gap-1">
            <div className={`h-1.5 w-16 rounded-full ${done ? 'bg-green-500' : active ? 'bg-blue-400 animate-pulse' : 'bg-rmpg-700'}`} />
            <span className={`text-[9px] ${done ? 'text-green-400' : active ? 'text-blue-400' : 'text-rmpg-600'}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function PersonIntelDossierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'data' | 'sources' | 'connections' | 'graph'>('data');
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Dossier>(`/person-intel/${id}`);
      setDossier(data);
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(pollRef.current);
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
      clearInterval(pollRef.current);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const annotate = async (dpId: number, patch: Record<string, any>) => {
    await apiFetch(`/person-intel/${id}/data-point/${dpId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await load();
  };

  if (loading && !dossier) return (
    <div className="p-4 flex items-center gap-2 text-rmpg-400 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" />Loading dossier…
    </div>
  );
  if (error) return (
    <div className="p-4 text-red-400 text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4" />{error}
    </div>
  );
  if (!dossier) return null;

  const riskFlags: string[] = dossier.risk_flags ? JSON.parse(dossier.risk_flags) : [];
  const grouped = new Map<string, DataPoint[]>();
  for (const dp of dossier.dataPoints) {
    if (!grouped.has(dp.category)) grouped.set(dp.category, []);
    grouped.get(dp.category)!.push(dp);
  }

  // Filter noise (< 0.40)
  for (const [cat, pts] of grouped) {
    const filtered = pts.filter(p => p.confidence >= 0.40);
    if (filtered.length === 0) grouped.delete(cat);
    else grouped.set(cat, filtered);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/person-intel')} className="text-rmpg-500 hover:text-rmpg-300">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <PanelTitleBar title={`DOSSIER: ${dossier.subject_name.toUpperCase()}`} icon={Search} />
      </div>

      {/* Status bar */}
      <div className="bg-surface-raised rounded p-3 space-y-2">
        <div className="flex items-center gap-3">
          {dossier.status === 'running' ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          ) : dossier.status === 'complete' ? (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-xs font-semibold text-rmpg-100">
            {dossier.status === 'running' ? 'Investigating…' : dossier.status === 'complete' ? 'Investigation Complete' : 'Error'}
          </span>
          {dossier.risk_score > 0 && (
            <span className={`text-xs font-bold ml-auto ${dossier.risk_score >= 70 ? 'text-red-400' : dossier.risk_score >= 40 ? 'text-amber-400' : 'text-blue-400'}`}>
              Risk: {dossier.risk_score}
            </span>
          )}
        </div>
        <PhaseBar phase={dossier.phase} status={dossier.status} />
        {riskFlags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {riskFlags.map(f => (
              <span key={f} className="text-[10px] bg-red-600/20 text-red-400 border border-red-600/40 rounded px-1.5 py-0.5">
                {f.toUpperCase().replace('_', ' ')}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-4 text-[10px] text-rmpg-500">
          <span>{dossier.data_points_found} data points</span>
          <span>{dossier.sources_succeeded}/{dossier.sources_queried} sources</span>
          {dossier.linked_person_id && (
            <span className="text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5" />Linked to Person #{dossier.linked_person_id}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />{new Date(dossier.created_at).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rmpg-800">
        {(['data', 'sources', 'connections', 'graph'] as const).map(tab => (
          <button
            key={tab}
            className={`text-xs px-3 py-1.5 capitalize border-b-2 -mb-px transition-colors ${activeTab === tab ? 'border-brand-400 text-brand-400' : 'border-transparent text-rmpg-500 hover:text-rmpg-300'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'data' ? `Data Points (${dossier.dataPoints.filter(p => p.confidence >= 0.40).length})` :
             tab === 'sources' ? `Sources (${dossier.sources.length})` :
             tab === 'connections' ? `Connections (${dossier.connections.length})` :
             `Graph`}
          </button>
        ))}
      </div>

      {activeTab === 'data' && (
        <div className="space-y-2">
          {grouped.size === 0 && dossier.status !== 'complete' ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Gathering intelligence…
            </div>
          ) : grouped.size === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">No data points found above confidence threshold</div>
          ) : (
            Array.from(grouped.entries()).map(([cat, pts]) => {
              const Icon = CATEGORY_ICON[cat] ?? Globe;
              const isOpen = activeCategory === cat || activeCategory === null;
              return (
                <div key={cat} className="bg-surface-raised rounded overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-overlay"
                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                  >
                    <Icon className="w-3.5 h-3.5 text-brand-400" />
                    <span className="text-xs font-semibold text-rmpg-200">{CATEGORY_LABEL[cat] ?? cat}</span>
                    <span className="text-[10px] text-rmpg-500 ml-1">({pts.length})</span>
                    <span className="ml-auto">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-500" /> : <ChevronRight className="w-3.5 h-3.5 text-rmpg-500" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-rmpg-800">
                      {pts.sort((a, b) => b.confidence - a.confidence).map(dp => {
                        const srcs: string[] = JSON.parse(dp.sources);
                        return (
                          <div key={dp.id} className={`flex items-start gap-2 px-3 py-2 border-b border-rmpg-800/50 ${dp.officer_flagged ? 'bg-red-600/5' : dp.promoted ? 'bg-green-600/5' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-rmpg-100 font-medium">{dp.value}</span>
                                <ConfidencePill conf={dp.confidence} />
                              </div>
                              <div className="text-[10px] text-rmpg-500 mt-0.5">
                                {dp.field} · {srcs.join(', ')} · {(dp.confidence * 100).toFixed(0)}%
                              </div>
                              {dp.officer_note && (
                                <div className="text-[10px] text-amber-400 mt-0.5">Note: {dp.officer_note}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                title={dp.officer_flagged ? 'Unflag' : 'Flag'}
                                className={`p-0.5 rounded ${dp.officer_flagged ? 'text-red-400' : 'text-rmpg-600 hover:text-red-400'}`}
                                onClick={() => annotate(dp.id, { officer_flagged: !dp.officer_flagged })}
                              >
                                <Flag className="w-3 h-3" />
                              </button>
                              <button
                                title={dp.promoted ? 'Demote' : 'Promote'}
                                className={`p-0.5 rounded ${dp.promoted ? 'text-green-400' : 'text-rmpg-600 hover:text-green-400'}`}
                                onClick={() => annotate(dp.id, { promoted: !dp.promoted })}
                              >
                                <CheckCircle2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'sources' && (
        <div className="space-y-1">
          {dossier.sources.map(s => (
            <div key={s.id} className="bg-surface-raised rounded px-3 py-2 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === 'success' ? 'bg-green-400' : s.status === 'not_configured' ? 'bg-rmpg-600' : s.status === 'skipped' ? 'bg-rmpg-600' : 'bg-red-400'}`} />
              <span className="text-xs text-rmpg-200 flex-1">{s.source_name}</span>
              <span className={`text-[10px] ${s.status === 'success' ? 'text-green-400' : s.status === 'not_configured' || s.status === 'skipped' ? 'text-rmpg-500' : 'text-red-400'}`}>{s.status}</span>
              <span className="text-[10px] text-rmpg-600">{s.data_points_found} pts</span>
              <span className="text-[10px] text-rmpg-600">{s.response_time_ms}ms</span>
              <span className="text-[10px] text-rmpg-700">Ph{s.phase}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'connections' && (
        <div className="space-y-1">
          {dossier.connections.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">
              <Network className="w-5 h-5 mx-auto mb-2" />
              No connections found — graph will populate once OSINT sources respond
            </div>
          ) : (
            dossier.connections.map(c => (
              <div key={c.id} className="bg-surface-raised rounded px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-rmpg-100 font-medium">{c.from_subject}</span>
                  <span className="text-rmpg-500">—{c.relationship}→</span>
                  <span className="text-rmpg-100 font-medium">{c.to_subject}</span>
                  <ConfidencePill conf={c.confidence} />
                </div>
                <div className="text-[10px] text-rmpg-500 mt-0.5">
                  {JSON.parse(c.sources).join(', ')}
                </div>
              </div>
            ))
          )}
          {dossier.connections.length > 0 && (
            <div className="text-xs text-rmpg-500 text-center pt-2">
              Switch to Graph tab for visual connections view
            </div>
          )}
        </div>
      )}

      {activeTab === 'graph' && (
        <PersonIntelGraphTab
          subjectName={dossier.subject_name}
          connections={dossier.connections}
        />
      )}
    </div>
  );
}
