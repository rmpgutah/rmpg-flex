// ============================================================
// RMPG Flex — CRM Overwatch: Firecrawl Ecosystem Tab
// Scouts, AI-Ready analyzer, Site Cloner, Brand Monitor,
// Page Compare, Workflow builder — all Firecrawl-powered tools
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Radar,
  BrainCircuit,
  Copy,
  Megaphone,
  GitCompareArrows,
  Workflow,
  Plus,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
  Search,
  ArrowRight,
  GripVertical,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';

// ── Shared Types ──────────────────────────────────────────────

type FirecrawlSubTab = 'scouts' | 'ai-ready' | 'cloner' | 'brand' | 'compare' | 'workflows';

interface Scout {
  id: number;
  name: string;
  url: string;
  search_query: string;
  keywords: string;
  check_interval: string;
  notify_email: string;
  status: 'active' | 'paused' | 'error';
  last_run_at: string | null;
  last_run_status: string | null;
  found_count: number;
  created_at: string;
}

interface ScoutRun {
  id: number;
  scout_id: number;
  status: 'success' | 'error' | 'running';
  found_count: number;
  error_message: string | null;
  created_at: string;
}

interface AiReadyResult {
  id: number;
  url: string;
  overall_score: number;
  scores: {
    structured_data: number;
    semantic_html: number;
    content_quality: number;
    performance: number;
    api_availability: number;
    mobile_friendly: number;
    accessibility: number;
    security: number;
  };
  recommendations: string[];
  created_at: string;
}

interface CloneResult {
  id: number;
  url: string;
  title: string;
  links: string[];
  component_tree: string;
  markdown_content: string;
  created_at: string;
}

interface BrandMonitor {
  id: number;
  brand_name: string;
  keywords: string;
  competitor_urls: string;
  check_interval: string;
  status: 'active' | 'paused' | 'error';
  mention_count: number;
  last_scan_at: string | null;
  created_at: string;
}

interface BrandMention {
  id: number;
  monitor_id: number;
  source_url: string;
  snippet: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  found_at: string;
}

interface CompareResult {
  id: number;
  url_a: string;
  url_b: string;
  markdown_a: string;
  markdown_b: string;
  diff_summary: string;
  created_at: string;
}

interface WorkflowStep {
  type: 'scrape' | 'search' | 'extract';
  url_or_query: string;
}

interface WorkflowDef {
  id: number;
  name: string;
  steps: WorkflowStep[];
  status: 'idle' | 'running' | 'error';
  last_run_at: string | null;
  created_at: string;
}

interface WorkflowRun {
  id: number;
  workflow_id: number;
  status: 'success' | 'error' | 'running';
  results: Record<string, unknown>[];
  error_message: string | null;
  created_at: string;
}

// ── Shared Helpers ────────────────────────────────────────────

function fmtDate(d?: string | null): string {
  if (!d) return '\u2014';
  return new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusLed({ status }: { status: string }) {
  const color =
    status === 'active' || status === 'success' || status === 'running'
      ? 'bg-emerald-400'
      : status === 'paused' || status === 'idle'
        ? 'bg-amber-400'
        : 'bg-red-400';
  const pulse = status === 'active' || status === 'running';
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`}
      aria-label={status}
    />
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
      <Icon className="w-8 h-8 mb-2 opacity-40" />
      <span className="text-xs">{message}</span>
    </div>
  );
}

function SmallBtn({
  onClick,
  disabled,
  loading,
  children,
  className = '',
  variant = 'default',
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'danger' | 'primary';
}) {
  const base = 'flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-sm border transition-colors disabled:opacity-40';
  const variants = {
    default: 'border-rmpg-600 bg-rmpg-800 text-rmpg-300 hover:bg-rmpg-700',
    danger: 'border-red-800 bg-red-900/40 text-red-300 hover:bg-red-800/60',
    primary: 'border-brand-600 bg-brand-700/40 text-brand-300 hover:bg-brand-600/60',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${variants[variant]} ${className}`}>
      {loading && <Loader2 className="w-3 h-3 animate-spin" />}
      {children}
    </button>
  );
}

// ── Tab Definitions ───────────────────────────────────────────

const TABS: { id: FirecrawlSubTab; label: string; icon: React.ElementType }[] = [
  { id: 'scouts', label: 'Scouts', icon: Radar },
  { id: 'ai-ready', label: 'AI Ready', icon: BrainCircuit },
  { id: 'cloner', label: 'Site Cloner', icon: Copy },
  { id: 'brand', label: 'Brand Monitor', icon: Megaphone },
  { id: 'compare', label: 'Page Compare', icon: GitCompareArrows },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
];

// ══════════════════════════════════════════════════════════════
// ██ SCOUTS PANEL
// ══════════════════════════════════════════════════════════════

function ScoutsPanel() {
  const { addToast } = useToast();
  const [scouts, setScouts] = useState<Scout[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<ScoutRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Form fields
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formInterval, setFormInterval] = useState('24h');
  const [formEmail, setFormEmail] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Scout[]>('/firecrawl-tools/scouts');
      setScouts(data);
    } catch {
      addToast('Failed to load scouts', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadRuns = useCallback(async (scoutId: number) => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<ScoutRun[]>(`/firecrawl-tools/scouts/${scoutId}/runs`);
      setRuns(data);
    } catch {
      addToast('Failed to load run history', 'error');
    } finally {
      setRunsLoading(false);
    }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setRuns([]);
    } else {
      setExpandedId(id);
      loadRuns(id);
    }
  };

  const createScout = async () => {
    if (!formName.trim() || !formUrl.trim()) {
      addToast('Name and URL are required', 'warning');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/scouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          url: formUrl.trim(),
          search_query: formQuery.trim(),
          keywords: formKeywords.trim(),
          check_interval: formInterval,
          notify_email: formEmail.trim(),
        }),
      });
      addToast('Scout created', 'success');
      setShowForm(false);
      setFormName(''); setFormUrl(''); setFormQuery(''); setFormKeywords(''); setFormInterval('24h'); setFormEmail('');
      load();
    } catch {
      addToast('Failed to create scout', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runScout = async (id: number) => {
    setRunningIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/scouts/${id}/run`, { method: 'POST' });
      addToast('Scout run triggered', 'success');
      load();
      if (expandedId === id) loadRuns(id);
    } catch {
      addToast('Failed to trigger scout run', 'error');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const togglePause = async (scout: Scout) => {
    const newStatus = scout.status === 'active' ? 'paused' : 'active';
    try {
      await apiFetch(`/firecrawl-tools/scouts/${scout.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      addToast(`Scout ${newStatus === 'active' ? 'resumed' : 'paused'}`, 'success');
      load();
    } catch {
      addToast('Failed to update scout', 'error');
    }
  };

  const deleteScout = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/scouts/${id}`, { method: 'DELETE' });
      addToast('Scout deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setRuns([]); }
      load();
    } catch {
      addToast('Failed to delete scout', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Open Scouts" icon={Radar} statusLed="bg-orange-400" ledPulse>
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Scout
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* New Scout Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Name *</label>
              <input
                value={formName} onChange={e => setFormName(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="e.g. SLC Security RFPs"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">URL *</label>
              <input
                value={formUrl} onChange={e => setFormUrl(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="https://example.com/rfps"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Search Query</label>
              <input
                value={formQuery} onChange={e => setFormQuery(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="security guard contract Utah"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Keywords (comma-separated)</label>
              <input
                value={formKeywords} onChange={e => setFormKeywords(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="security, patrol, guard"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Check Interval</label>
              <select
                value={formInterval} onChange={e => setFormInterval(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
              >
                <option value="1h">Every hour</option>
                <option value="6h">Every 6 hours</option>
                <option value="12h">Every 12 hours</option>
                <option value="24h">Daily</option>
                <option value="7d">Weekly</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Notify Email</label>
              <input
                value={formEmail} onChange={e => setFormEmail(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="alerts@rmpgutah.us"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createScout} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create Scout
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Scout List */}
      {scouts.length === 0 ? (
        <EmptyState icon={Radar} message="No scouts configured yet. Create one to start monitoring the web." />
      ) : (
        <div className="space-y-1">
          {scouts.map(scout => (
            <div key={scout.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(scout.id)} className="text-rmpg-400 hover:text-white">
                  {expandedId === scout.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <StatusLed status={scout.status} />
                <span className="text-xs font-medium text-white flex-1 truncate">{scout.name}</span>
                <span className="text-[10px] text-rmpg-500 font-mono truncate max-w-[200px]">{scout.url}</span>
                <span className="text-[10px] text-rmpg-400">{scout.found_count} found</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(scout.last_run_at)}</span>
                <SmallBtn onClick={() => runScout(scout.id)} loading={runningIds.has(scout.id)}>
                  <Play className="w-3 h-3" /> Run
                </SmallBtn>
                <SmallBtn onClick={() => togglePause(scout)}>
                  {scout.status === 'active' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {scout.status === 'active' ? 'Pause' : 'Resume'}
                </SmallBtn>
                <SmallBtn onClick={() => deleteScout(scout.id)} loading={deletingIds.has(scout.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Expanded: Run History */}
              {expandedId === scout.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken px-4 py-2 space-y-1">
                  <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Run History</div>
                  {runsLoading ? (
                    <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                  ) : runs.length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 py-2">No runs yet</div>
                  ) : (
                    runs.map(run => (
                      <div key={run.id} className="flex items-center gap-3 text-[10px] py-0.5">
                        <StatusLed status={run.status} />
                        <span className="text-rmpg-300 font-mono">{fmtDate(run.created_at)}</span>
                        <span className="text-rmpg-400">{run.found_count} found</span>
                        {run.error_message && (
                          <span className="text-red-400 truncate max-w-[300px]">{run.error_message}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ AI-READY PANEL
// ══════════════════════════════════════════════════════════════

const AI_READY_CATEGORIES = [
  { key: 'structured_data', label: 'Structured Data' },
  { key: 'semantic_html', label: 'Semantic HTML' },
  { key: 'content_quality', label: 'Content Quality' },
  { key: 'performance', label: 'Performance' },
  { key: 'api_availability', label: 'API Availability' },
  { key: 'mobile_friendly', label: 'Mobile Friendly' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'security', label: 'Security' },
] as const;

function scoreColor(score: number): string {
  if (score < 40) return 'text-red-400';
  if (score < 70) return 'text-amber-400';
  return 'text-emerald-400';
}

function scoreBarColor(score: number): string {
  if (score < 40) return 'bg-red-500';
  if (score < 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function AiReadyPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AiReadyResult | null>(null);
  const [history, setHistory] = useState<AiReadyResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<AiReadyResult[]>('/firecrawl-tools/ai-ready/history');
      setHistory(data);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const analyze = async () => {
    if (!url.trim()) { addToast('Enter a URL to analyze', 'warning'); return; }
    setAnalyzing(true);
    try {
      const data = await apiFetch<AiReadyResult>('/firecrawl-tools/ai-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('Analysis complete', 'success');
      loadHistory();
    } catch {
      addToast('Analysis failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const viewHistoryItem = (item: AiReadyResult) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="AI-Readiness Analyzer" icon={BrainCircuit} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && analyze()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
        <SmallBtn onClick={analyze} loading={analyzing} variant="primary">
          <Search className="w-3 h-3" /> Analyze
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past scans</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <span className={`text-sm font-bold font-mono ${scoreColor(item.overall_score)}`}>{item.overall_score}</span>
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          {/* Overall Score */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className={`text-4xl font-bold font-mono ${scoreColor(result.overall_score)}`}>
                {result.overall_score}
              </div>
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">Overall</div>
            </div>
            <div className="flex-1 text-[10px] text-rmpg-400 font-mono truncate">{result.url}</div>
          </div>

          {/* Score Bars */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {AI_READY_CATEGORIES.map(cat => {
              const val = result.scores[cat.key as keyof typeof result.scores] ?? 0;
              return (
                <div key={cat.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-rmpg-400 w-28 shrink-0 truncate">{cat.label}</span>
                  <div className="flex-1 h-2 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div className={`h-full ${scoreBarColor(val)} transition-all`} style={{ width: `${val}%` }} />
                  </div>
                  <span className={`text-[10px] font-mono w-7 text-right ${scoreColor(val)}`}>{val}</span>
                </div>
              );
            })}
          </div>

          {/* Recommendations */}
          {result.recommendations && result.recommendations.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Recommendations</div>
              <ul className="space-y-0.5">
                {result.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] text-rmpg-300">
                    <ArrowRight className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!result && !analyzing && (
        <EmptyState icon={BrainCircuit} message="Enter a URL above to analyze its AI-readiness score." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ SITE CLONER PANEL
// ══════════════════════════════════════════════════════════════

function ClonerPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [result, setResult] = useState<CloneResult | null>(null);
  const [history, setHistory] = useState<CloneResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<CloneResult[]>('/firecrawl-tools/clones');
      setHistory(data);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const clone = async () => {
    if (!url.trim()) { addToast('Enter a URL to clone', 'warning'); return; }
    setCloning(true);
    try {
      const data = await apiFetch<CloneResult>('/firecrawl-tools/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('Site cloned successfully', 'success');
      loadHistory();
    } catch {
      addToast('Clone failed', 'error');
    } finally {
      setCloning(false);
    }
  };

  const loadClone = async (id: number) => {
    try {
      const data = await apiFetch<CloneResult>(`/firecrawl-tools/clones/${id}`);
      setResult(data);
      setUrl(data.url);
      setShowHistory(false);
    } catch {
      addToast('Failed to load clone', 'error');
    }
  };

  const deleteClone = async (id: number) => {
    try {
      await apiFetch(`/firecrawl-tools/clones/${id}`, { method: 'DELETE' });
      addToast('Clone deleted', 'success');
      if (result?.id === id) setResult(null);
      loadHistory();
    } catch {
      addToast('Failed to delete clone', 'error');
    }
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Site Cloner" icon={Copy} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && clone()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://competitor-site.com"
        />
        <SmallBtn onClick={clone} loading={cloning} variant="primary">
          <Copy className="w-3 h-3" /> Clone
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No clones yet</div>
          ) : (
            history.map(item => (
              <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0">
                <button onClick={() => loadClone(item.id)} className="flex-1 flex items-center gap-2 text-left">
                  <Globe className="w-3 h-3 text-orange-400 shrink-0" />
                  <span className="text-[10px] text-white truncate">{item.title || item.url}</span>
                  <span className="text-[10px] text-rmpg-500 ml-auto shrink-0">{fmtDate(item.created_at)}</span>
                </button>
                <SmallBtn onClick={() => deleteClone(item.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>
            ))
          )}
        </div>
      )}

      {/* Clone Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-orange-400 shrink-0" />
            <span className="text-xs font-medium text-white truncate">{result.title || 'Untitled'}</span>
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-rmpg-400 hover:text-orange-400">
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Links */}
          {result.links && result.links.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                Links ({result.links.length})
              </div>
              <div className="max-h-32 overflow-y-auto scrollbar-dark space-y-0.5">
                {result.links.map((link, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <ExternalLink className="w-2.5 h-2.5 text-rmpg-600 shrink-0" />
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-brand-400 hover:underline truncate font-mono"
                    >
                      {link}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Component Tree */}
          {result.component_tree && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Structure</div>
              <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-2 text-[10px] text-rmpg-300 font-mono max-h-40 overflow-auto scrollbar-dark whitespace-pre-wrap">
                {result.component_tree}
              </pre>
            </div>
          )}

          {/* Markdown Preview */}
          <div>
            <button
              onClick={() => setShowMarkdown(!showMarkdown)}
              className="flex items-center gap-1 text-[10px] font-bold text-rmpg-400 uppercase tracking-wider hover:text-orange-400"
            >
              {showMarkdown ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Markdown Content
            </button>
            {showMarkdown && (
              <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-2 mt-1 text-[10px] text-rmpg-300 font-mono max-h-64 overflow-auto scrollbar-dark whitespace-pre-wrap">
                {result.markdown_content || 'No content extracted'}
              </pre>
            )}
          </div>
        </div>
      )}

      {!result && !cloning && (
        <EmptyState icon={Copy} message="Enter a URL to clone its structure and content as markdown." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ BRAND MONITOR PANEL
// ══════════════════════════════════════════════════════════════

function BrandMonitorPanel() {
  const { addToast } = useToast();
  const [monitors, setMonitors] = useState<BrandMonitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [scanningIds, setScanningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Form
  const [formBrand, setFormBrand] = useState('');
  const [formKeywords, setFormKeywords] = useState('');
  const [formCompetitors, setFormCompetitors] = useState('');
  const [formInterval, setFormInterval] = useState('24h');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<BrandMonitor[]>('/firecrawl-tools/brand-monitors');
      setMonitors(data);
    } catch {
      addToast('Failed to load brand monitors', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadMentions = useCallback(async (monitorId: number) => {
    setMentionsLoading(true);
    try {
      const data = await apiFetch<BrandMention[]>(`/firecrawl-tools/brand-monitor/${monitorId}/mentions`);
      setMentions(data);
    } catch {
      addToast('Failed to load mentions', 'error');
    } finally {
      setMentionsLoading(false);
    }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setMentions([]);
    } else {
      setExpandedId(id);
      loadMentions(id);
    }
  };

  const createMonitor = async () => {
    if (!formBrand.trim()) { addToast('Brand name is required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/brand-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: formBrand.trim(),
          keywords: formKeywords.trim(),
          competitor_urls: formCompetitors.trim(),
          check_interval: formInterval,
        }),
      });
      addToast('Brand monitor created', 'success');
      setShowForm(false);
      setFormBrand(''); setFormKeywords(''); setFormCompetitors(''); setFormInterval('24h');
      load();
    } catch {
      addToast('Failed to create monitor', 'error');
    } finally {
      setSaving(false);
    }
  };

  const scanNow = async (id: number) => {
    setScanningIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/brand-monitor/${id}/scan`, { method: 'POST' });
      addToast('Scan triggered', 'success');
      load();
      if (expandedId === id) loadMentions(id);
    } catch {
      addToast('Scan failed', 'error');
    } finally {
      setScanningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteMonitor = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/brand-monitor/${id}`, { method: 'DELETE' });
      addToast('Monitor deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setMentions([]); }
      load();
    } catch {
      addToast('Failed to delete monitor', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const sentimentColor = (s: string) =>
    s === 'positive' ? 'text-emerald-400' : s === 'negative' ? 'text-red-400' : 'text-rmpg-400';

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Brand Monitor" icon={Megaphone} statusLed="bg-orange-400" ledPulse>
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Monitor
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Brand Name *</label>
              <input
                value={formBrand} onChange={e => setFormBrand(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="Rocky Mountain Protective Group"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Keywords (comma-separated)</label>
              <input
                value={formKeywords} onChange={e => setFormKeywords(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="RMPG, rmpgutah, security patrol"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Competitor URLs (one per line)</label>
              <textarea
                value={formCompetitors} onChange={e => setFormCompetitors(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none"
                rows={2}
                placeholder="https://competitor1.com&#10;https://competitor2.com"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Check Interval</label>
              <select
                value={formInterval} onChange={e => setFormInterval(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
              >
                <option value="6h">Every 6 hours</option>
                <option value="12h">Every 12 hours</option>
                <option value="24h">Daily</option>
                <option value="7d">Weekly</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createMonitor} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create Monitor
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Monitor List */}
      {monitors.length === 0 ? (
        <EmptyState icon={Megaphone} message="No brand monitors yet. Create one to track mentions across the web." />
      ) : (
        <div className="space-y-1">
          {monitors.map(mon => (
            <div key={mon.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(mon.id)} className="text-rmpg-400 hover:text-white">
                  {expandedId === mon.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <StatusLed status={mon.status} />
                <span className="text-xs font-medium text-white flex-1 truncate">{mon.brand_name}</span>
                <span className="text-[10px] text-orange-400 font-mono">{mon.mention_count} mentions</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(mon.last_scan_at)}</span>
                <SmallBtn onClick={() => scanNow(mon.id)} loading={scanningIds.has(mon.id)}>
                  <Play className="w-3 h-3" /> Scan
                </SmallBtn>
                <SmallBtn onClick={() => deleteMonitor(mon.id)} loading={deletingIds.has(mon.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Expanded: Mentions */}
              {expandedId === mon.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken px-4 py-2 space-y-1">
                  <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Recent Mentions</div>
                  {mentionsLoading ? (
                    <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                  ) : mentions.length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 py-2">No mentions found yet</div>
                  ) : (
                    mentions.map(m => (
                      <div key={m.id} className="flex items-start gap-2 py-1 border-b border-rmpg-700 last:border-0">
                        <span className={`text-[9px] font-bold uppercase ${sentimentColor(m.sentiment)} shrink-0 w-14`}>
                          {m.sentiment}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-rmpg-300 line-clamp-2">{m.snippet}</div>
                          <a
                            href={m.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[9px] text-brand-400 hover:underline font-mono truncate block"
                          >
                            {m.source_url}
                          </a>
                        </div>
                        <span className="text-[9px] text-rmpg-500 shrink-0">{fmtDate(m.found_at)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ PAGE COMPARE PANEL
// ══════════════════════════════════════════════════════════════

function PageComparePanel() {
  const { addToast } = useToast();
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [history, setHistory] = useState<CompareResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [viewSide, setViewSide] = useState<'diff' | 'a' | 'b'>('diff');

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<CompareResult[]>('/firecrawl-tools/comparisons');
      setHistory(data);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const compare = async () => {
    if (!urlA.trim() || !urlB.trim()) { addToast('Both URLs are required', 'warning'); return; }
    setComparing(true);
    try {
      const data = await apiFetch<CompareResult>('/firecrawl-tools/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url_a: urlA.trim(), url_b: urlB.trim() }),
      });
      setResult(data);
      addToast('Comparison complete', 'success');
      loadHistory();
    } catch {
      addToast('Comparison failed', 'error');
    } finally {
      setComparing(false);
    }
  };

  const viewHistoryItem = (item: CompareResult) => {
    setResult(item);
    setUrlA(item.url_a);
    setUrlB(item.url_b);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Page Compare" icon={GitCompareArrows} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Inputs */}
      <div className="flex items-center gap-2">
        <input
          value={urlA}
          onChange={e => setUrlA(e.target.value)}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="URL A"
        />
        <span className="text-rmpg-500 text-xs">vs</span>
        <input
          value={urlB}
          onChange={e => setUrlB(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && compare()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="URL B"
        />
        <SmallBtn onClick={compare} loading={comparing} variant="primary">
          <GitCompareArrows className="w-3 h-3" /> Compare
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No comparisons yet</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <GitCompareArrows className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">
                  {item.url_a} vs {item.url_b}
                </span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          {/* View Toggle */}
          <div className="flex items-center gap-1">
            {(['diff', 'a', 'b'] as const).map(side => (
              <button
                key={side}
                onClick={() => setViewSide(side)}
                className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors ${
                  viewSide === side
                    ? 'border-orange-500/50 bg-orange-500/10 text-orange-400'
                    : 'border-rmpg-600 bg-rmpg-800 text-rmpg-400 hover:text-white'
                }`}
              >
                {side === 'diff' ? 'Diff Summary' : side === 'a' ? 'Page A' : 'Page B'}
              </button>
            ))}
          </div>

          {/* Content */}
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-2 text-[10px] text-rmpg-300 font-mono max-h-80 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {viewSide === 'diff'
              ? result.diff_summary || 'No differences detected'
              : viewSide === 'a'
                ? result.markdown_a || 'No content'
                : result.markdown_b || 'No content'}
          </pre>
        </div>
      )}

      {!result && !comparing && (
        <EmptyState icon={GitCompareArrows} message="Enter two URLs to compare their content side by side." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ WORKFLOWS PANEL
// ══════════════════════════════════════════════════════════════

const STEP_TYPES: { value: WorkflowStep['type']; label: string }[] = [
  { value: 'scrape', label: 'Scrape URL' },
  { value: 'search', label: 'Web Search' },
  { value: 'extract', label: 'Extract Data' },
];

function WorkflowsPanel() {
  const { addToast } = useToast();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Form
  const [formName, setFormName] = useState('');
  const [formSteps, setFormSteps] = useState<WorkflowStep[]>([{ type: 'scrape', url_or_query: '' }]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<WorkflowDef[]>('/firecrawl-tools/workflows');
      setWorkflows(data);
    } catch {
      addToast('Failed to load workflows', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadRuns = useCallback(async (wfId: number) => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<WorkflowRun[]>(`/firecrawl-tools/workflows/${wfId}/runs`);
      setRuns(data);
    } catch {
      addToast('Failed to load run history', 'error');
    } finally {
      setRunsLoading(false);
    }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setRuns([]);
    } else {
      setExpandedId(id);
      loadRuns(id);
    }
  };

  const addStep = () => {
    setFormSteps([...formSteps, { type: 'scrape', url_or_query: '' }]);
  };

  const removeStep = (index: number) => {
    if (formSteps.length <= 1) return;
    setFormSteps(formSteps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, field: keyof WorkflowStep, value: string) => {
    setFormSteps(formSteps.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const createWorkflow = async () => {
    if (!formName.trim()) { addToast('Workflow name is required', 'warning'); return; }
    const validSteps = formSteps.filter(s => s.url_or_query.trim());
    if (validSteps.length === 0) { addToast('At least one step with a URL/query is required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), steps: validSteps }),
      });
      addToast('Workflow created', 'success');
      setShowForm(false);
      setFormName('');
      setFormSteps([{ type: 'scrape', url_or_query: '' }]);
      load();
    } catch {
      addToast('Failed to create workflow', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async (id: number) => {
    setRunningIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/workflows/${id}/run`, { method: 'POST' });
      addToast('Workflow run started', 'success');
      load();
      if (expandedId === id) loadRuns(id);
    } catch {
      addToast('Failed to start workflow', 'error');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteWorkflow = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/workflows/${id}`, { method: 'DELETE' });
      addToast('Workflow deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setRuns([]); }
      load();
    } catch {
      addToast('Failed to delete workflow', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Workflows" icon={Workflow} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Workflow
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Workflow Name *</label>
            <input
              value={formName} onChange={e => setFormName(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="e.g. Competitor Intel Pipeline"
            />
          </div>

          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Steps</div>
          <div className="space-y-1.5">
            {formSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-surface-sunken border border-rmpg-700 rounded-sm p-1.5">
                <GripVertical className="w-3 h-3 text-rmpg-600 shrink-0" />
                <span className="text-[9px] text-rmpg-500 font-mono w-4 shrink-0">{idx + 1}.</span>
                <select
                  value={step.type}
                  onChange={e => updateStep(idx, 'type', e.target.value)}
                  className="bg-rmpg-800 border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none shrink-0"
                >
                  {STEP_TYPES.map(st => (
                    <option key={st.value} value={st.value}>{st.label}</option>
                  ))}
                </select>
                <input
                  value={step.url_or_query}
                  onChange={e => updateStep(idx, 'url_or_query', e.target.value)}
                  className="flex-1 bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-0.5 text-[10px] text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                  placeholder={step.type === 'search' ? 'Search query...' : 'https://...'}
                />
                <button
                  onClick={() => removeStep(idx)}
                  disabled={formSteps.length <= 1}
                  className="text-rmpg-500 hover:text-red-400 disabled:opacity-30"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={addStep}>
              <Plus className="w-3 h-3" /> Add Step
            </SmallBtn>
            <div className="flex-1" />
            <SmallBtn onClick={createWorkflow} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Workflow List */}
      {workflows.length === 0 ? (
        <EmptyState icon={Workflow} message="No workflows yet. Build multi-step scraping pipelines here." />
      ) : (
        <div className="space-y-1">
          {workflows.map(wf => (
            <div key={wf.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(wf.id)} className="text-rmpg-400 hover:text-white">
                  {expandedId === wf.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <StatusLed status={wf.status} />
                <span className="text-xs font-medium text-white flex-1 truncate">{wf.name}</span>
                <span className="text-[10px] text-rmpg-400 font-mono">{wf.steps.length} steps</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(wf.last_run_at)}</span>
                <SmallBtn onClick={() => runWorkflow(wf.id)} loading={runningIds.has(wf.id)} variant="primary">
                  <Play className="w-3 h-3" /> Run
                </SmallBtn>
                <SmallBtn onClick={() => deleteWorkflow(wf.id)} loading={deletingIds.has(wf.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Expanded: Steps + Run History */}
              {expandedId === wf.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken px-4 py-2 space-y-2">
                  {/* Steps */}
                  <div>
                    <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Pipeline Steps</div>
                    <div className="space-y-0.5">
                      {wf.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className="text-rmpg-500 font-mono w-4">{i + 1}.</span>
                          <span className={`font-bold uppercase tracking-wider px-1 py-0 rounded-sm text-[9px] ${
                            step.type === 'scrape'
                              ? 'bg-brand-500/20 text-brand-400'
                              : step.type === 'search'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {step.type}
                          </span>
                          <span className="text-rmpg-300 font-mono truncate">{step.url_or_query}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Run History */}
                  <div>
                    <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Run History</div>
                    {runsLoading ? (
                      <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                    ) : runs.length === 0 ? (
                      <div className="text-[10px] text-rmpg-500 py-1">No runs yet</div>
                    ) : (
                      runs.map(run => (
                        <div key={run.id} className="border-b border-rmpg-700 last:border-0 py-1">
                          <div className="flex items-center gap-3 text-[10px]">
                            <StatusLed status={run.status} />
                            <span className="text-rmpg-300 font-mono">{fmtDate(run.created_at)}</span>
                            {run.error_message && (
                              <span className="text-red-400 truncate">{run.error_message}</span>
                            )}
                            {run.results && run.results.length > 0 && (
                              <span className="text-rmpg-400">{run.results.length} result(s)</span>
                            )}
                          </div>
                          {run.results && run.results.length > 0 && (
                            <pre className="bg-rmpg-800 border border-rmpg-700 rounded-sm p-1.5 mt-1 text-[9px] text-rmpg-300 font-mono max-h-32 overflow-auto scrollbar-dark whitespace-pre-wrap">
                              {JSON.stringify(run.results, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))
                    )}
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

// ══════════════════════════════════════════════════════════════
// ██ MAIN FIRECRAWL TAB COMPONENT
// ══════════════════════════════════════════════════════════════

export default function FirecrawlTab() {
  const [activeTab, setActiveTab] = useState<FirecrawlSubTab>('scouts');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-rmpg-600 bg-surface-sunken">
        <span className="text-[10px] font-bold text-orange-400 tracking-wider uppercase mr-3">
          FIRECRAWL
        </span>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors ${
              activeTab === tab.id
                ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                : 'border-transparent text-rmpg-400 hover:text-white hover:bg-rmpg-700/50'
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-dark">
        {activeTab === 'scouts' && <ScoutsPanel />}
        {activeTab === 'ai-ready' && <AiReadyPanel />}
        {activeTab === 'cloner' && <ClonerPanel />}
        {activeTab === 'brand' && <BrandMonitorPanel />}
        {activeTab === 'compare' && <PageComparePanel />}
        {activeTab === 'workflows' && <WorkflowsPanel />}
      </div>
    </div>
  );
}
