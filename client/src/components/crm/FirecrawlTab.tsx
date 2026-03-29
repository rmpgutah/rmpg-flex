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
  BarChart3,
  Plug,
  Target,
  TrendingUp,
  LayoutDashboard,
  Layers,
  Database,
  FileCode,
  Ticket,
  Palette,
  Server,
  FolderOpen,
  FileText as FileText2,
  Bot,
  Newspaper,
  PenTool,
  MessageCircle,
  Cpu,
  FileDown,
  Briefcase,
  Archive,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';

// ── Shared Types ──────────────────────────────────────────────

type FirecrawlSubTab = 'scouts' | 'ai-ready' | 'cloner' | 'brand' | 'compare' | 'workflows' | 'search-engine' | 'enrich' | 'researcher' | 'chatbot' | 'observer' | 'deep-search' | 'llmstxt' | 'pdf-inspect' | 'graphs' | 'connectors' | 'rag-eval' | 'trends' | 'gen-ui' | 'qa-cluster' | 'extract' | 'html-to-md' | 'coupons' | 'brand-extend' | 'mcp' | 'examples' | 'llmstxt-v2' | 'mendable' | 'news' | 'drafts' | 'slack' | 'discord' | 'agents' | 'doc-extract' | 'job-match' | 'mhtml';

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
  { id: 'graphs', label: 'Graphs', icon: BarChart3 },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'rag-eval', label: 'RAG Eval', icon: Target },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'gen-ui', label: 'Gen UI', icon: LayoutDashboard },
  { id: 'qa-cluster', label: 'QA Cluster', icon: Layers },
  { id: 'extract', label: 'Extract', icon: Database },
  { id: 'html-to-md', label: 'HTML→MD', icon: FileCode },
  { id: 'coupons', label: 'Coupons', icon: Ticket },
  { id: 'brand-extend', label: 'Brand Extend', icon: Palette },
  { id: 'mcp', label: 'MCP', icon: Server },
  { id: 'examples', label: 'Examples', icon: FolderOpen },
  { id: 'llmstxt-v2', label: 'LLMs.txt V2', icon: FileText2 },
  { id: 'mendable', label: 'Mendable', icon: Bot },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'drafts', label: 'Drafts', icon: PenTool },
  { id: 'slack', label: 'Slack', icon: MessageCircle },
  { id: 'discord', label: 'Discord', icon: Hash },
  { id: 'agents', label: 'Agents', icon: Cpu },
  { id: 'doc-extract', label: 'Doc Extract', icon: FileDown },
  { id: 'job-match', label: 'Job Match', icon: Briefcase },
  { id: 'mhtml', label: 'MHTML', icon: Archive },
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
// ██ GRAPHS PANEL (firegraph)
// ══════════════════════════════════════════════════════════════

interface GraphDataset {
  label: string;
  data: string;
  color: string;
}

interface GraphResult {
  id: number;
  title: string;
  chart_type: string;
  labels: string;
  datasets: GraphDataset[];
  source_url: string | null;
  created_at: string;
}

function GraphsPanel() {
  const { addToast } = useToast();
  const [graphs, setGraphs] = useState<GraphResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<'manual' | 'url'>('manual');
  const [urlInput, setUrlInput] = useState('');
  const [extracting, setExtracting] = useState(false);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formChartType, setFormChartType] = useState('bar');
  const [formLabels, setFormLabels] = useState('');
  const [formDatasets, setFormDatasets] = useState<GraphDataset[]>([{ label: 'Series 1', data: '', color: '#f97316' }]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<GraphResult[]>('/firecrawl-tools/graphs');
      setGraphs(data);
    } catch {
      addToast('Failed to load graphs', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const addDataset = () => {
    setFormDatasets(prev => [...prev, { label: `Series ${prev.length + 1}`, data: '', color: '#3b82f6' }]);
  };

  const removeDataset = (idx: number) => {
    setFormDatasets(prev => prev.filter((_, i) => i !== idx));
  };

  const updateDataset = (idx: number, field: keyof GraphDataset, value: string) => {
    setFormDatasets(prev => prev.map((ds, i) => i === idx ? { ...ds, [field]: value } : ds));
  };

  const createGraph = async () => {
    if (!formTitle.trim() || !formLabels.trim()) {
      addToast('Title and labels are required', 'warning');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          chart_type: formChartType,
          labels: formLabels.trim(),
          datasets: formDatasets,
        }),
      });
      addToast('Graph created', 'success');
      setShowForm(false);
      setFormTitle(''); setFormLabels(''); setFormChartType('bar');
      setFormDatasets([{ label: 'Series 1', data: '', color: '#f97316' }]);
      load();
    } catch {
      addToast('Failed to create graph', 'error');
    } finally {
      setSaving(false);
    }
  };

  const extractFromUrl = async () => {
    if (!urlInput.trim()) { addToast('Enter a URL', 'warning'); return; }
    setExtracting(true);
    try {
      const data = await apiFetch<GraphResult>('/firecrawl-tools/graph/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      addToast('Graph extracted from URL', 'success');
      setUrlInput('');
      load();
    } catch {
      addToast('Failed to extract graph from URL', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const deleteGraph = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/graph/${id}`, { method: 'DELETE' });
      addToast('Graph deleted', 'success');
      load();
    } catch {
      addToast('Failed to delete graph', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Graphs" icon={BarChart3} statusLed="bg-orange-400" ledPulse>
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Graph
        </SmallBtn>
        <SmallBtn onClick={load}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Create Form */}
      {showForm && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2 mb-2">
            <SmallBtn onClick={() => setMode('manual')} variant={mode === 'manual' ? 'primary' : 'default'}>Manual</SmallBtn>
            <SmallBtn onClick={() => setMode('url')} variant={mode === 'url' ? 'primary' : 'default'}>From URL</SmallBtn>
          </div>

          {mode === 'url' ? (
            <div className="flex items-center gap-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && extractFromUrl()}
                className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                placeholder="https://example.com/data-page"
              />
              <SmallBtn onClick={extractFromUrl} loading={extracting} variant="primary">
                <BarChart3 className="w-3 h-3" /> Extract
              </SmallBtn>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-rmpg-400 mb-0.5">Title *</label>
                  <input
                    value={formTitle} onChange={e => setFormTitle(e.target.value)}
                    className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                    placeholder="Monthly Report"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rmpg-400 mb-0.5">Chart Type</label>
                  <select
                    value={formChartType} onChange={e => setFormChartType(e.target.value)}
                    className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
                  >
                    <option value="line">Line</option>
                    <option value="bar">Bar</option>
                    <option value="pie">Pie</option>
                    <option value="area">Area</option>
                    <option value="scatter">Scatter</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-rmpg-400 mb-0.5">Labels (comma-separated) *</label>
                <input
                  value={formLabels} onChange={e => setFormLabels(e.target.value)}
                  className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                  placeholder="Jan, Feb, Mar, Apr, May"
                />
              </div>
              {/* Datasets */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-rmpg-400">Datasets</span>
                  <SmallBtn onClick={addDataset}><Plus className="w-3 h-3" /> Add</SmallBtn>
                </div>
                {formDatasets.map((ds, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-surface-sunken border border-rmpg-700 rounded-sm p-1.5">
                    <input
                      value={ds.label} onChange={e => updateDataset(idx, 'label', e.target.value)}
                      className="w-24 bg-transparent border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                      placeholder="Label"
                    />
                    <input
                      value={ds.data} onChange={e => updateDataset(idx, 'data', e.target.value)}
                      className="flex-1 bg-transparent border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                      placeholder="10, 20, 30, 40, 50"
                    />
                    <input
                      type="color" value={ds.color} onChange={e => updateDataset(idx, 'color', e.target.value)}
                      className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded-sm"
                    />
                    {formDatasets.length > 1 && (
                      <button onClick={() => removeDataset(idx)} className="text-rmpg-500 hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <SmallBtn onClick={() => setShowForm(false)}>Cancel</SmallBtn>
                <SmallBtn onClick={createGraph} loading={saving} variant="primary">
                  <Plus className="w-3 h-3" /> Create Graph
                </SmallBtn>
              </div>
            </>
          )}
        </div>
      )}

      {/* Graph Cards */}
      {graphs.length === 0 ? (
        <EmptyState icon={BarChart3} message="No graphs yet. Create one or extract from a URL." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {graphs.map(g => (
            <div key={g.id} className="bg-surface-raised border border-rmpg-600 rounded-sm p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
                  {g.chart_type}
                </span>
                <span className="text-[10px] text-white font-medium truncate flex-1">{g.title}</span>
                <SmallBtn onClick={() => deleteGraph(g.id)} loading={deletingIds.has(g.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>
              <div className="text-[10px] text-rmpg-400 font-mono truncate">Labels: {g.labels}</div>
              <div className="flex flex-wrap gap-1">
                {(g.datasets || []).map((ds, i) => (
                  <span key={i} className="flex items-center gap-1 text-[9px] text-rmpg-300">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ds.color }} />
                    {ds.label}
                  </span>
                ))}
              </div>
              {g.source_url && (
                <div className="text-[9px] text-rmpg-500 font-mono truncate">Source: {g.source_url}</div>
              )}
              <div className="text-[9px] text-rmpg-500">{fmtDate(g.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ CONNECTORS PANEL (data-connectors)
// ══════════════════════════════════════════════════════════════

interface ConnectorSync {
  id: number;
  connector_id: number;
  status: 'success' | 'error' | 'running';
  records_processed: number;
  error_message: string | null;
  created_at: string;
}

interface Connector {
  id: number;
  name: string;
  type: string;
  url: string;
  schedule_hours: number;
  transform_prompt: string;
  status: 'active' | 'paused' | 'error';
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

function ConnectorsPanel() {
  const { addToast } = useToast();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [syncs, setSyncs] = useState<ConnectorSync[]>([]);
  const [syncsLoading, setSyncsLoading] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // Form
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('RSS');
  const [formUrl, setFormUrl] = useState('');
  const [formSchedule, setFormSchedule] = useState('24');
  const [formPrompt, setFormPrompt] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Connector[]>('/firecrawl-tools/connectors');
      setConnectors(data);
    } catch {
      addToast('Failed to load connectors', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadSyncs = useCallback(async (connectorId: number) => {
    setSyncsLoading(true);
    try {
      const data = await apiFetch<ConnectorSync[]>(`/firecrawl-tools/connectors/${connectorId}/syncs`);
      setSyncs(data);
    } catch {
      addToast('Failed to load sync history', 'error');
    } finally {
      setSyncsLoading(false);
    }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setSyncs([]);
    } else {
      setExpandedId(id);
      loadSyncs(id);
    }
  };

  const createConnector = async () => {
    if (!formName.trim() || !formUrl.trim()) {
      addToast('Name and URL are required', 'warning');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          type: formType,
          url: formUrl.trim(),
          schedule_hours: parseInt(formSchedule),
          transform_prompt: formPrompt.trim(),
        }),
      });
      addToast('Connector created', 'success');
      setShowForm(false);
      setFormName(''); setFormType('RSS'); setFormUrl(''); setFormSchedule('24'); setFormPrompt('');
      load();
    } catch {
      addToast('Failed to create connector', 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async (id: number) => {
    setSyncingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/connectors/${id}/sync`, { method: 'POST' });
      addToast('Sync triggered', 'success');
      load();
      if (expandedId === id) loadSyncs(id);
    } catch {
      addToast('Sync failed', 'error');
    } finally {
      setSyncingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteConnector = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/connectors/${id}`, { method: 'DELETE' });
      addToast('Connector deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setSyncs([]); }
      load();
    } catch {
      addToast('Failed to delete connector', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const typeBadgeColor = (type: string): string => {
    switch (type) {
      case 'RSS': return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
      case 'Sitemap': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'API': return 'bg-brand-500/10 border-brand-500/30 text-brand-400';
      case 'Webpage': return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
      default: return 'bg-rmpg-700/50 border-rmpg-600 text-rmpg-300';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Data Connectors" icon={Plug} statusLed="bg-orange-400" ledPulse>
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Connector
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
                placeholder="News Feed"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Type</label>
              <select
                value={formType} onChange={e => setFormType(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
              >
                <option value="RSS">RSS</option>
                <option value="Sitemap">Sitemap</option>
                <option value="API">API</option>
                <option value="Webpage">Webpage</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">URL *</label>
              <input
                value={formUrl} onChange={e => setFormUrl(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                placeholder="https://example.com/feed.xml"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Schedule (hours)</label>
              <input
                type="number" value={formSchedule} onChange={e => setFormSchedule(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
                min="1" max="720"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Transform Prompt</label>
            <textarea
              value={formPrompt} onChange={e => setFormPrompt(e.target.value)}
              rows={2}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none"
              placeholder="Extract key information and summarize..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <SmallBtn onClick={() => setShowForm(false)}>Cancel</SmallBtn>
            <SmallBtn onClick={createConnector} loading={saving} variant="primary">
              <Plus className="w-3 h-3" /> Create
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Connector List */}
      {connectors.length === 0 ? (
        <EmptyState icon={Plug} message="No connectors yet. Create one to sync external data." />
      ) : (
        <div className="space-y-1.5">
          {connectors.map(c => (
            <div key={c.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(c.id)} className="text-rmpg-500 hover:text-white">
                  {expandedId === c.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <StatusLed status={c.status} />
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${typeBadgeColor(c.type)}`}>
                  {c.type}
                </span>
                <span className="text-[10px] text-white font-medium truncate flex-1">{c.name}</span>
                <span className="text-[9px] text-rmpg-500 font-mono shrink-0">every {c.schedule_hours}h</span>
                {c.last_sync_at && <span className="text-[9px] text-rmpg-500 shrink-0">{fmtDate(c.last_sync_at)}</span>}
                <SmallBtn onClick={() => syncNow(c.id)} loading={syncingIds.has(c.id)} variant="primary">
                  <RefreshCw className="w-3 h-3" /> Sync
                </SmallBtn>
                <SmallBtn onClick={() => deleteConnector(c.id)} loading={deletingIds.has(c.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>
              {/* Sync History */}
              {expandedId === c.id && (
                <div className="border-t border-rmpg-700 px-3 py-2">
                  {syncsLoading ? (
                    <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                  ) : syncs.length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 py-2 text-center">No sync history</div>
                  ) : (
                    <div className="space-y-1">
                      {syncs.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-[10px]">
                          <StatusLed status={s.status} />
                          <span className="text-rmpg-300">{s.status}</span>
                          <span className="text-orange-400 font-mono">{s.records_processed} records</span>
                          {s.error_message && <span className="text-red-400 truncate flex-1">{s.error_message}</span>}
                          <span className="text-rmpg-500 shrink-0 ml-auto">{fmtDate(s.created_at)}</span>
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
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ RAG EVAL PANEL (rag-arena)
// ══════════════════════════════════════════════════════════════

interface RagEvalQuestion {
  question: string;
  relevance_score: number;
  completeness_score: number;
  answer_snippet: string;
}

interface RagEvalResult {
  id: number;
  url: string;
  overall_score: number;
  questions: RagEvalQuestion[];
  created_at: string;
}

function RagEvalPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [questions, setQuestions] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<RagEvalResult | null>(null);
  const [history, setHistory] = useState<RagEvalResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<RagEvalResult[]>('/firecrawl-tools/rag-eval/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const evaluate = async () => {
    if (!url.trim() || !questions.trim()) { addToast('Enter a URL and questions', 'warning'); return; }
    setEvaluating(true);
    try {
      const data = await apiFetch<RagEvalResult>('/firecrawl-tools/rag-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), questions: questions.trim().split('\n').filter(Boolean) }),
      });
      setResult(data);
      addToast('RAG evaluation complete', 'success');
      loadHistory();
    } catch {
      addToast('Evaluation failed', 'error');
    } finally {
      setEvaluating(false);
    }
  };

  const viewHistoryItem = (item: RagEvalResult) => {
    setResult(item);
    setUrl(item.url);
    setQuestions(item.questions.map(q => q.question).join('\n'));
    setShowHistory(false);
  };

  const scoreColor = (score: number): string => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="RAG Evaluation Arena" icon={Target} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
      </div>

      {/* Questions */}
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-0.5">Questions (one per line)</label>
        <textarea
          value={questions}
          onChange={e => setQuestions(e.target.value)}
          rows={4}
          className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none font-mono"
          placeholder={"What is the company's main product?\nWho is the CEO?\nWhat pricing plans are available?"}
        />
      </div>

      <SmallBtn onClick={evaluate} loading={evaluating} variant="primary">
        <Target className="w-3 h-3" /> Evaluate
      </SmallBtn>

      {/* History Dropdown */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past evaluations</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Target className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className={`text-[10px] font-bold ${scoreColor(item.overall_score)}`}>{item.overall_score}%</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {/* Overall Score */}
          <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-4 flex items-center justify-center">
            <div className="text-center">
              <div className={`text-4xl font-bold font-mono ${scoreColor(result.overall_score)}`}>{result.overall_score}</div>
              <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mt-1">Overall Score</div>
            </div>
          </div>

          {/* Per-question results */}
          <div className="space-y-1.5">
            {result.questions.map((q, i) => (
              <div key={i} className="bg-surface-raised border border-rmpg-600 rounded-sm p-2.5 space-y-1.5">
                <div className="text-[10px] text-white font-medium">{q.question}</div>
                {q.answer_snippet && (
                  <div className="text-[9px] text-rmpg-400 line-clamp-2">{q.answer_snippet}</div>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[9px] text-rmpg-400 mb-0.5">
                      <span>Relevance</span>
                      <span className={scoreColor(q.relevance_score)}>{q.relevance_score}%</span>
                    </div>
                    <div className="w-full h-1 bg-rmpg-700 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${q.relevance_score}%` }} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-[9px] text-rmpg-400 mb-0.5">
                      <span>Completeness</span>
                      <span className={scoreColor(q.completeness_score)}>{q.completeness_score}%</span>
                    </div>
                    <div className="w-full h-1 bg-rmpg-700 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${q.completeness_score}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !evaluating && (
        <EmptyState icon={Target} message="Enter a URL and questions to evaluate RAG quality." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ TRENDS PANEL (trendfinder)
// ══════════════════════════════════════════════════════════════

interface TrendItem {
  topic: string;
  mention_count: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  source_urls: string[];
}

interface TrendsResult {
  id: number;
  domain: string;
  keywords: string;
  time_range: string;
  trends: TrendItem[];
  created_at: string;
}

function TrendsPanel() {
  const { addToast } = useToast();
  const [domain, setDomain] = useState('');
  const [keywords, setKeywords] = useState('');
  const [timeRange, setTimeRange] = useState('7d');
  const [finding, setFinding] = useState(false);
  const [result, setResult] = useState<TrendsResult | null>(null);
  const [history, setHistory] = useState<TrendsResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<TrendsResult[]>('/firecrawl-tools/trends/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const findTrends = async () => {
    if (!domain.trim()) { addToast('Enter a domain', 'warning'); return; }
    setFinding(true);
    try {
      const data = await apiFetch<TrendsResult>('/firecrawl-tools/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim(), keywords: keywords.trim(), time_range: timeRange }),
      });
      setResult(data);
      addToast('Trends found', 'success');
      loadHistory();
    } catch {
      addToast('Failed to find trends', 'error');
    } finally {
      setFinding(false);
    }
  };

  const viewHistoryItem = (item: TrendsResult) => {
    setResult(item);
    setDomain(item.domain);
    setKeywords(item.keywords || '');
    setTimeRange(item.time_range);
    setShowHistory(false);
  };

  const sentimentBadge = (s: string) => {
    switch (s) {
      case 'positive': return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'negative': return 'bg-red-500/10 border-red-500/30 text-red-400';
      default: return 'bg-rmpg-700/50 border-rmpg-600 text-rmpg-300';
    }
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Trend Finder" icon={TrendingUp} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Inputs */}
      <div className="flex items-center gap-2">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="example.com"
        />
        <input
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
          placeholder="Optional keywords"
        />
        <select
          value={timeRange}
          onChange={e => setTimeRange(e.target.value)}
          className="bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none"
        >
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select>
        <SmallBtn onClick={findTrends} loading={finding} variant="primary">
          <TrendingUp className="w-3 h-3" /> Find Trends
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past trend searches</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <TrendingUp className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.domain}</span>
                <span className="text-[9px] text-rmpg-500 uppercase font-mono shrink-0">{item.time_range}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-1.5">
          {result.trends.map((trend, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600 rounded-sm p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white font-medium flex-1">{trend.topic}</span>
                <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
                  {trend.mention_count} mentions
                </span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${sentimentBadge(trend.sentiment)}`}>
                  {trend.sentiment}
                </span>
              </div>
              {trend.source_urls && trend.source_urls.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {trend.source_urls.map((sUrl, j) => (
                    <a
                      key={j}
                      href={sUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] text-brand-400 hover:underline font-mono truncate max-w-[200px]"
                    >
                      {sUrl.replace(/^https?:\/\//, '').split('/')[0]}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!result && !finding && (
        <EmptyState icon={TrendingUp} message="Enter a domain to discover trending topics and mentions." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ GEN UI PANEL (gen-ui-firecrawl)
// ══════════════════════════════════════════════════════════════

interface GenUiResult {
  id: number;
  url: string;
  component_type: string;
  layout_structure: string;
  elements: string[];
  colors: string[];
  fonts: string[];
  react_snippet: string;
  tailwind_classes: string[];
  created_at: string;
}

function GenUiPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [componentType, setComponentType] = useState('dashboard');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenUiResult | null>(null);
  const [history, setHistory] = useState<GenUiResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<GenUiResult[]>('/firecrawl-tools/gen-ui/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const generate = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setGenerating(true);
    try {
      const data = await apiFetch<GenUiResult>('/firecrawl-tools/gen-ui', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), component_type: componentType }),
      });
      setResult(data);
      addToast('UI generated', 'success');
      loadHistory();
    } catch {
      addToast('Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const viewHistoryItem = (item: GenUiResult) => {
    setResult(item);
    setUrl(item.url);
    setComponentType(item.component_type);
    setShowHistory(false);
  };

  const copySnippet = () => {
    if (!result?.react_snippet) return;
    navigator.clipboard.writeText(result.react_snippet).then(() => {
      addToast('Copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy', 'error');
    });
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Gen UI" icon={LayoutDashboard} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Inputs */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
        <select
          value={componentType}
          onChange={e => setComponentType(e.target.value)}
          className="bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none"
        >
          <option value="dashboard">Dashboard</option>
          <option value="form">Form</option>
          <option value="table">Table</option>
          <option value="card">Card</option>
          <option value="list">List</option>
        </select>
        <SmallBtn onClick={generate} loading={generating} variant="primary">
          <LayoutDashboard className="w-3 h-3" /> Generate
        </SmallBtn>
      </div>

      {/* History */}
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
                <LayoutDashboard className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[9px] text-rmpg-500 uppercase font-mono shrink-0">{item.component_type}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          {/* Structure Preview */}
          <div>
            <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Layout Structure</div>
            <div className="text-[10px] text-rmpg-300 whitespace-pre-wrap">{result.layout_structure}</div>
          </div>

          {/* Elements */}
          {result.elements && result.elements.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Elements</div>
              <div className="flex flex-wrap gap-1">
                {result.elements.map((el, i) => (
                  <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-rmpg-700/50 border border-rmpg-600 text-rmpg-300">
                    {el}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Colors & Fonts */}
          <div className="flex gap-4">
            {result.colors && result.colors.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Colors</div>
                <div className="flex gap-1">
                  {result.colors.map((c, i) => (
                    <div key={i} className="w-6 h-6 rounded-sm border border-rmpg-600" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
            )}
            {result.fonts && result.fonts.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Fonts</div>
                <div className="flex flex-wrap gap-1">
                  {result.fonts.map((f, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm bg-purple-500/10 border border-purple-500/30 text-purple-400">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* React Snippet */}
          {result.react_snippet && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">React Component</div>
                <SmallBtn onClick={copySnippet} variant="primary">
                  <Clipboard className="w-3 h-3" /> Copy
                </SmallBtn>
              </div>
              <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-64 overflow-auto scrollbar-dark whitespace-pre-wrap">
                {result.react_snippet}
              </pre>
            </div>
          )}

          {/* Tailwind Classes */}
          {result.tailwind_classes && result.tailwind_classes.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Tailwind Classes</div>
              <div className="flex flex-wrap gap-1">
                {result.tailwind_classes.map((cls, i) => (
                  <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                    {cls}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !generating && (
        <EmptyState icon={LayoutDashboard} message="Enter a URL to generate React UI components from its design." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ QA CLUSTER PANEL (QA_clustering)
// ══════════════════════════════════════════════════════════════

interface QaCluster {
  theme: string;
  questions: string[];
}

interface QaClusterResult {
  id: number;
  total_questions: number;
  cluster_count: number;
  clusters: QaCluster[];
  created_at: string;
}

function QaClusterPanel() {
  const { addToast } = useToast();
  const [questionsInput, setQuestionsInput] = useState('');
  const [clustering, setClustering] = useState(false);
  const [result, setResult] = useState<QaClusterResult | null>(null);
  const [history, setHistory] = useState<QaClusterResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<QaClusterResult[]>('/firecrawl-tools/qa-cluster/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const cluster = async () => {
    const lines = questionsInput.trim().split('\n').filter(Boolean);
    if (lines.length === 0) { addToast('Enter at least one question', 'warning'); return; }
    setClustering(true);
    try {
      const data = await apiFetch<QaClusterResult>('/firecrawl-tools/qa-cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: lines }),
      });
      setResult(data);
      setExpandedClusters(new Set());
      addToast('Clustering complete', 'success');
      loadHistory();
    } catch {
      addToast('Clustering failed', 'error');
    } finally {
      setClustering(false);
    }
  };

  const viewHistoryItem = (item: QaClusterResult) => {
    setResult(item);
    setExpandedClusters(new Set());
    setShowHistory(false);
  };

  const toggleCluster = (idx: number) => {
    setExpandedClusters(prev => {
      const s = new Set(prev);
      if (s.has(idx)) s.delete(idx);
      else s.add(idx);
      return s;
    });
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="QA Clustering" icon={Layers} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Questions Input */}
      <div>
        <label className="block text-[10px] text-rmpg-400 mb-0.5">Questions (one per line)</label>
        <textarea
          value={questionsInput}
          onChange={e => setQuestionsInput(e.target.value)}
          rows={6}
          className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none font-mono"
          placeholder={"How do I reset my password?\nI forgot my login credentials\nWhere can I change my email?\nHow to update profile settings?"}
        />
      </div>

      <SmallBtn onClick={cluster} loading={clustering} variant="primary">
        <Layers className="w-3 h-3" /> Cluster
      </SmallBtn>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past clusters</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Layers className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.total_questions} questions</span>
                <span className="text-[9px] text-orange-400 font-mono shrink-0">{item.cluster_count} clusters</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="flex gap-3">
            <div className="bg-surface-raised border border-rmpg-600 rounded-sm px-3 py-2 text-center">
              <div className="text-lg font-bold text-orange-400 font-mono">{result.total_questions}</div>
              <div className="text-[9px] text-rmpg-400 uppercase tracking-wider">Questions</div>
            </div>
            <div className="bg-surface-raised border border-rmpg-600 rounded-sm px-3 py-2 text-center">
              <div className="text-lg font-bold text-brand-400 font-mono">{result.cluster_count}</div>
              <div className="text-[9px] text-rmpg-400 uppercase tracking-wider">Clusters</div>
            </div>
          </div>

          {/* Cluster Cards */}
          <div className="space-y-1.5">
            {result.clusters.map((cl, idx) => (
              <div key={idx} className="bg-surface-raised border border-rmpg-600 rounded-sm">
                <button
                  onClick={() => toggleCluster(idx)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-rmpg-700/30"
                >
                  {expandedClusters.has(idx) ? <ChevronDown className="w-3 h-3 text-rmpg-500" /> : <ChevronRight className="w-3 h-3 text-rmpg-500" />}
                  <span className="text-[10px] text-white font-medium flex-1">{cl.theme}</span>
                  <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
                    {cl.questions.length}
                  </span>
                </button>
                {expandedClusters.has(idx) && (
                  <div className="border-t border-rmpg-700 px-3 py-2 space-y-0.5">
                    {cl.questions.map((q, qi) => (
                      <div key={qi} className="text-[10px] text-rmpg-300 flex items-start gap-1.5">
                        <span className="text-rmpg-500 shrink-0">{qi + 1}.</span>
                        {q}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !clustering && (
        <EmptyState icon={Layers} message="Enter questions (one per line) to automatically group them by theme." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ EXTRACT PANEL (structured-outputs)
// ══════════════════════════════════════════════════════════════

interface ExtractField {
  name: string;
  type: string;
  description: string;
}

interface ExtractedData {
  key: string;
  value: string;
  confidence: number;
}

interface ExtractResult {
  id: number;
  url: string;
  schema_fields: ExtractField[];
  extracted_data: ExtractedData[];
  confidence_score: number;
  fields_found: number;
  fields_missing: number;
  created_at: string;
}

function ExtractPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [fields, setFields] = useState<ExtractField[]>([{ name: '', type: 'string', description: '' }]);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [history, setHistory] = useState<ExtractResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<ExtractResult[]>('/firecrawl-tools/extract/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const addField = () => {
    setFields(prev => [...prev, { name: '', type: 'string', description: '' }]);
  };

  const removeField = (idx: number) => {
    setFields(prev => prev.filter((_, i) => i !== idx));
  };

  const updateField = (idx: number, key: keyof ExtractField, value: string) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: value } : f));
  };

  const extract = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    const validFields = fields.filter(f => f.name.trim());
    if (validFields.length === 0) { addToast('Add at least one field', 'warning'); return; }
    setExtracting(true);
    try {
      const data = await apiFetch<ExtractResult>('/firecrawl-tools/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), schema_fields: validFields }),
      });
      setResult(data);
      addToast('Extraction complete', 'success');
      loadHistory();
    } catch {
      addToast('Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const viewHistoryItem = (item: ExtractResult) => {
    setResult(item);
    setUrl(item.url);
    setFields(item.schema_fields.length > 0 ? item.schema_fields : [{ name: '', type: 'string', description: '' }]);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Structured Extract" icon={Database} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* URL Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
      </div>

      {/* Schema Builder */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">Schema Fields</span>
          <SmallBtn onClick={addField}><Plus className="w-3 h-3" /> Add Field</SmallBtn>
        </div>
        {fields.map((f, idx) => (
          <div key={idx} className="flex items-center gap-2 bg-surface-sunken border border-rmpg-700 rounded-sm p-1.5">
            <input
              value={f.name} onChange={e => updateField(idx, 'name', e.target.value)}
              className="w-28 bg-transparent border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="Field name"
            />
            <select
              value={f.type} onChange={e => updateField(idx, 'type', e.target.value)}
              className="bg-transparent border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white focus:border-orange-500/50 focus:outline-none"
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="array">Array</option>
            </select>
            <input
              value={f.description} onChange={e => updateField(idx, 'description', e.target.value)}
              className="flex-1 bg-transparent border border-rmpg-600 rounded-sm px-1.5 py-0.5 text-[10px] text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="Description"
            />
            {fields.length > 1 && (
              <button onClick={() => removeField(idx)} className="text-rmpg-500 hover:text-red-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      <SmallBtn onClick={extract} loading={extracting} variant="primary">
        <Database className="w-3 h-3" /> Extract
      </SmallBtn>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past extractions</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Database className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[9px] text-orange-400 font-mono shrink-0">{item.fields_found}/{item.fields_found + item.fields_missing}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          {/* Confidence + Stats */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-rmpg-400">Confidence:</span>
              <span className={`text-[10px] font-bold font-mono ${result.confidence_score >= 80 ? 'text-emerald-400' : result.confidence_score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {result.confidence_score}%
              </span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              {result.fields_found} found
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-red-500/10 border border-red-500/30 text-red-400">
              {result.fields_missing} missing
            </span>
          </div>

          {/* Extracted Data Table */}
          <div className="border border-rmpg-700 rounded-sm overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-surface-sunken">
                  <th className="text-left px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Key</th>
                  <th className="text-left px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Value</th>
                  <th className="text-right px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Conf</th>
                </tr>
              </thead>
              <tbody>
                {result.extracted_data.map((d, i) => (
                  <tr key={i} className="border-b border-rmpg-700 last:border-0 hover:bg-rmpg-700/30">
                    <td className="px-2 py-1 text-white font-mono">{d.key}</td>
                    <td className="px-2 py-1 text-rmpg-300">{d.value}</td>
                    <td className={`px-2 py-1 text-right font-mono ${d.confidence >= 80 ? 'text-emerald-400' : d.confidence >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                      {d.confidence}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!result && !extracting && (
        <EmptyState icon={Database} message="Enter a URL and define a schema to extract structured data." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ HTML→MD PANEL (html-to-markdown)
// ══════════════════════════════════════════════════════════════

interface HtmlToMdResult {
  id: number;
  url: string | null;
  markdown: string;
  word_count: number;
  link_count: number;
  image_count: number;
  created_at: string;
}

function HtmlToMdPanel() {
  const { addToast } = useToast();
  const [mode, setMode] = useState<'url' | 'paste'>('url');
  const [url, setUrl] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [includeLinks, setIncludeLinks] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<HtmlToMdResult | null>(null);
  const [history, setHistory] = useState<HtmlToMdResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<HtmlToMdResult[]>('/firecrawl-tools/html-to-md/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const convert = async () => {
    if (mode === 'url' && !url.trim()) { addToast('Enter a URL', 'warning'); return; }
    if (mode === 'paste' && !htmlInput.trim()) { addToast('Paste some HTML', 'warning'); return; }
    setConverting(true);
    try {
      const data = await apiFetch<HtmlToMdResult>('/firecrawl-tools/html-to-md', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: mode === 'url' ? url.trim() : undefined,
          html: mode === 'paste' ? htmlInput.trim() : undefined,
          include_links: includeLinks,
          include_images: includeImages,
        }),
      });
      setResult(data);
      addToast('Conversion complete', 'success');
      loadHistory();
    } catch {
      addToast('Conversion failed', 'error');
    } finally {
      setConverting(false);
    }
  };

  const viewHistoryItem = (item: HtmlToMdResult) => {
    setResult(item);
    if (item.url) { setUrl(item.url); setMode('url'); }
    setShowHistory(false);
  };

  const copyMarkdown = () => {
    if (!result?.markdown) return;
    navigator.clipboard.writeText(result.markdown).then(() => {
      addToast('Copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy', 'error');
    });
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="HTML to Markdown" icon={FileCode} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <SmallBtn onClick={() => setMode('url')} variant={mode === 'url' ? 'primary' : 'default'}>URL</SmallBtn>
        <SmallBtn onClick={() => setMode('paste')} variant={mode === 'paste' ? 'primary' : 'default'}>Paste HTML</SmallBtn>
      </div>

      {/* Input */}
      {mode === 'url' ? (
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && convert()}
            className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="https://example.com"
          />
        </div>
      ) : (
        <textarea
          value={htmlInput}
          onChange={e => setHtmlInput(e.target.value)}
          rows={5}
          className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none resize-none font-mono"
          placeholder="<h1>Paste HTML here</h1>"
        />
      )}

      {/* Options */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={includeLinks} onChange={e => setIncludeLinks(e.target.checked)} className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/30 w-3 h-3" />
          <span className="text-[10px] text-rmpg-300">Include links</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={includeImages} onChange={e => setIncludeImages(e.target.checked)} className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/30 w-3 h-3" />
          <span className="text-[10px] text-rmpg-300">Include images</span>
        </label>
        <SmallBtn onClick={convert} loading={converting} variant="primary">
          <FileCode className="w-3 h-3" /> Convert
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past conversions</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <FileCode className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url || 'Pasted HTML'}</span>
                <span className="text-[9px] text-rmpg-500 font-mono shrink-0">{item.word_count} words</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          {/* Stats */}
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
              {result.word_count} words
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-brand-500/10 border border-brand-500/30 text-brand-400">
              {result.link_count} links
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-purple-500/10 border border-purple-500/30 text-purple-400">
              {result.image_count} images
            </span>
            <div className="flex-1" />
            <SmallBtn onClick={copyMarkdown} variant="primary">
              <Clipboard className="w-3 h-3" /> Copy
            </SmallBtn>
          </div>

          {/* Markdown Output */}
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-96 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {result.markdown || 'No markdown generated'}
          </pre>
        </div>
      )}

      {!result && !converting && (
        <EmptyState icon={FileCode} message="Enter a URL or paste HTML to convert to Markdown." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ COUPONS PANEL (firecrawl-coupon-finder)
// ══════════════════════════════════════════════════════════════

interface Coupon {
  code: string;
  description: string;
  expiry_date: string | null;
  verified: boolean;
}

interface CouponResult {
  id: number;
  brand_or_url: string;
  coupons: Coupon[];
  found_count: number;
  created_at: string;
}

function CouponsPanel() {
  const { addToast } = useToast();
  const [input, setInput] = useState('');
  const [finding, setFinding] = useState(false);
  const [result, setResult] = useState<CouponResult | null>(null);
  const [history, setHistory] = useState<CouponResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<CouponResult[]>('/firecrawl-tools/coupons/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const findCoupons = async () => {
    if (!input.trim()) { addToast('Enter a brand or URL', 'warning'); return; }
    setFinding(true);
    try {
      const data = await apiFetch<CouponResult>('/firecrawl-tools/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_or_url: input.trim() }),
      });
      setResult(data);
      addToast(`Found ${data.found_count} coupons`, 'success');
      loadHistory();
    } catch {
      addToast('Failed to find coupons', 'error');
    } finally {
      setFinding(false);
    }
  };

  const viewHistoryItem = (item: CouponResult) => {
    setResult(item);
    setInput(item.brand_or_url);
    setShowHistory(false);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      addToast('Code copied', 'success');
    }).catch(() => {
      addToast('Failed to copy', 'error');
    });
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Coupon Finder" icon={Ticket} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && findCoupons()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
          placeholder="Brand name or URL (e.g. Nike, amazon.com)"
        />
        <SmallBtn onClick={findCoupons} loading={finding} variant="primary">
          <Ticket className="w-3 h-3" /> Find Coupons
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past coupon searches</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Ticket className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.brand_or_url}</span>
                <span className="text-[9px] text-orange-400 font-mono shrink-0">{item.found_count} found</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {/* Found Count */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
              {result.found_count} coupons found
            </span>
            <span className="text-[10px] text-rmpg-400">{result.brand_or_url}</span>
          </div>

          {/* Coupon Cards */}
          <div className="space-y-1.5">
            {result.coupons.map((coupon, i) => (
              <div key={i} className="bg-surface-raised border border-rmpg-600 rounded-sm p-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-mono font-bold bg-surface-sunken border border-rmpg-700 rounded-sm px-2 py-0.5">
                      {coupon.code}
                    </span>
                    {coupon.verified && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle className="w-2.5 h-2.5" /> Verified
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-rmpg-300">{coupon.description}</div>
                  {coupon.expiry_date && (
                    <div className="text-[9px] text-rmpg-500">Expires: {fmtDate(coupon.expiry_date)}</div>
                  )}
                </div>
                <SmallBtn onClick={() => copyCode(coupon.code)} variant="primary">
                  <Clipboard className="w-3 h-3" /> Copy
                </SmallBtn>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !finding && (
        <EmptyState icon={Ticket} message="Enter a brand or URL to find active coupon codes." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ BRAND EXTEND PANEL (brand-extender)
// ══════════════════════════════════════════════════════════════

interface BrandExtendResult {
  id: number;
  url: string;
  brand_name: string;
  colors: string[];
  fonts: string[];
  tone_keywords: string[];
  social_profiles: { platform: string; url: string }[];
  competitors: string[];
  extension_suggestions: string[];
  created_at: string;
}

function BrandExtendPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<BrandExtendResult | null>(null);
  const [history, setHistory] = useState<BrandExtendResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<BrandExtendResult[]>('/firecrawl-tools/brand-extend/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const analyze = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setAnalyzing(true);
    try {
      const data = await apiFetch<BrandExtendResult>('/firecrawl-tools/brand-extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('Brand analyzed', 'success');
      loadHistory();
    } catch {
      addToast('Brand analysis failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const viewHistoryItem = (item: BrandExtendResult) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Brand Extender" icon={Palette} statusLed="bg-orange-400">
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
          <Palette className="w-3 h-3" /> Analyze
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past analyses</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Palette className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[10px] text-white shrink-0">{item.brand_name}</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-3">
          {/* Brand Name */}
          <div className="text-sm text-white font-bold">{result.brand_name}</div>

          {/* Colors */}
          {result.colors && result.colors.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Colors</div>
              <div className="flex gap-1.5">
                {result.colors.map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    <div className="w-8 h-8 rounded-sm border border-rmpg-600" style={{ backgroundColor: c }} />
                    <span className="text-[8px] text-rmpg-500 font-mono">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fonts */}
          {result.fonts && result.fonts.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Fonts</div>
              <div className="flex flex-wrap gap-1">
                {result.fonts.map((f, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm bg-purple-500/10 border border-purple-500/30 text-purple-400">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tone Keywords */}
          {result.tone_keywords && result.tone_keywords.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Tone</div>
              <div className="flex flex-wrap gap-1">
                {result.tone_keywords.map((kw, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Social Profiles */}
          {result.social_profiles && result.social_profiles.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Social Profiles</div>
              <div className="flex flex-wrap gap-1.5">
                {result.social_profiles.map((sp, i) => (
                  <a
                    key={i}
                    href={sp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-brand-500/10 border border-brand-500/30 text-brand-400 hover:underline"
                  >
                    <ExternalLink className="w-2.5 h-2.5" /> {sp.platform}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Competitors */}
          {result.competitors && result.competitors.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Competitors</div>
              <div className="flex flex-wrap gap-1">
                {result.competitors.map((comp, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm bg-red-500/10 border border-red-500/30 text-red-400">
                    {comp}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Extension Suggestions */}
          {result.extension_suggestions && result.extension_suggestions.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Extension Suggestions</div>
              <ul className="space-y-0.5">
                {result.extension_suggestions.map((sug, i) => (
                  <li key={i} className="text-[10px] text-rmpg-300 flex items-start gap-1.5">
                    <ArrowRight className="w-2.5 h-2.5 text-orange-400 shrink-0 mt-0.5" />
                    {sug}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!result && !analyzing && (
        <EmptyState icon={Palette} message="Enter a brand URL to analyze colors, fonts, tone, and get extension ideas." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ MCP PANEL (firecrawl-mcp-server)
// ══════════════════════════════════════════════════════════════

interface McpLog {
  id: number;
  timestamp: string;
  tool: string;
  status: 'success' | 'error';
  message?: string;
}

interface McpConfig {
  server_url: string;
  api_key: string;
  enabled: boolean;
}

interface McpConnectionResult {
  connected: boolean;
  capabilities: string[];
  version?: string;
}

function McpPanel() {
  const { addToast } = useToast();
  const [config, setConfig] = useState<McpConfig>({ server_url: '', api_key: '', enabled: true });
  const [logs, setLogs] = useState<McpLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<McpConnectionResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<McpConfig>('/firecrawl-tools/mcp/config');
      setConfig(data);
    } catch { /* fresh config */ } finally { setLoading(false); }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await apiFetch<McpLog[]>('/firecrawl-tools/mcp/logs');
      setLogs(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadConfig(); loadLogs(); }, [loadConfig, loadLogs]);

  const testConnection = async () => {
    if (!config.server_url.trim()) { addToast('Enter a server URL', 'warning'); return; }
    setTesting(true);
    setConnection(null);
    try {
      const data = await apiFetch<McpConnectionResult>('/firecrawl-tools/mcp/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_url: config.server_url.trim() }),
      });
      setConnection(data);
      addToast(data.connected ? 'Connected successfully' : 'Connection failed', data.connected ? 'success' : 'error');
      loadLogs();
    } catch {
      addToast('Connection test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      addToast('MCP config saved', 'success');
    } catch {
      addToast('Failed to save config', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="MCP Server" icon={Server} statusLed={connection?.connected ? 'bg-emerald-400' : 'bg-red-400'}>
        <SmallBtn onClick={loadLogs}><RefreshCw className="w-3 h-3" /> Refresh Logs</SmallBtn>
      </PanelTitleBar>

      {/* Config Form */}
      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Server URL</label>
            <input
              value={config.server_url}
              onChange={e => setConfig(prev => ({ ...prev, server_url: e.target.value }))}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder="http://localhost:3002/mcp"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">API Key</label>
            <div className="flex items-center gap-1">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={config.api_key}
                onChange={e => setConfig(prev => ({ ...prev, api_key: e.target.value }))}
                className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
                placeholder="fc-••••••••"
              />
              <button onClick={() => setShowApiKey(!showApiKey)} className="text-rmpg-500 hover:text-white">
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
              className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/50"
            />
            Enabled
          </label>
          <div className="flex-1" />
          <SmallBtn onClick={testConnection} loading={testing} variant="primary">
            <Plug className="w-3 h-3" /> Test Connection
          </SmallBtn>
          <SmallBtn onClick={saveConfig} loading={saving} variant="primary">
            <CheckCircle className="w-3 h-3" /> Save
          </SmallBtn>
        </div>
      </div>

      {/* Connection Status */}
      {connection && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="flex items-center gap-2">
            <StatusLed status={connection.connected ? 'active' : 'error'} />
            <span className="text-xs text-white font-medium">{connection.connected ? 'Connected' : 'Disconnected'}</span>
            {connection.version && <span className="text-[10px] text-rmpg-500 font-mono">v{connection.version}</span>}
          </div>
          {connection.capabilities.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Capabilities</div>
              <div className="flex flex-wrap gap-1">
                {connection.capabilities.map((cap, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Logs */}
      {logs.length > 0 && (
        <div className="border border-rmpg-700 rounded-sm overflow-hidden">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-surface-sunken">
                <th className="text-left px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Time</th>
                <th className="text-left px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Tool</th>
                <th className="text-left px-2 py-1 text-rmpg-400 font-medium border-b border-rmpg-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-rmpg-700 last:border-0 hover:bg-rmpg-700/30">
                  <td className="px-2 py-1 text-rmpg-500 font-mono">{fmtDate(log.timestamp)}</td>
                  <td className="px-2 py-1 text-white font-mono">{log.tool}</td>
                  <td className="px-2 py-1">
                    <StatusLed status={log.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logs.length === 0 && !connection && (
        <EmptyState icon={Server} message="Configure MCP server connection to enable Firecrawl tool integration." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ EXAMPLES PANEL (firecrawl-app-examples)
// ══════════════════════════════════════════════════════════════

interface FirecrawlExample {
  id: number;
  name: string;
  description: string;
  category: 'scraping' | 'search' | 'extraction' | 'monitoring' | 'enrichment' | 'research';
  config_json: string;
  source_url: string;
  created_at: string;
}

function ExamplesPanel() {
  const { addToast } = useToast();
  const [examples, setExamples] = useState<FirecrawlExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<FirecrawlExample['category']>('scraping');
  const [formConfig, setFormConfig] = useState('{}');
  const [formSourceUrl, setFormSourceUrl] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<FirecrawlExample[]>('/firecrawl-tools/examples');
      setExamples(data);
    } catch {
      addToast('Failed to load examples', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const createExample = async () => {
    if (!formName.trim()) { addToast('Name is required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDesc.trim(),
          category: formCategory,
          config_json: formConfig,
          source_url: formSourceUrl.trim(),
        }),
      });
      addToast('Example created', 'success');
      setShowForm(false);
      setFormName(''); setFormDesc(''); setFormCategory('scraping'); setFormConfig('{}'); setFormSourceUrl('');
      load();
    } catch {
      addToast('Failed to create example', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runExample = async (id: number) => {
    setRunningIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/examples/${id}/run`, { method: 'POST' });
      addToast('Example run triggered', 'success');
    } catch {
      addToast('Failed to run example', 'error');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteExample = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/examples/${id}`, { method: 'DELETE' });
      addToast('Example deleted', 'success');
      load();
    } catch {
      addToast('Failed to delete example', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const categoryColors: Record<string, string> = {
    scraping: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    search: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
    extraction: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    monitoring: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    enrichment: 'bg-pink-500/10 border-pink-500/30 text-pink-400',
    research: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Examples" icon={FolderOpen} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Example
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
                placeholder="e.g. Scrape Product Pages"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Category</label>
              <select
                value={formCategory} onChange={e => setFormCategory(e.target.value as FirecrawlExample['category'])}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
              >
                <option value="scraping">Scraping</option>
                <option value="search">Search</option>
                <option value="extraction">Extraction</option>
                <option value="monitoring">Monitoring</option>
                <option value="enrichment">Enrichment</option>
                <option value="research">Research</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Description</label>
            <input
              value={formDesc} onChange={e => setFormDesc(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="What this example demonstrates..."
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Source URL</label>
            <input
              value={formSourceUrl} onChange={e => setFormSourceUrl(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder="https://github.com/mendableai/firecrawl-app-examples/..."
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Config JSON</label>
            <textarea
              value={formConfig} onChange={e => setFormConfig(e.target.value)}
              rows={4}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder='{ "url": "...", "options": { ... } }'
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createExample} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Example Cards */}
      {examples.length === 0 ? (
        <EmptyState icon={FolderOpen} message="No examples yet. Create one to save and run Firecrawl configurations." />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {examples.map(ex => (
            <div key={ex.id} className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white flex-1 truncate">{ex.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-sm border ${categoryColors[ex.category] || 'bg-rmpg-700 border-rmpg-600 text-rmpg-400'}`}>
                  {ex.category}
                </span>
              </div>
              {ex.description && <div className="text-[10px] text-rmpg-400 leading-relaxed">{ex.description}</div>}
              {ex.source_url && (
                <a href={ex.source_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-brand-400 hover:underline font-mono truncate block">
                  <ExternalLink className="w-2.5 h-2.5 inline mr-1" />{ex.source_url}
                </a>
              )}
              <div className="flex items-center gap-1.5 pt-1">
                <SmallBtn onClick={() => runExample(ex.id)} loading={runningIds.has(ex.id)} variant="primary">
                  <Play className="w-3 h-3" /> Run
                </SmallBtn>
                <SmallBtn onClick={() => deleteExample(ex.id)} loading={deletingIds.has(ex.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ LLMS.TXT V2 PANEL (llmstxt-generator)
// ══════════════════════════════════════════════════════════════

interface LlmsTxtV2Result {
  id: number;
  url: string;
  llmstxt: string;
  llmstxt_full: string;
  pages_crawled: number;
  word_count: number;
  created_at: string;
}

function LlmsTxtV2Panel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(50);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<LlmsTxtV2Result | null>(null);
  const [resultTab, setResultTab] = useState<'short' | 'full'>('short');
  const [history, setHistory] = useState<LlmsTxtV2Result[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<LlmsTxtV2Result[]>('/firecrawl-tools/llmstxt-full/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const generate = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setGenerating(true);
    try {
      const data = await apiFetch<LlmsTxtV2Result>('/firecrawl-tools/llmstxt-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), depth, max_pages: maxPages }),
      });
      setResult(data);
      addToast('LLMs.txt V2 generated', 'success');
      loadHistory();
    } catch {
      addToast('Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const copyContent = (content: string) => {
    navigator.clipboard.writeText(content).then(() => addToast('Copied to clipboard', 'success')).catch(() => addToast('Copy failed', 'error'));
  };

  const viewHistoryItem = (item: LlmsTxtV2Result) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="LLMs.txt V2 Generator" icon={FileText} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Inputs */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-rmpg-400">Depth:</label>
          <input
            type="number" min={1} max={10} value={depth} onChange={e => setDepth(Number(e.target.value))}
            className="w-12 bg-surface-sunken border border-rmpg-600 rounded-sm px-1.5 py-1.5 text-xs text-white text-center focus:border-orange-500/50 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-rmpg-400">Max:</label>
          <input
            type="number" min={1} max={500} value={maxPages} onChange={e => setMaxPages(Number(e.target.value))}
            className="w-14 bg-surface-sunken border border-rmpg-600 rounded-sm px-1.5 py-1.5 text-xs text-white text-center focus:border-orange-500/50 focus:outline-none"
          />
        </div>
        <SmallBtn onClick={generate} loading={generating} variant="primary">
          <FileText className="w-3 h-3" /> Generate
        </SmallBtn>
      </div>

      {/* History */}
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
                <span className="text-[10px] text-orange-400 shrink-0">{item.pages_crawled} pages</span>
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
            <span className="text-[10px] text-orange-400 font-mono">{result.pages_crawled} pages crawled</span>
            <span className="text-[10px] text-rmpg-400 font-mono">{result.word_count.toLocaleString()} words</span>
            <div className="flex-1" />
            {/* Tab toggle */}
            <div className="flex items-center gap-0.5 bg-surface-sunken rounded-sm p-0.5">
              <button
                onClick={() => setResultTab('short')}
                className={`px-2 py-0.5 text-[10px] rounded-sm transition-colors ${resultTab === 'short' ? 'bg-orange-500/20 text-orange-300' : 'text-rmpg-400 hover:text-white'}`}
              >
                llms.txt
              </button>
              <button
                onClick={() => setResultTab('full')}
                className={`px-2 py-0.5 text-[10px] rounded-sm transition-colors ${resultTab === 'full' ? 'bg-orange-500/20 text-orange-300' : 'text-rmpg-400 hover:text-white'}`}
              >
                llms-full.txt
              </button>
            </div>
            <SmallBtn onClick={() => copyContent(resultTab === 'short' ? result.llmstxt : result.llmstxt_full)} variant="primary">
              <Clipboard className="w-3 h-3" /> Copy
            </SmallBtn>
          </div>
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-96 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {resultTab === 'short' ? (result.llmstxt || 'No content') : (result.llmstxt_full || 'No content')}
          </pre>
        </div>
      )}

      {!result && !generating && (
        <EmptyState icon={FileText} message="Enter a URL to generate llms.txt and llms-full.txt files with depth control." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ MENDABLE PANEL (mendable-nextjs-chatbot)
// ══════════════════════════════════════════════════════════════

interface MendableBot {
  id: number;
  name: string;
  source_urls: string[];
  system_prompt: string;
  welcome_message: string;
  status: 'ready' | 'indexing' | 'error';
  created_at: string;
}

interface MendableMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
}

function MendablePanel() {
  const { addToast } = useToast();
  const [bots, setBots] = useState<MendableBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [activeBotId, setActiveBotId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MendableMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [asking, setAsking] = useState(false);

  const [formName, setFormName] = useState('');
  const [formUrls, setFormUrls] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formWelcome, setFormWelcome] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<MendableBot[]>('/firecrawl-tools/mendable');
      setBots(data);
    } catch {
      addToast('Failed to load bots', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const createBot = async () => {
    if (!formName.trim() || !formUrls.trim()) { addToast('Name and source URLs required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/mendable/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          source_urls: formUrls.split('\n').map(u => u.trim()).filter(Boolean),
          system_prompt: formPrompt.trim(),
          welcome_message: formWelcome.trim(),
        }),
      });
      addToast('Mendable bot created', 'success');
      setShowForm(false);
      setFormName(''); setFormUrls(''); setFormPrompt(''); setFormWelcome('');
      load();
    } catch {
      addToast('Failed to create bot', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteBot = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/mendable/${id}`, { method: 'DELETE' });
      addToast('Bot deleted', 'success');
      if (activeBotId === id) { setActiveBotId(null); setMessages([]); }
      load();
    } catch {
      addToast('Failed to delete bot', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const openChat = (bot: MendableBot) => {
    if (activeBotId === bot.id) {
      setActiveBotId(null);
      setMessages([]);
    } else {
      setActiveBotId(bot.id);
      setMessages(bot.welcome_message ? [{ role: 'assistant', content: bot.welcome_message }] : []);
      setChatInput('');
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !activeBotId) return;
    const userMsg: MendableMessage = { role: 'user', content: chatInput.trim() };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setAsking(true);
    try {
      const data = await apiFetch<{ answer: string; citations?: string[] }>(`/firecrawl-tools/mendable/${activeBotId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content }),
      });
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, citations: data.citations }]);
    } catch {
      addToast('Failed to get response', 'error');
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
      <PanelTitleBar title="Mendable Chatbot" icon={Bot} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Bot
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
                placeholder="e.g. Docs Assistant"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Welcome Message</label>
              <input
                value={formWelcome} onChange={e => setFormWelcome(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                placeholder="Hi! How can I help you today?"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Source URLs * (one per line)</label>
            <textarea
              value={formUrls} onChange={e => setFormUrls(e.target.value)}
              rows={3}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder="https://docs.example.com&#10;https://blog.example.com"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">System Prompt</label>
            <textarea
              value={formPrompt} onChange={e => setFormPrompt(e.target.value)}
              rows={2}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="You are a helpful assistant that answers questions about..."
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
        <EmptyState icon={Bot} message="No Mendable bots yet. Create one from source URLs to start chatting." />
      ) : (
        <div className="space-y-1">
          {bots.map(bot => (
            <div key={bot.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <StatusLed status={bot.status === 'ready' ? 'active' : bot.status} />
                <Bot className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-xs font-medium text-white flex-1 truncate">{bot.name}</span>
                <span className="text-[10px] text-rmpg-500">{bot.source_urls.length} source{bot.source_urls.length !== 1 ? 's' : ''}</span>
                <SmallBtn onClick={() => openChat(bot)} variant={activeBotId === bot.id ? 'primary' : 'default'} disabled={bot.status !== 'ready'}>
                  <MessageSquare className="w-3 h-3" /> {activeBotId === bot.id ? 'Close' : 'Chat'}
                </SmallBtn>
                <SmallBtn onClick={() => deleteBot(bot.id)} loading={deletingIds.has(bot.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Chat Interface */}
              {activeBotId === bot.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2">
                  <div className="max-h-64 overflow-y-auto scrollbar-dark space-y-2">
                    {messages.length === 0 && (
                      <div className="text-[10px] text-rmpg-500 text-center py-4">Start a conversation...</div>
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
                                <a key={ci} href={cite} target="_blank" rel="noopener noreferrer"
                                  className="text-[9px] text-brand-400 hover:underline font-mono block truncate">
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
                  <div className="flex items-center gap-2">
                    <input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendMessage()}
                      className="flex-1 bg-rmpg-800 border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
                      placeholder="Ask a question..."
                      disabled={asking}
                    />
                    <SmallBtn onClick={sendMessage} loading={asking} variant="primary" disabled={!chatInput.trim()}>
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
// ██ NEWS PANEL (aginews)
// ══════════════════════════════════════════════════════════════

interface NewsArticle {
  title: string;
  summary: string;
  published_date: string;
  source: string;
  url: string;
}

interface NewsResult {
  id: number;
  topic: string;
  articles: NewsArticle[];
  created_at: string;
}

function NewsPanel() {
  const { addToast } = useToast();
  const [topic, setTopic] = useState('');
  const [sources, setSources] = useState('');
  const [maxResults, setMaxResults] = useState(10);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<NewsResult | null>(null);
  const [history, setHistory] = useState<NewsResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<NewsResult[]>('/firecrawl-tools/news/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const searchNews = async () => {
    if (!topic.trim()) { addToast('Enter a topic', 'warning'); return; }
    setSearching(true);
    try {
      const data = await apiFetch<NewsResult>('/firecrawl-tools/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          sources: sources.split('\n').map(s => s.trim()).filter(Boolean),
          max_results: maxResults,
        }),
      });
      setResult(data);
      addToast(`Found ${data.articles.length} articles`, 'success');
      loadHistory();
    } catch {
      addToast('News search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const viewHistoryItem = (item: NewsResult) => {
    setResult(item);
    setTopic(item.topic);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="News Search" icon={Newspaper} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Inputs */}
      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchNews()}
            className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
            placeholder="Enter topic..."
          />
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-rmpg-400">Max:</label>
            <input
              type="number" min={1} max={50} value={maxResults} onChange={e => setMaxResults(Number(e.target.value))}
              className="w-12 bg-surface-sunken border border-rmpg-600 rounded-sm px-1.5 py-1.5 text-xs text-white text-center focus:border-orange-500/50 focus:outline-none"
            />
          </div>
          <SmallBtn onClick={searchNews} loading={searching} variant="primary">
            <Search className="w-3 h-3" /> Search News
          </SmallBtn>
        </div>
        <div>
          <label className="block text-[10px] text-rmpg-400 mb-0.5">Sources (optional, one per line)</label>
          <textarea
            value={sources} onChange={e => setSources(e.target.value)}
            rows={2}
            className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="https://news.ycombinator.com&#10;https://techcrunch.com"
          />
        </div>
      </div>

      {/* History */}
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
                <Newspaper className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 truncate flex-1">{item.topic}</span>
                <span className="text-[10px] text-orange-400 shrink-0">{item.articles.length} articles</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && result.articles.length > 0 && (
        <div className="space-y-1.5">
          {result.articles.map((article, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white flex-1">{article.title}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-blue-500/10 border border-blue-500/30 text-blue-400 shrink-0">
                  {article.source}
                </span>
              </div>
              <div className="text-[10px] text-rmpg-400 leading-relaxed">{article.summary}</div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-rmpg-500">{fmtDate(article.published_date)}</span>
                <a href={article.url} target="_blank" rel="noopener noreferrer"
                  className="text-[9px] text-brand-400 hover:underline font-mono">
                  <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />Open
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {!result && !searching && (
        <EmptyState icon={Newspaper} message="Enter a topic to search for recent news articles." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ DRAFTS PANEL (auto-draft)
// ══════════════════════════════════════════════════════════════

interface Draft {
  id: number;
  topic: string;
  draft_type: 'blog' | 'report' | 'summary' | 'brief';
  content: string;
  sources_used: string[];
  word_count: number;
  created_at: string;
}

function DraftsPanel() {
  const { addToast } = useToast();
  const [topic, setTopic] = useState('');
  const [draftType, setDraftType] = useState<Draft['draft_type']>('blog');
  const [sourceUrls, setSourceUrls] = useState('');
  const [wordTarget, setWordTarget] = useState(500);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const loadDrafts = useCallback(async () => {
    try {
      const data = await apiFetch<Draft[]>('/firecrawl-tools/drafts');
      setDrafts(data);
    } catch { /* silent */ } finally { setDraftsLoading(false); }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const generateDraft = async () => {
    if (!topic.trim()) { addToast('Enter a topic', 'warning'); return; }
    setGenerating(true);
    try {
      const data = await apiFetch<Draft>('/firecrawl-tools/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          draft_type: draftType,
          source_urls: sourceUrls.split('\n').map(u => u.trim()).filter(Boolean),
          word_count_target: wordTarget,
        }),
      });
      setResult(data);
      addToast('Draft generated', 'success');
      loadDrafts();
    } catch {
      addToast('Draft generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const deleteDraft = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/drafts/${id}`, { method: 'DELETE' });
      addToast('Draft deleted', 'success');
      if (result?.id === id) setResult(null);
      loadDrafts();
    } catch {
      addToast('Failed to delete draft', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const copyContent = () => {
    if (!result?.content) return;
    navigator.clipboard.writeText(result.content).then(() => addToast('Copied', 'success')).catch(() => addToast('Copy failed', 'error'));
  };

  const viewDraft = (draft: Draft) => {
    setResult(draft);
    setTopic(draft.topic);
    setDraftType(draft.draft_type);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Auto Draft" icon={PenTool} statusLed="bg-orange-400">
        <SmallBtn onClick={loadDrafts}><RefreshCw className="w-3 h-3" /> Refresh</SmallBtn>
      </PanelTitleBar>

      {/* Input Form */}
      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Topic *</label>
            <input
              value={topic} onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generateDraft()}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="e.g. AI trends in law enforcement"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Type</label>
            <select
              value={draftType} onChange={e => setDraftType(e.target.value as Draft['draft_type'])}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white focus:border-orange-500/50 focus:outline-none"
            >
              <option value="blog">Blog</option>
              <option value="report">Report</option>
              <option value="summary">Summary</option>
              <option value="brief">Brief</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-rmpg-400 mb-0.5">Source URLs (optional, one per line)</label>
          <textarea
            value={sourceUrls} onChange={e => setSourceUrls(e.target.value)}
            rows={2}
            className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="https://example.com/article"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-rmpg-400">Words:</label>
            <input
              type="number" min={100} max={5000} step={100} value={wordTarget} onChange={e => setWordTarget(Number(e.target.value))}
              className="w-16 bg-surface-sunken border border-rmpg-600 rounded-sm px-1.5 py-1 text-xs text-white text-center focus:border-orange-500/50 focus:outline-none"
            />
          </div>
          <SmallBtn onClick={generateDraft} loading={generating} variant="primary">
            <PenTool className="w-3 h-3" /> Generate Draft
          </SmallBtn>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400 uppercase">
              {result.draft_type}
            </span>
            <span className="text-[10px] text-rmpg-400 font-mono">{result.word_count} words</span>
            <div className="flex-1" />
            <SmallBtn onClick={copyContent} variant="primary">
              <Clipboard className="w-3 h-3" /> Copy
            </SmallBtn>
          </div>
          <textarea
            readOnly
            value={result.content}
            rows={12}
            className="w-full bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 leading-relaxed resize-y scrollbar-dark focus:outline-none"
          />
          {result.sources_used.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Sources Used</div>
              <div className="space-y-0.5">
                {result.sources_used.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] text-brand-400 hover:underline font-mono block truncate">
                    <ExternalLink className="w-2.5 h-2.5 inline mr-1" />{src}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved Drafts */}
      {drafts.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1.5">Saved Drafts</div>
          <div className="space-y-1">
            {drafts.map(d => (
              <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-rmpg-600 rounded-sm hover:bg-rmpg-700/30">
                <PenTool className="w-3 h-3 text-orange-400 shrink-0" />
                <button onClick={() => viewDraft(d)} className="text-[10px] text-rmpg-300 truncate flex-1 text-left hover:text-white">
                  {d.topic}
                </button>
                <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-rmpg-700 text-rmpg-400 uppercase">{d.draft_type}</span>
                <span className="text-[10px] text-rmpg-500">{d.word_count}w</span>
                <span className="text-[10px] text-rmpg-500">{fmtDate(d.created_at)}</span>
                <SmallBtn onClick={() => deleteDraft(d.id)} loading={deletingIds.has(d.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && drafts.length === 0 && !generating && !draftsLoading && (
        <EmptyState icon={PenTool} message="Enter a topic and type to auto-generate a draft from web sources." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ SLACK PANEL (ai-slack-bot)
// ══════════════════════════════════════════════════════════════

interface SlackConfig {
  id?: number;
  webhook_url: string;
  channel_name: string;
  notify_on: {
    scout_alert: boolean;
    brand_mention: boolean;
    observer_change: boolean;
    enrichment_complete: boolean;
  };
}

function SlackPanel() {
  const { addToast } = useToast();
  const [config, setConfig] = useState<SlackConfig>({
    webhook_url: '', channel_name: '',
    notify_on: { scout_alert: true, brand_mention: true, observer_change: true, enrichment_complete: false },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<SlackConfig>('/firecrawl-tools/integrations/slack');
      if (data && data.webhook_url) {
        setConfig(data);
        setConfigured(true);
      }
    } catch { /* not configured */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = async () => {
    if (!config.webhook_url.trim()) { addToast('Webhook URL required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/integrations/slack', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      addToast('Slack config saved', 'success');
      setConfigured(true);
    } catch {
      addToast('Failed to save config', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteConfig = async () => {
    try {
      await apiFetch('/firecrawl-tools/integrations/slack', { method: 'DELETE' });
      addToast('Slack config removed', 'success');
      setConfig({ webhook_url: '', channel_name: '', notify_on: { scout_alert: true, brand_mention: true, observer_change: true, enrichment_complete: false } });
      setConfigured(false);
    } catch {
      addToast('Failed to remove config', 'error');
    }
  };

  const testWebhook = async () => {
    setTesting(true);
    try {
      await apiFetch('/firecrawl-tools/integrations/slack/test', { method: 'POST' });
      addToast('Test message sent to Slack', 'success');
    } catch {
      addToast('Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Slack Integration" icon={MessageCircle} statusLed={configured ? 'bg-emerald-400' : 'bg-rmpg-500'}>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${configured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rmpg-700 border-rmpg-600 text-rmpg-400'}`}>
          {configured ? 'Configured' : 'Not Configured'}
        </span>
      </PanelTitleBar>

      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Webhook URL *</label>
            <input
              value={config.webhook_url}
              onChange={e => setConfig(prev => ({ ...prev, webhook_url: e.target.value }))}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Channel Name</label>
            <input
              value={config.channel_name}
              onChange={e => setConfig(prev => ({ ...prev, channel_name: e.target.value }))}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="#firecrawl-alerts"
            />
          </div>
        </div>

        <div>
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1.5">Notify On</div>
          <div className="flex flex-wrap gap-3">
            {(['scout_alert', 'brand_mention', 'observer_change', 'enrichment_complete'] as const).map(key => (
              <label key={key} className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.notify_on[key]}
                  onChange={e => setConfig(prev => ({ ...prev, notify_on: { ...prev.notify_on, [key]: e.target.checked } }))}
                  className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/50"
                />
                {key.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <SmallBtn onClick={saveConfig} loading={saving} variant="primary">
            <CheckCircle className="w-3 h-3" /> Save
          </SmallBtn>
          {configured && (
            <>
              <SmallBtn onClick={testWebhook} loading={testing}>
                <Send className="w-3 h-3" /> Send Test
              </SmallBtn>
              <SmallBtn onClick={deleteConfig} variant="danger">
                <Trash2 className="w-3 h-3" /> Delete
              </SmallBtn>
            </>
          )}
        </div>
      </div>

      {!configured && (
        <EmptyState icon={MessageCircle} message="Configure a Slack webhook to receive Firecrawl notifications." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ DISCORD PANEL (discord bots)
// ══════════════════════════════════════════════════════════════

interface DiscordConfig {
  id?: number;
  webhook_url: string;
  notify_on: {
    scout_alert: boolean;
    brand_mention: boolean;
    observer_change: boolean;
    enrichment_complete: boolean;
  };
}

function DiscordPanel() {
  const { addToast } = useToast();
  const [config, setConfig] = useState<DiscordConfig>({
    webhook_url: '',
    notify_on: { scout_alert: true, brand_mention: true, observer_change: true, enrichment_complete: false },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<DiscordConfig>('/firecrawl-tools/integrations/discord');
      if (data && data.webhook_url) {
        setConfig(data);
        setConfigured(true);
      }
    } catch { /* not configured */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = async () => {
    if (!config.webhook_url.trim()) { addToast('Webhook URL required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/integrations/discord', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      addToast('Discord config saved', 'success');
      setConfigured(true);
    } catch {
      addToast('Failed to save config', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteConfig = async () => {
    try {
      await apiFetch('/firecrawl-tools/integrations/discord', { method: 'DELETE' });
      addToast('Discord config removed', 'success');
      setConfig({ webhook_url: '', notify_on: { scout_alert: true, brand_mention: true, observer_change: true, enrichment_complete: false } });
      setConfigured(false);
    } catch {
      addToast('Failed to remove config', 'error');
    }
  };

  const testWebhook = async () => {
    setTesting(true);
    try {
      await apiFetch('/firecrawl-tools/integrations/discord/test', { method: 'POST' });
      addToast('Test message sent to Discord', 'success');
    } catch {
      addToast('Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Discord Integration" icon={Hash} statusLed={configured ? 'bg-emerald-400' : 'bg-rmpg-500'}>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${configured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rmpg-700 border-rmpg-600 text-rmpg-400'}`}>
          {configured ? 'Configured' : 'Not Configured'}
        </span>
      </PanelTitleBar>

      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div>
          <label className="block text-[10px] text-rmpg-400 mb-0.5">Webhook URL *</label>
          <input
            value={config.webhook_url}
            onChange={e => setConfig(prev => ({ ...prev, webhook_url: e.target.value }))}
            className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>

        <div>
          <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1.5">Notify On</div>
          <div className="flex flex-wrap gap-3">
            {(['scout_alert', 'brand_mention', 'observer_change', 'enrichment_complete'] as const).map(key => (
              <label key={key} className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.notify_on[key]}
                  onChange={e => setConfig(prev => ({ ...prev, notify_on: { ...prev.notify_on, [key]: e.target.checked } }))}
                  className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/50"
                />
                {key.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <SmallBtn onClick={saveConfig} loading={saving} variant="primary">
            <CheckCircle className="w-3 h-3" /> Save
          </SmallBtn>
          {configured && (
            <>
              <SmallBtn onClick={testWebhook} loading={testing}>
                <Send className="w-3 h-3" /> Send Test
              </SmallBtn>
              <SmallBtn onClick={deleteConfig} variant="danger">
                <Trash2 className="w-3 h-3" /> Delete
              </SmallBtn>
            </>
          )}
        </div>
      </div>

      {!configured && (
        <EmptyState icon={Hash} message="Configure a Discord webhook to receive Firecrawl notifications." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ AGENTS PANEL (OpenManus)
// ══════════════════════════════════════════════════════════════

interface AgentDef {
  id: number;
  name: string;
  goal: string;
  tools: string[];
  max_steps: number;
  initial_input: string;
  status: 'idle' | 'running' | 'error';
  created_at: string;
}

interface AgentStep {
  step: number;
  tool: string;
  input: string;
  output: string;
  status: 'success' | 'error';
}

interface AgentRun {
  id: number;
  agent_id: number;
  status: 'success' | 'error' | 'running';
  steps: AgentStep[];
  created_at: string;
}

function AgentsPanel() {
  const { addToast } = useToast();
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [formName, setFormName] = useState('');
  const [formGoal, setFormGoal] = useState('');
  const [formTools, setFormTools] = useState<Set<string>>(new Set(['scrape']));
  const [formMaxSteps, setFormMaxSteps] = useState(10);
  const [formInput, setFormInput] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<AgentDef[]>('/firecrawl-tools/agents');
      setAgents(data);
    } catch {
      addToast('Failed to load agents', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const loadRuns = useCallback(async (agentId: number) => {
    setRunsLoading(true);
    try {
      const data = await apiFetch<AgentRun[]>(`/firecrawl-tools/agents/${agentId}/runs`);
      setRuns(data);
    } catch { addToast('Failed to load runs', 'error'); }
    finally { setRunsLoading(false); }
  }, [addToast]);

  const toggleExpand = (id: number) => {
    if (expandedId === id) { setExpandedId(null); setRuns([]); }
    else { setExpandedId(id); loadRuns(id); }
  };

  const createAgent = async () => {
    if (!formName.trim() || !formGoal.trim()) { addToast('Name and goal required', 'warning'); return; }
    setSaving(true);
    try {
      await apiFetch('/firecrawl-tools/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          goal: formGoal.trim(),
          tools: Array.from(formTools),
          max_steps: formMaxSteps,
          initial_input: formInput.trim(),
        }),
      });
      addToast('Agent created', 'success');
      setShowForm(false);
      setFormName(''); setFormGoal(''); setFormTools(new Set(['scrape'])); setFormMaxSteps(10); setFormInput('');
      load();
    } catch {
      addToast('Failed to create agent', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runAgent = async (id: number) => {
    setRunningIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/agents/${id}/run`, { method: 'POST' });
      addToast('Agent run started', 'success');
      load();
      if (expandedId === id) loadRuns(id);
    } catch {
      addToast('Failed to run agent', 'error');
    } finally {
      setRunningIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const deleteAgent = async (id: number) => {
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      await apiFetch(`/firecrawl-tools/agents/${id}`, { method: 'DELETE' });
      addToast('Agent deleted', 'success');
      if (expandedId === id) { setExpandedId(null); setRuns([]); }
      load();
    } catch {
      addToast('Failed to delete agent', 'error');
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const toggleTool = (tool: string) => {
    setFormTools(prev => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool); else next.add(tool);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>;
  }

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Agents (OpenManus)" icon={Cpu} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowForm(!showForm)} variant="primary">
          <Plus className="w-3 h-3" /> New Agent
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
                placeholder="e.g. Market Research Agent"
              />
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-400 mb-0.5">Max Steps</label>
              <input
                type="number" min={1} max={50} value={formMaxSteps} onChange={e => setFormMaxSteps(Number(e.target.value))}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white text-center focus:border-orange-500/50 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Goal *</label>
            <textarea
              value={formGoal} onChange={e => setFormGoal(e.target.value)}
              rows={2}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="Describe what this agent should accomplish..."
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Initial URL/Query</label>
            <input
              value={formInput} onChange={e => setFormInput(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
              placeholder="https://example.com or search query"
            />
          </div>
          <div>
            <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Tools</div>
            <div className="flex gap-3">
              {['scrape', 'search', 'extract'].map(tool => (
                <label key={tool} className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formTools.has(tool)}
                    onChange={() => toggleTool(tool)}
                    className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/50"
                  />
                  {tool}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <SmallBtn onClick={createAgent} loading={saving} variant="primary">
              <CheckCircle className="w-3 h-3" /> Create
            </SmallBtn>
            <SmallBtn onClick={() => setShowForm(false)}>
              <X className="w-3 h-3" /> Cancel
            </SmallBtn>
          </div>
        </div>
      )}

      {/* Agents List */}
      {agents.length === 0 ? (
        <EmptyState icon={Cpu} message="No agents yet. Create one with a goal and tools to automate web tasks." />
      ) : (
        <div className="space-y-1">
          {agents.map(agent => (
            <div key={agent.id} className="bg-surface-raised border border-rmpg-600 rounded-sm">
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleExpand(agent.id)} className="text-rmpg-500 hover:text-white">
                  {expandedId === agent.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                <StatusLed status={agent.status} />
                <Cpu className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-xs font-medium text-white flex-1 truncate">{agent.name}</span>
                <div className="flex gap-1">
                  {agent.tools.map(t => (
                    <span key={t} className="text-[8px] px-1 py-0.5 rounded-sm bg-rmpg-700 text-rmpg-400 uppercase">{t}</span>
                  ))}
                </div>
                <SmallBtn onClick={() => runAgent(agent.id)} loading={runningIds.has(agent.id)} variant="primary" disabled={agent.status === 'running'}>
                  <Play className="w-3 h-3" /> Run
                </SmallBtn>
                <SmallBtn onClick={() => deleteAgent(agent.id)} loading={deletingIds.has(agent.id)} variant="danger">
                  <Trash2 className="w-3 h-3" />
                </SmallBtn>
              </div>

              {/* Run History */}
              {expandedId === agent.id && (
                <div className="border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2">
                  {runsLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
                  ) : runs.length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 text-center py-3">No runs yet</div>
                  ) : (
                    runs.map(run => (
                      <div key={run.id} className="bg-rmpg-800 border border-rmpg-700 rounded-sm p-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <StatusLed status={run.status} />
                          <span className="text-[10px] text-rmpg-400">{fmtDate(run.created_at)}</span>
                          <span className="text-[10px] text-orange-400">{run.steps.length} steps</span>
                        </div>
                        <div className="space-y-1">
                          {run.steps.map((step, si) => (
                            <div key={si} className="flex items-start gap-2 text-[10px]">
                              <span className="text-rmpg-500 font-mono shrink-0">#{step.step}</span>
                              <span className="text-orange-400 font-mono shrink-0 uppercase">{step.tool}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-rmpg-400 truncate">In: {step.input}</div>
                                <div className="text-rmpg-300 truncate">Out: {step.output}</div>
                              </div>
                              <StatusLed status={step.status} />
                            </div>
                          ))}
                        </div>
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
// ██ DOC EXTRACT PANEL (mineru-api)
// ══════════════════════════════════════════════════════════════

interface DocExtractResult {
  id: number;
  url: string;
  output_format: 'markdown' | 'json' | 'text';
  content_preview: string;
  tables_found: number;
  images_found: number;
  metadata: Record<string, string>;
  created_at: string;
}

function DocExtractPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [outputFormat, setOutputFormat] = useState<'markdown' | 'json' | 'text'>('markdown');
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<DocExtractResult | null>(null);
  const [history, setHistory] = useState<DocExtractResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<DocExtractResult[]>('/firecrawl-tools/doc-extract/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const extract = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setExtracting(true);
    try {
      const data = await apiFetch<DocExtractResult>('/firecrawl-tools/doc-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), output_format: outputFormat }),
      });
      setResult(data);
      addToast('Document extracted', 'success');
      loadHistory();
    } catch {
      addToast('Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const viewHistoryItem = (item: DocExtractResult) => {
    setResult(item);
    setUrl(item.url);
    setOutputFormat(item.output_format);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Document Extract" icon={FileDown} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && extract()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com/document.pdf"
        />
        <select
          value={outputFormat} onChange={e => setOutputFormat(e.target.value as 'markdown' | 'json' | 'text')}
          className="bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white focus:border-orange-500/50 focus:outline-none"
        >
          <option value="markdown">Markdown</option>
          <option value="json">JSON</option>
          <option value="text">Text</option>
        </select>
        <SmallBtn onClick={extract} loading={extracting} variant="primary">
          <FileDown className="w-3 h-3" /> Extract
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past extractions</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <FileDown className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[9px] text-orange-400 uppercase shrink-0">{item.output_format}</span>
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
            <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-orange-500/10 border border-orange-500/30 text-orange-400 uppercase">
              {result.output_format}
            </span>
            <span className="text-[10px] text-rmpg-400">{result.tables_found} tables</span>
            <span className="text-[10px] text-rmpg-400">{result.images_found} images</span>
          </div>
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-64 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {result.content_preview || 'No content'}
          </pre>
          {Object.keys(result.metadata).length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Metadata</div>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(result.metadata).map(([k, v]) => (
                  <div key={k} className="text-[10px]">
                    <span className="text-rmpg-500">{k}:</span> <span className="text-rmpg-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !extracting && (
        <EmptyState icon={FileDown} message="Enter a document URL to extract content, tables, and metadata." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ JOB MATCH PANEL (jobMatcher)
// ══════════════════════════════════════════════════════════════

interface JobMatch {
  title: string;
  company: string;
  location: string;
  salary: string;
  match_score: number;
  url: string;
}

interface JobMatchResult {
  id: number;
  search_url: string;
  total_found: number;
  jobs: JobMatch[];
  created_at: string;
}

function JobMatchPanel() {
  const { addToast } = useToast();
  const [searchUrl, setSearchUrl] = useState('');
  const [skills, setSkills] = useState('');
  const [location, setLocation] = useState('');
  const [minSalary, setMinSalary] = useState('');
  const [remote, setRemote] = useState(false);
  const [matching, setMatching] = useState(false);
  const [result, setResult] = useState<JobMatchResult | null>(null);
  const [history, setHistory] = useState<JobMatchResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<JobMatchResult[]>('/firecrawl-tools/job-match/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const match = async () => {
    if (!searchUrl.trim()) { addToast('Enter a search URL', 'warning'); return; }
    setMatching(true);
    try {
      const data = await apiFetch<JobMatchResult>('/firecrawl-tools/job-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search_url: searchUrl.trim(),
          skills: skills.split(',').map(s => s.trim()).filter(Boolean),
          location: location.trim(),
          min_salary: minSalary ? Number(minSalary) : undefined,
          remote,
        }),
      });
      setResult(data);
      addToast(`Found ${data.total_found} matches`, 'success');
      loadHistory();
    } catch {
      addToast('Job match failed', 'error');
    } finally {
      setMatching(false);
    }
  };

  const viewHistoryItem = (item: JobMatchResult) => {
    setResult(item);
    setSearchUrl(item.search_url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="Job Match" icon={Briefcase} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Input Form */}
      <div className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-2">
        <div>
          <label className="block text-[10px] text-rmpg-400 mb-0.5">Search URL *</label>
          <input
            value={searchUrl} onChange={e => setSearchUrl(e.target.value)}
            className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
            placeholder="https://jobs.example.com/search?q=..."
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Skills (comma-separated)</label>
            <input
              value={skills} onChange={e => setSkills(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="React, TypeScript, Node"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Location</label>
            <input
              value={location} onChange={e => setLocation(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="Salt Lake City, UT"
            />
          </div>
          <div>
            <label className="block text-[10px] text-rmpg-400 mb-0.5">Min Salary</label>
            <input
              type="number" value={minSalary} onChange={e => setMinSalary(e.target.value)}
              className="w-full bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none"
              placeholder="80000"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[10px] text-rmpg-300 cursor-pointer">
            <input
              type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)}
              className="rounded-sm border-rmpg-600 bg-surface-sunken text-orange-500 focus:ring-orange-500/50"
            />
            Remote only
          </label>
          <div className="flex-1" />
          <SmallBtn onClick={match} loading={matching} variant="primary">
            <Briefcase className="w-3 h-3" /> Match
          </SmallBtn>
        </div>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past matches</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Briefcase className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.search_url}</span>
                <span className="text-[10px] text-orange-400 shrink-0">{item.total_found} jobs</span>
                <span className="text-[10px] text-rmpg-500 shrink-0">{fmtDate(item.created_at)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-orange-400 font-medium">{result.total_found} jobs found</div>
          {result.jobs.map((job, i) => (
            <div key={i} className="bg-surface-raised border border-rmpg-600 rounded-sm p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white flex-1">{job.title}</span>
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-brand-400 hover:underline shrink-0">
                  <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />Apply
                </a>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-rmpg-300"><Building2 className="w-3 h-3 inline mr-0.5 text-rmpg-500" />{job.company}</span>
                <span className="text-rmpg-400">{job.location}</span>
                {job.salary && <span className="text-emerald-400 font-mono">{job.salary}</span>}
              </div>
              {/* Match score bar */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-rmpg-500">Match:</span>
                <div className="flex-1 h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${job.match_score >= 80 ? 'bg-emerald-400' : job.match_score >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${job.match_score}%` }}
                  />
                </div>
                <span className={`text-[9px] font-mono ${job.match_score >= 80 ? 'text-emerald-400' : job.match_score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                  {job.match_score}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!result && !matching && (
        <EmptyState icon={Briefcase} message="Enter a job search URL and criteria to find matching positions." />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ██ MHTML PANEL (mhtml2html)
// ══════════════════════════════════════════════════════════════

interface MhtmlResult {
  id: number;
  url: string;
  title: string;
  html_preview: string;
  assets_count: number;
  file_size: string;
  created_at: string;
}

function MhtmlPanel() {
  const { addToast } = useToast();
  const [url, setUrl] = useState('');
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<MhtmlResult | null>(null);
  const [history, setHistory] = useState<MhtmlResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiFetch<MhtmlResult[]>('/firecrawl-tools/mhtml-convert/history');
      setHistory(data);
    } catch { /* silent */ } finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const convert = async () => {
    if (!url.trim()) { addToast('Enter a URL', 'warning'); return; }
    setConverting(true);
    try {
      const data = await apiFetch<MhtmlResult>('/firecrawl-tools/mhtml-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(data);
      addToast('MHTML converted', 'success');
      loadHistory();
    } catch {
      addToast('Conversion failed', 'error');
    } finally {
      setConverting(false);
    }
  };

  const viewHistoryItem = (item: MhtmlResult) => {
    setResult(item);
    setUrl(item.url);
    setShowHistory(false);
  };

  return (
    <div className="space-y-3">
      <PanelTitleBar title="MHTML Converter" icon={Archive} statusLed="bg-orange-400">
        <SmallBtn onClick={() => setShowHistory(!showHistory)}>
          <Clock className="w-3 h-3" /> History ({history.length})
        </SmallBtn>
      </PanelTitleBar>

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && convert()}
          className="flex-1 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1.5 text-xs text-white placeholder-rmpg-600 focus:border-orange-500/50 focus:outline-none font-mono"
          placeholder="https://example.com"
        />
        <SmallBtn onClick={convert} loading={converting} variant="primary">
          <Archive className="w-3 h-3" /> Convert
        </SmallBtn>
      </div>

      {/* History */}
      {showHistory && (
        <div className="bg-surface-raised border border-rmpg-600 rounded-sm max-h-48 overflow-y-auto scrollbar-dark">
          {historyLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-rmpg-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 py-3 text-center">No past conversions</div>
          ) : (
            history.map(item => (
              <button
                key={item.id}
                onClick={() => viewHistoryItem(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-rmpg-700/50 border-b border-rmpg-700 last:border-0"
              >
                <Archive className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="text-[10px] text-rmpg-300 font-mono truncate flex-1">{item.url}</span>
                <span className="text-[10px] text-rmpg-400 shrink-0">{item.file_size}</span>
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
            <span className="text-xs font-medium text-white">{result.title}</span>
            <div className="flex-1" />
            <span className="text-[10px] text-rmpg-400">{result.assets_count} assets</span>
            <span className="text-[10px] text-orange-400 font-mono">{result.file_size}</span>
          </div>
          <pre className="bg-surface-sunken border border-rmpg-700 rounded-sm p-3 text-[10px] text-rmpg-300 font-mono max-h-64 overflow-auto scrollbar-dark whitespace-pre-wrap">
            {result.html_preview || 'No preview'}
          </pre>
        </div>
      )}

      {!result && !converting && (
        <EmptyState icon={Archive} message="Enter a URL to convert the page to MHTML format." />
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
        {activeTab === 'graphs' && <GraphsPanel />}
        {activeTab === 'connectors' && <ConnectorsPanel />}
        {activeTab === 'rag-eval' && <RagEvalPanel />}
        {activeTab === 'trends' && <TrendsPanel />}
        {activeTab === 'gen-ui' && <GenUiPanel />}
        {activeTab === 'qa-cluster' && <QaClusterPanel />}
        {activeTab === 'extract' && <ExtractPanel />}
        {activeTab === 'html-to-md' && <HtmlToMdPanel />}
        {activeTab === 'coupons' && <CouponsPanel />}
        {activeTab === 'brand-extend' && <BrandExtendPanel />}
        {activeTab === 'mcp' && <McpPanel />}
        {activeTab === 'examples' && <ExamplesPanel />}
        {activeTab === 'llmstxt-v2' && <LlmsTxtV2Panel />}
        {activeTab === 'mendable' && <MendablePanel />}
        {activeTab === 'news' && <NewsPanel />}
        {activeTab === 'drafts' && <DraftsPanel />}
        {activeTab === 'slack' && <SlackPanel />}
        {activeTab === 'discord' && <DiscordPanel />}
        {activeTab === 'agents' && <AgentsPanel />}
        {activeTab === 'doc-extract' && <DocExtractPanel />}
        {activeTab === 'job-match' && <JobMatchPanel />}
        {activeTab === 'mhtml' && <MhtmlPanel />}
      </div>
    </div>
  );
}
