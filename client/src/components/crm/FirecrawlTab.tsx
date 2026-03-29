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
  Sparkles,
  Building2,
  BookOpen,
  MessageSquare,
  Eye,
  ShieldCheck,
  FileText,
  FileSearch,
  Send,
  Clipboard,
  Hash,
  Users,
  Link,
  Tag,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';

// ── Shared Types ──────────────────────────────────────────────

type FirecrawlSubTab = 'scouts' | 'ai-ready' | 'cloner' | 'brand' | 'compare' | 'workflows' | 'search-engine' | 'enrich' | 'researcher' | 'chatbot' | 'observer' | 'deep-search' | 'llmstxt' | 'pdf-inspect';

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
  { id: 'search-engine', label: 'Search Engine', icon: Sparkles },
  { id: 'enrich', label: 'Enrich', icon: Building2 },
  { id: 'researcher', label: 'Researcher', icon: BookOpen },
  { id: 'chatbot', label: 'Chatbot', icon: MessageSquare },
  { id: 'observer', label: 'Observer', icon: Eye },
  { id: 'deep-search', label: 'Deep Search', icon: ShieldCheck },
  { id: 'llmstxt', label: 'LLMs.txt', icon: FileText },
  { id: 'pdf-inspect', label: 'PDF Inspect', icon: FileSearch },
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
// ██ SEARCH ENGINE PANEL (Fireplexity)
// ══════════════════════════════════════════════════════════════

interface SearchResult {
  id: number;
  query: string;
  depth: 'quick' | 'standard' | 'deep';
  answer_summary: string;
  citations: { index: number; title: string; snippet: string; url: string }[];
  created_at: string;
}

function SearchEnginePanel() {
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [history, setHistory] = useState<SearchResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<SearchResult[]>('/firecrawl-tools/search-engine/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const search = async () => {
    if (!query.trim()) { addToast('Enter a search query', 'warning'); return; }
    setSearching(true);
    try {
      const data = await apiFetch<SearchResult>('/firecrawl-tools/search-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), depth }),
      });
      setResult(data);
      addToast('Search complete', 'success');
      loadHistory();
    } catch {
      addToast('Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const viewHistoryItem = (item: SearchResult) => {
    setResult(item);
    setQuery(item.query);
    setDepth(item.depth);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Search Engine (Fireplexity)" icon={Sparkles} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Query Input */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
          placeholder="Ask anything..."
        />
        <select
          value={depth}
          onChange={e => setDepth(e.target.value as 'quick' | 'standard' | 'deep')}
          className="bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none"
        >
          <option value="quick">Quick</option>
          <option value="standard">Standard</option>
          <option value="deep">Deep</option>
        </select>
        <SmallBtn onClick={search} loading={searching} variant="primary">
          <Search className="w-3 h-3" /> Search
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past searches</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Sparkles className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.query}</span>
                <span className="text-[9px] text-rmpg-500 uppercase font-mono shrink-0">{item.depth}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Answer Summary */}
          <div className="bg-orange-500/5 border border-orange-500/30 rounded-sm p-3">
            <div className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-1">Answer</div>
            <div className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{result.answer_summary}</div>
          </div>

          {/* Citations */}
          {result.citations && result.citations.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Sources</div>
              {result.citations.map(cite => (
                <div key={cite.index} className="bg-surface-raised border border-rmpg-600 rounded-sm p-2 flex items-start gap-2">
                  <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-sm px-1 py-0.5 shrink-0">
                    [{cite.index}]
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-white font-medium truncate">{cite.title}</div>
                    <div className="text-[10px] text-rmpg-400 line-clamp-2 mt-0.5">{cite.snippet}</div>
                    <a
                      href={cite.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] text-brand-400 hover:underline font-mono truncate block mt-0.5"
                    >
                      {cite.url}
                    </a>
                  </div>
                  <a href={cite.url} target="_blank" rel="noopener noreferrer" className="text-rmpg-500 hover:text-orange-400 shrink-0">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!result && !searching && (
        <EmptyState icon={Sparkles} message="Enter a query to search the web with AI-powered answers and citations." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ ENRICH PANEL (Fire Enrich)
// ══════════════════════════════════════════════════════════════

interface EnrichResult {
  id: number;
  input: string;
  company_name: string;
  description: string;
  industry: string;
  employee_count: number | null;
  tech_stack: string[];
  social_links: { platform: string; url: string }[];
  contact_info: { type: string; value: string }[];
  created_at: string;
}

function EnrichPanel() {
  const { addToast } = useToast();
  const [input, setInput] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [history, setHistory] = useState<EnrichResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkResults, setBulkResults] = useState<EnrichResult[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<EnrichResult[]>('/firecrawl-tools/enrich/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const enrich = async () => {
    if (!input.trim()) { addToast('Enter an email or domain', 'warning'); return; }
    setEnriching(true);
    try {
      const data = await apiFetch<EnrichResult>('/firecrawl-tools/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() }),
      });
      setResult(data);
      addToast('Enrichment complete', 'success');
      loadHistory();
    } catch {
      addToast('Enrichment failed', 'error');
    } finally {
      setEnriching(false);
    }
  };

  const bulkEnrich = async () => {
    const emails = bulkInput.split('\n').map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) { addToast('Enter at least one email or domain', 'warning'); return; }
    setBulkEnriching(true);
    try {
      const data = await apiFetch<EnrichResult[]>('/firecrawl-tools/enrich/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: emails }),
      });
      setBulkResults(data);
      addToast(`Enriched ${data.length} entries`, 'success');
      loadHistory();
    } catch {
      addToast('Bulk enrichment failed', 'error');
    } finally {
      setBulkEnriching(false);
    }
  };

  const viewHistoryItem = (item: EnrichResult) => {
    setResult(item);
    setInput(item.input);
    setShowHistory(false);
    setBulkMode(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Fire Enrich" icon={Building2} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setBulkMode(!bulkMode)} variant={bulkMode ? 'primary' : 'default'}>
          <Users className="w-3 h-3" /> {bulkMode ? 'Single' : 'Bulk'}
        </SmallBtn>
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Single Input */}
      {!bulkMode && (
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && enrich()}
            className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="email@company.com or company.com"
          />
          <SmallBtn onClick={enrich} loading={enriching} variant="primary">
            <Building2 className="w-3 h-3" /> Enrich
          </SmallBtn>
        </div>
      )}

      {/* Bulk Input */}
      {bulkMode && (
        <div className="space-y-2">
          <textarea
            value={bulkInput}
            onChange={e => setBulkInput(e.target.value)}
            className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono resize-none"
            rows={5}
            placeholder="One email or domain per line..."
          />
          <SmallBtn onClick={bulkEnrich} loading={bulkEnriching} variant="primary">
            <Users className="w-3 h-3" /> Bulk Enrich ({bulkInput.split('\n').filter(l => l.trim()).length} entries)
          </SmallBtn>
        </div>
      )}

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past enrichments</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Building2 className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-white truncate">{item.company_name || item.input}</span>
                <span className="text-[10px] text-rmpg-400 truncate">{item.industry}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Single Result */}
      {!bulkMode && result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-orange-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">{result.company_name || 'Unknown Company'}</div>
              <div className="text-[10px] text-rmpg-400 font-mono">{result.input}</div>
            </div>
            {result.employee_count != null && (
              <div className="text-right shrink-0">
                <div className="text-xs font-bold text-orange-400 font-mono">{result.employee_count.toLocaleString()}</div>
                <div className="text-[9px] text-rmpg-500 uppercase">employees</div>
              </div>
            )}
          </div>

          {result.description && (
            <div className="text-[10px] text-rmpg-300 leading-relaxed">{result.description}</div>
          )}

          {result.industry && (
            <div className="flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-rmpg-500" />
              <span className="text-[10px] text-rmpg-300">{result.industry}</span>
            </div>
          )}

          {/* Tech Stack */}
          {result.tech_stack && result.tech_stack.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Tech Stack</div>
              <div className="flex flex-wrap gap-1">
                {result.tech_stack.map((tech, i) => (
                  <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 bg-brand-500/10 border border-brand-500/30 text-brand-400 rounded-sm">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Social Links */}
          {result.social_links && result.social_links.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Social</div>
              <div className="flex flex-wrap gap-2">
                {result.social_links.map((sl, i) => (
                  <a
                    key={i}
                    href={sl.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-brand-400 hover:underline flex items-center gap-1"
                  >
                    <Link className="w-2.5 h-2.5" /> {sl.platform}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Contact Info */}
          {result.contact_info && result.contact_info.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Contact</div>
              <div className="space-y-0.5">
                {result.contact_info.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="text-rmpg-500 uppercase font-mono w-14 shrink-0">{c.type}</span>
                    <span className="text-rmpg-300 font-mono truncate">{c.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulk Results */}
      {bulkMode && bulkResults.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Bulk Results ({bulkResults.length})</div>
          {bulkResults.map(item => (
            <div key={item.id} className="bg-surface-raised border border-rmpg-600 rounded-sm px-3 py-2 flex items-center gap-3">
              <Building2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="text-[10px] text-white font-medium truncate flex-1">{item.company_name || item.input}</span>
              <span className="text-[10px] text-rmpg-400">{item.industry}</span>
              {item.employee_count != null && (
                <span className="text-[10px] text-orange-400 font-mono">{item.employee_count.toLocaleString()}</span>
              )}
              <SmallBtn onClick={() => { setResult(item); setInput(item.input); setBulkMode(false); }}>
                <ArrowRight className="w-3 h-3" /> View
              </SmallBtn>
            </div>
          ))}
        </div>
      )}

      {!bulkMode && !result && !enriching && (
        <EmptyState icon={Building2} message="Enter an email or domain to enrich with company data." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ RESEARCHER PANEL (Open Researcher)
// ══════════════════════════════════════════════════════════════

interface ResearchFinding {
  title: string;
  content: string;
  source_url: string;
  confidence: number;
}

interface ResearchResult {
  id: number;
  topic: string;
  depth: 'basic' | 'thorough' | 'comprehensive';
  synthesis: string;
  findings: ResearchFinding[];
  sources: { url: string; relevance: number }[];
  created_at: string;
}

function ResearcherPanel() {
  const { addToast } = useToast();
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState('');
  const [depth, setDepth] = useState<'basic' | 'thorough' | 'comprehensive'>('thorough');
  const [researching, setResearching] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [history, setHistory] = useState<ResearchResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<ResearchResult[]>('/firecrawl-tools/research/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const research = async () => {
    if (!topic.trim()) { addToast('Enter a research topic', 'warning'); return; }
    setResearching(true);
    try {
      const data = await apiFetch<ResearchResult>('/firecrawl-tools/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          questions: questions.trim() || undefined,
          depth,
        }),
      });
      setResult(data);
      addToast('Research complete', 'success');
      loadHistory();
    } catch {
      addToast('Research failed', 'error');
    } finally {
      setResearching(false);
    }
  };

  const viewHistoryItem = (item: ResearchResult) => {
    setResult(item);
    setTopic(item.topic);
    setDepth(item.depth);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Open Researcher" icon={BookOpen} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Topic Input */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !questions && research()}
            className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
            placeholder="Research topic..."
          />
          <select
            value={depth}
            onChange={e => setDepth(e.target.value as 'basic' | 'thorough' | 'comprehensive')}
            className="bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none"
          >
            <option value="basic">Basic</option>
            <option value="thorough">Thorough</option>
            <option value="comprehensive">Comprehensive</option>
          </select>
          <SmallBtn onClick={research} loading={researching} variant="primary">
            <BookOpen className="w-3 h-3" /> Research
          </SmallBtn>
        </div>
        <textarea
          value={questions}
          onChange={e => setQuestions(e.target.value)}
          className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none"
          rows={2}
          placeholder="Optional specific questions (one per line)..."
        />
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past research sessions</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <BookOpen className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.topic}</span>
                <span className="text-[9px] text-rmpg-500 uppercase font-mono shrink-0">{item.depth}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Synthesis Summary */}
          <div className="bg-orange-500/5 border border-orange-500/30 rounded-sm p-3">
            <div className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-1">Synthesis</div>
            <div className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{result.synthesis}</div>
          </div>

          {/* Findings */}
          {result.findings && result.findings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Findings ({result.findings.length})</div>
              {result.findings.map((finding, idx) => (
                <div key={idx} className="bg-surface-raised border border-rmpg-600 rounded-sm">
                  <button
                    onClick={() => setExpandedFinding(expandedFinding === idx ? null : idx)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  >
                    {expandedFinding === idx ? <ChevronDown className="w-3 h-3 text-rmpg-400" /> : <ChevronRight className="w-3 h-3 text-rmpg-400" />}
                    <span className="text-[10px] text-white font-medium flex-1 truncate">{finding.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="w-16 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${finding.confidence >= 0.7 ? 'bg-emerald-500' : finding.confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${finding.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-rmpg-500">{Math.round(finding.confidence * 100)}%</span>
                    </div>
                  </button>
                  {expandedFinding === idx && (
                    <div className="border-t border-rmpg-700 px-3 py-2 bg-surface-sunken">
                      <div className="text-[10px] text-rmpg-300 leading-relaxed whitespace-pre-wrap">{finding.content}</div>
                      {finding.source_url && (
                        <a
                          href={finding.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] text-brand-400 hover:underline font-mono mt-1 flex items-center gap-1"
                        >
                          <ExternalLink className="w-2.5 h-2.5" /> {finding.source_url}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sources */}
          {result.sources && result.sources.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Sources ({result.sources.length})</div>
              <div className="space-y-0.5">
                {result.sources.map((src, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <div className="w-10 h-1.5 bg-rmpg-700 rounded-full overflow-hidden shrink-0">
                      <div
                        className="h-full bg-orange-500 rounded-full"
                        style={{ width: `${src.relevance * 100}%` }}
                      />
                    </div>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-400 hover:underline font-mono truncate"
                    >
                      {src.url}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !researching && (
        <EmptyState icon={BookOpen} message="Enter a topic to start AI-powered research with source citations." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ CHATBOT PANEL (Firestarter)
// ══════════════════════════════════════════════════════════════

interface Chatbot {
  id: number;
  name: string;
  source_url: string;
  description: string;
  status: 'ready' | 'indexing' | 'error';
  created_at: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
}

function ChatbotPanel() {
  const { addToast } = useToast();
  const [bots, setBots] = useState<Chatbot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [activeBotId, setActiveBotId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [asking, setAsking] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formDesc, setFormDesc] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Chatbot[]>('/firecrawl-tools/chatbot');
      setBots(data);
    } catch {
      addToast('Failed to load chatbots', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const createBot = async () => {
    if (!formName.trim() || !formUrl.trim()) { addToast('Name and source URL are required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          source_url: formUrl.trim(),
          description: formDesc.trim(),
        }),
      });
      addToast('Chatbot created', 'success');
      setShowForm(false);
      setFormName(''); setFormUrl(''); setFormDesc('');
      load();
    } catch {
      addToast('Failed to create chatbot', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteBot = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/chatbot/${id}`, { method: 'DELETE' });
      addToast('Chatbot deleted', 'success');
      if (activeBotId === id) { setActiveBotId(null); setMessages([]); }
      load();
    } catch {
      addToast('Failed to delete chatbot', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const openChat = (id: number) => {
    if (activeBotId === id) {
      setActiveBotId(null);
      setMessages([]);
    } else {
      setActiveBotId(id);
      setMessages([]);
      setChatInput('');
    }
  };

  const askQuestion = async () => {
    if (!chatInput.trim() || !activeBotId) return;
    const userMsg: ChatMessage = { role: 'user', content: chatInput.trim() };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setAsking(true);
    try {
      const data = await apiFetch<{ answer: string; citations?: string[] }>(`/firecrawl-tools/chatbot/${activeBotId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg.content }),
      });
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, citations: data.citations }]);
    } catch {
      addToast('Failed to get answer', 'error');
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Failed to get a response.' }]);
    } finally {
      setAsking(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Chatbot (Firestarter)" icon={MessageSquare} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Chatbot
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Name *</label>
              <input
                value={formName} onChange={e => setFormName(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="e.g. Company FAQ Bot"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Source URL *</label>
              <input
                value={formUrl} onChange={e => setFormUrl(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                placeholder="https://docs.example.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Description</label>
            <input
              value={formDesc} onChange={e => setFormDesc(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="What this chatbot answers questions about..."
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createBot} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Bot List */}
      {bots.length === 0 ? (
        <EmptyState icon={MessageSquare} message="No chatbots yet. Create one from a URL to start asking questions." />
      ) : (
        <div className="space-y-1">
          {bots.map(bot => (
            <div key={bot.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <StatusLed status={bot.status === 'ready' ? 'active' : bot.status} />
                <MessageSquare className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-xs font-medium text-white flex-1 truncate">{bot.name}</span>
                <span className="text-[10px] text-rmpg-500 font-mono truncate max-w-[180px]">{bot.source_url}</span>
                <SmallBtn onClick={() => openChat(bot.id)} variant={activeBotId === bot.id ? 'primary' : 'default'} disabled={bot.status !== 'ready'}>
                  <MessageSquare className="w-3 h-3" /> {activeBotId === bot.id ? 'Close' : 'Ask'}
                </SmallBtn>
                <SmallBtn onClick={() => deleteBot(bot.id)} loading={deletingIds.has(bot.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Chat Interface */}
              {activeBotId === bot.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2">
                  {/* Messages */}
                  <div className="max-h-64 overflow-y-auto scrollbar-dark space-y-2">
                    {messages.length === 0 && (
                      <div className="text-[10px] text-rmpg-500 text-center py-4">
                        Ask a question about {bot.name}...
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-sm px-2.5 py-1.5 ${
                          msg.role === 'user'
                            ? 'bg-orange-500/10 border border-orange-500/30 text-orange-200'
                            : 'bg-rmpg-800 border border-rmpg-600 text-rmpg-200'
                        }`}>
                          <div className="text-[10px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="mt-1 pt-1 border-t border-rmpg-700 space-y-0.5">
                              {msg.citations.map((cite, ci) => (
                                <a
                                  key={ci}
                                  href={cite}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[9px] text-brand-400 hover:underline font-mono block truncate"
                                >
                                  [{ci + 1}] {cite}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {asking && (
                      <div className="flex justify-start">
                        <div className="bg-rmpg-800 border border-rmpg-600 rounded-sm px-3 py-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input */}
                  <div className="flex items-center gap-2">
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && askQuestion()}
                      className="flex-1 bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                      placeholder="Ask a question..."
                      disabled={asking}
                    />
                    <SmallBtn onClick={askQuestion} loading={asking} variant="primary" disabled={!chatInput.trim()}>
                      <Send className="w-3 h-3" />
                    </SmallBtn>
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
// ██ OBSERVER PANEL (Firecrawl Observer)
// ══════════════════════════════════════════════════════════════

interface ObserverWatch {
  id: number;
  name: string;
  url: string;
  check_interval: string;
  status: 'active' | 'paused';
  last_status: 'changed' | 'unchanged' | null;
  last_checked_at: string | null;
  change_count: number;
  created_at: string;
}

interface ObserverChange {
  id: number;
  watch_id: number;
  diff_summary: string;
  detected_at: string;
}

function ObserverPanel() {
  const { addToast } = useToast();
  const [watches, setWatches] = useState<ObserverWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [changes, setChanges] = useState<ObserverChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Form
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formInterval, setFormInterval] = useState('24h');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<ObserverWatch[]>('/firecrawl-tools/observer');
      setWatches(data);
    } catch {
      addToast('Failed to load watches', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadChanges = useCallback(async (watchId: number) => {
    setChangesLoading(true);
    try {
      const data = await apiFetch<ObserverChange[]>(`/firecrawl-tools/observer/${watchId}/changes`);
      setChanges(data);
    } catch {
      addToast('Failed to load change history', 'error');
    } finally {
      setChangesLoading(false);
    }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setChanges([]);
    } else {
      setExpandedId(id);
      loadChanges(id);
    }
  };

  const createWatch = async () => {
    if (!formName.trim() || !formUrl.trim()) { addToast('Name and URL are required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/observer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          url: formUrl.trim(),
          check_interval: formInterval,
        }),
      });
      addToast('Watch created', 'success');
      setShowForm(false);
      setFormName(''); setFormUrl(''); setFormInterval('24h');
      load();
    } catch {
      addToast('Failed to create watch', 'error');
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async (id: number) => {
    setCheckingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/observer/${id}/check`, { method: 'POST' });
      addToast('Check triggered', 'success');
      load();
      if (expandedId === id) loadChanges(id);
    } catch {
      addToast('Check failed', 'error');
    } finally {
      setCheckingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteWatch = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/observer/${id}`, { method: 'DELETE' });
      addToast('Watch deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setChanges([]); }
      load();
    } catch {
      addToast('Failed to delete watch', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Observer" icon={Eye} statusLed="bg-orange-400" ledPulse>
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Watch
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Name *</label>
              <input
                value={formName} onChange={e => setFormName(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="e.g. Competitor Pricing"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">URL *</label>
              <input
                value={formUrl} onChange={e => setFormUrl(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                placeholder="https://example.com/pricing"
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
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createWatch} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create Watch
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Watch List */}
      {watches.length === 0 ? (
        <EmptyState icon={Eye} message="No watches configured yet. Create one to monitor pages for changes." />
      ) : (
        <div className="space-y-1">
          {watches.map(watch => (
            <div key={watch.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(watch.id)} className="text-rmpg-400 hover:text-white">
                  {expandedId === watch.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {/* Change detection indicator */}
                {watch.last_status === 'changed' ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Changed" />
                ) : watch.last_status === 'unchanged' ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-rmpg-500" title="Unchanged" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Not checked" />
                )}
                <span className="text-xs font-medium text-white flex-1 truncate">{watch.name}</span>
                <span className="text-[10px] text-rmpg-500 font-mono truncate max-w-[200px]">{watch.url}</span>
                <span className="text-[10px] text-rmpg-400">{watch.change_count} changes</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(watch.last_checked_at)}</span>
                <SmallBtn onClick={() => checkNow(watch.id)} loading={checkingIds.has(watch.id)}>
                  <RefreshCw className="w-3 h-3" /> Check Now
                </SmallBtn>
                <SmallBtn onClick={() => deleteWatch(watch.id)} loading={deletingIds.has(watch.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Expanded: Change History */}
              {expandedId === watch.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken px-4 py-2 space-y-1">
                  <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Change History</div>
                  {changesLoading ? (
                    <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                  ) : changes.length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 py-2">No changes detected yet</div>
                  ) : (
                    changes.map(change => (
                      <div key={change.id} className="border-b border-rmpg-700 last:border-0 py-1.5">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-rmpg-300 font-mono">{fmtDate(change.detected_at)}</span>
                        </div>
                        <div className="text-[10px] text-rmpg-400 mt-0.5 pl-4 whitespace-pre-wrap">{change.diff_summary}</div>
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
// ██ DEEP SEARCH PANEL (Firesearch)
// ══════════════════════════════════════════════════════════════

interface DeepSearchClaim {
  claim: string;
  confidence: number;
  validated: boolean | null;
  supporting_sources: { url: string; snippet: string }[];
  contradicting_sources: { url: string; snippet: string }[];
}

interface DeepSearchResult {
  id: number;
  query: string;
  validate: boolean;
  claims: DeepSearchClaim[];
  created_at: string;
}

function DeepSearchPanel() {
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [validate, setValidate] = useState(true);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<DeepSearchResult | null>(null);
  const [history, setHistory] = useState<DeepSearchResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedClaim, setExpandedClaim] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<DeepSearchResult[]>('/firecrawl-tools/deep-search/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const search = async () => {
    if (!query.trim()) { addToast('Enter a search query', 'warning'); return; }
    setSearching(true);
    try {
      const data = await apiFetch<DeepSearchResult>('/firecrawl-tools/deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), validate }),
      });
      setResult(data);
      addToast('Deep search complete', 'success');
      loadHistory();
    } catch {
      addToast('Deep search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const viewHistoryItem = (item: DeepSearchResult) => {
    setResult(item);
    setQuery(item.query);
    setValidate(item.validate);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Deep Search (Firesearch)" icon={ShieldCheck} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Query Input */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
          placeholder="Enter a claim or question to verify..."
        />
        <label className="flex items-center gap-1 text-[10px] text-rmpg-400 cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={validate}
            onChange={e => setValidate(e.target.checked)}
            className="rounded-sm border-rmpg-600 bg-rmpg-800 text-orange-500 focus:ring-orange-500/50 w-3 h-3"
          />
          Validate
        </label>
        <SmallBtn onClick={search} loading={searching} variant="primary">
          <ShieldCheck className="w-3 h-3" /> Search
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past deep searches</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <ShieldCheck className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.query}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && result.claims && result.claims.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">Claims ({result.claims.length})</div>
          {result.claims.map((claim, idx) => (
            <div key={idx} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <button
                onClick={() => setExpandedClaim(expandedClaim === idx ? null : idx)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
              >
                {/* Validation status */}
                {claim.validated === true ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : claim.validated === false ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                )}
                <span className="text-[10px] text-white flex-1">{claim.claim}</span>
                {/* Confidence bar */}
                <div className="flex items-center gap-1 shrink-0">
                  <div className="w-20 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${claim.confidence >= 0.7 ? 'bg-emerald-500' : claim.confidence >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${claim.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-rmpg-500 w-7 text-right">{Math.round(claim.confidence * 100)}%</span>
                </div>
                {expandedClaim === idx ? <ChevronDown className="w-3 h-3 text-rmpg-400" /> : <ChevronRight className="w-3 h-3 text-rmpg-400" />}
              </button>

              {expandedClaim === idx && (
                <div className="border-t border-rmpg-700 bg-surface-sunken px-3 py-2 space-y-2">
                  {/* Supporting sources */}
                  {claim.supporting_sources && claim.supporting_sources.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> Supporting ({claim.supporting_sources.length})
                      </div>
                      {claim.supporting_sources.map((src, si) => (
                        <div key={si} className="pl-3 py-0.5">
                          <div className="text-[10px] text-rmpg-300 line-clamp-2">{src.snippet}</div>
                          <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-brand-400 hover:underline font-mono truncate block">
                            {src.url}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Contradicting sources */}
                  {claim.contradicting_sources && claim.contradicting_sources.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-red-400 uppercase tracking-wider mb-0.5 flex items-center gap-1">
                        <XCircle className="w-2.5 h-2.5" /> Contradicting ({claim.contradicting_sources.length})
                      </div>
                      {claim.contradicting_sources.map((src, ci) => (
                        <div key={ci} className="pl-3 py-0.5">
                          <div className="text-[10px] text-rmpg-300 line-clamp-2">{src.snippet}</div>
                          <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-brand-400 hover:underline font-mono truncate block">
                            {src.url}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!result && !searching && (
        <EmptyState icon={ShieldCheck} message="Enter a query to search and validate claims with supporting evidence." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ LLMS.TXT PANEL (create-llmstxt-py)
// ══════════════════════════════════════════════════════════════

interface LlmsTxtResult {
  id: number;
  url: string;
  content: string;
  pages_analyzed: number;
  created_at: string;
}

function LlmsTxtPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<LlmsTxtResult | null>(null);
  const [history, setHistory] = useState<LlmsTxtResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<LlmsTxtResult[]>('/firecrawl-tools/llmstxt/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const generate = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setGenerating(true);
    try {
      const data = await apiFetch<LlmsTxtResult>('/firecrawl-tools/llmstxt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('LLMs.txt generated', 'success');
      loadHistory();
    } catch {
      addToast('Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = () => {
    if (!result?.content) return;
    navigator.clipboard.writeText(result.content).then(() => {
      addToast('Copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy', 'error');
    });
  };

  const viewHistoryItem = (item: LlmsTxtResult) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="LLMs.txt Generator" icon={FileText} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
        <SmallBtn onClick={generate} loading={generating} variant="primary">
          <FileText className="w-3 h-3" /> Generate
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past generations</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <FileText className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[10px] text-rmpg-400 shrink-0">{item.pages_analyzed} pages</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-rmpg-400 font-mono">{result.url}</span>
            <span className="text-[10px] text-orange-400 font-mono">{result.pages_analyzed} pages analyzed</span>
            <div className="flex-1" />
            <SmallBtn onClick={copyToClipboard} variant="primary">
              <Clipboard className="w-3 h-3" /> Copy
            </SmallBtn>
          </div>
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-96 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {result.content || 'No content generated'}
          </pre>
        </div>
      )}

      {!result && !generating && (
        <EmptyState icon={FileText} message="Enter a URL to generate an llms.txt file for LLM consumption." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ PDF INSPECT PANEL (PDF Inspector)
// ══════════════════════════════════════════════════════════════

interface PdfEntity {
  type: string;
  value: string;
}

interface PdfInspectResult {
  id: number;
  url: string;
  classification: string;
  is_scanned: boolean;
  summary: string;
  key_sections: string[];
  entities: PdfEntity[];
  created_at: string;
}

function PdfInspectPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [result, setResult] = useState<PdfInspectResult | null>(null);
  const [history, setHistory] = useState<PdfInspectResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<PdfInspectResult[]>('/firecrawl-tools/pdf-inspect/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const inspect = async () => {
    if (!url.trim()) { addToast('Enter a PDF URL', 'warning'); return; }
    setInspecting(true);
    try {
      const data = await apiFetch<PdfInspectResult>('/firecrawl-tools/pdf-inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('PDF inspected', 'success');
      loadHistory();
    } catch {
      addToast('PDF inspection failed', 'error');
    } finally {
      setInspecting(false);
    }
  };

  const viewHistoryItem = (item: PdfInspectResult) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  const entityColor = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'name': case 'person': return 'bg-brand-500/10 border-brand-500/30 text-brand-400';
      case 'date': return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'amount': case 'money': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'location': case 'address': return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
      case 'email': return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
      default: return 'bg-rmpg-700/50 border-rmpg-600 text-rmpg-300';
    }
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="PDF Inspector" icon={FileSearch} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && inspect()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com/document.pdf"
        />
        <SmallBtn onClick={inspect} loading={inspecting} variant="primary">
          <FileSearch className="w-3 h-3" /> Inspect
        </SmallBtn>
      </div>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past inspections</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <FileSearch className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0 rounded-sm ${
                  item.is_scanned ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                }`}>
                  {item.is_scanned ? 'Scanned' : 'Text'}
                </span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          {/* Header badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
              {result.classification}
            </span>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${
              result.is_scanned ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}>
              {result.is_scanned ? 'Scanned PDF' : 'Text PDF'}
            </span>
            <span className="text-[10px] text-rmpg-500 font-mono ml-auto truncate max-w-[300px]">{result.url}</span>
          </div>

          {/* Summary */}
          {result.summary && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Summary</div>
              <div className="text-[10px] text-rmpg-300 leading-relaxed whitespace-pre-wrap">{result.summary}</div>
            </div>
          )}

          {/* Key Sections */}
          {result.key_sections && result.key_sections.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Key Sections</div>
              <div className="space-y-0.5">
                {result.key_sections.map((section, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-rmpg-300">
                    <Hash className="w-2.5 h-2.5 text-rmpg-500 shrink-0" />
                    {section}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extracted Entities */}
          {result.entities && result.entities.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Extracted Entities</div>
              <div className="flex flex-wrap gap-1">
                {result.entities.map((ent, i) => (
                  <span
                    key={i}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${entityColor(ent.type)}`}
                    title={ent.type}
                  >
                    <span className="opacity-60 uppercase text-[8px]">{ent.type}:</span> {ent.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !inspecting && (
        <EmptyState icon={FileSearch} message="Enter a PDF URL to inspect its structure and extract entities." />
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
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-rmpg-600 bg-surface-sunken overflow-x-auto scrollbar-dark">
        <span className="text-[10px] font-bold text-orange-400 tracking-wider uppercase mr-3 shrink-0">
          FIRECRAWL
        </span>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors shrink-0 whitespace-nowrap ${
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
        {activeTab === 'search-engine' && <SearchEnginePanel />}
        {activeTab === 'enrich' && <EnrichPanel />}
        {activeTab === 'researcher' && <ResearcherPanel />}
        {activeTab === 'chatbot' && <ChatbotPanel />}
        {activeTab === 'observer' && <ObserverPanel />}
        {activeTab === 'deep-search' && <DeepSearchPanel />}
        {activeTab === 'llmstxt' && <LlmsTxtPanel />}
        {activeTab === 'pdf-inspect' && <PdfInspectPanel />}
      </div>
    </div>
  );
}
