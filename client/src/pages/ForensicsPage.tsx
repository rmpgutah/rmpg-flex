// ============================================================
// RMPG Flex — Connection Analysis Page
// ============================================================
// Interactive spider-web graph visualization of relationships
// between persons, vehicles, properties, cases, incidents,
// and evidence. Uses react-force-graph-2d for Canvas rendering.
// ============================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  Search, Loader2, Network, X, User, Car, Building2, Briefcase, FileText,
  Package, ChevronDown, ChevronRight, RotateCcw, Maximize2, Minus, Plus, Eye,
  EyeOff,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import SplitPanel from '../components/SplitPanel';
import type { GraphNode, GraphEdge, ConnectionGraph } from '../types';
import { useToast } from '../components/ToastProvider';

// ── Constants ────────────────────────────────────────────────

const NODE_PALETTE: Record<string, { primary: string; glow: string; dark: string }> = {
  person:   { primary: '#999999', glow: '#888888', dark: '#222222' },
  vehicle:  { primary: '#ffb74d', glow: '#ff9800', dark: '#6e4a1a' },
  property: { primary: '#4dd0a0', glow: '#00c853', dark: '#1a6e4a' },
  case:     { primary: '#ff6b6b', glow: '#ff1744', dark: '#6e1a1a' },
  incident: { primary: '#ce93d8', glow: '#aa00ff', dark: '#323232' },
  evidence: { primary: '#999999', glow: '#666666', dark: '#2a2a2a' },
};

// Backward-compatible flat color map (used in sidebar UI, filters, search dropdown)
const NODE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(NODE_PALETTE).map(([k, v]) => [k, v.primary])
);

// ── Relationship Edge Colors & Weights ──────────────────────

const RELATIONSHIP_COLORS: Record<string, string> = {
  suspect: '#ff5252', suspect_vehicle: '#ff5252',
  owner: '#aaaaaa',
  victim: '#ffab40', victim_vehicle: '#ffab40',
  witness: '#80cbc4', witness_vehicle: '#80cbc4',
  reporting_party: '#b39ddb',
  location: '#4dd0a0',
  collected_from: '#999999',
  linked: '#666666', associated: '#555555',
  involved: '#444444', evidence: '#666666', other: '#444444',
};

const RELATIONSHIP_WEIGHT: Record<string, number> = {
  suspect: 3, suspect_vehicle: 3,
  owner: 2.5,
  victim: 2.5, victim_vehicle: 2.5,
  witness: 1.8, witness_vehicle: 1.8,
  reporting_party: 1.8,
  location: 1.5, collected_from: 1.5,
  linked: 1, associated: 1, involved: 0.8, evidence: 1.2, other: 0.8,
};

const NODE_ICONS: Record<string, React.ElementType> = {
  person: User,
  vehicle: Car,
  property: Building2,
  case: Briefcase,
  incident: FileText,
  evidence: Package,
};

const TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  vehicle: 'Vehicle',
  property: 'Property',
  case: 'Case',
  incident: 'Incident',
  evidence: 'Evidence',
};

const ALL_TYPES = ['person', 'vehicle', 'property', 'case', 'incident', 'evidence'];

// ── Search Result Type ───────────────────────────────────────

interface SearchResult {
  id: number;
  type: string;
  label: string;
}

// ── SeedSelector Component ───────────────────────────────────

function SeedSelector({ onSelect, loading }: {
  onSelect: (type: string, id: number, label: string) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setShowDropdown(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch<SearchResult[]>(`/connections/search?q=${encodeURIComponent(query.trim())}`);
        setResults(data || []);
        setShowDropdown(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-1.5 bg-surface-sunken border border-rmpg-600 rounded-sm px-2 py-1 focus-within:border-brand-500">
        {searching || loading ? (
          <Loader2 className="w-3.5 h-3.5 text-brand-400 animate-spin shrink-0" role="status" aria-label="Loading" />
        ) : (
          <Search className="w-3.5 h-3.5 text-rmpg-500 shrink-0" />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder="Search person, vehicle, property, case..." aria-label="Search person, vehicle, property, case..."
          className="flex-1 bg-transparent text-rmpg-200 text-[11px] focus:outline-none placeholder:text-rmpg-600 min-w-0"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); setResults([]); setShowDropdown(false); }}
            className="text-rmpg-500 hover:text-rmpg-300">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-base border border-rmpg-600 rounded-sm shadow-xl z-50 max-h-72 overflow-y-auto">
          {results.map((r, idx) => {
            const Icon = NODE_ICONS[r.type] || Package;
            return (
              <button type="button"
                key={`${r.type}-${r.id}-${idx}`}
                onClick={() => {
                  onSelect(r.type, r.id, r.label);
                  setQuery('');
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-rmpg-800/40 text-left transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: NODE_COLORS[r.type] }} />
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: NODE_COLORS[r.type] }} />
                <span className="text-[10px] font-medium text-rmpg-300 truncate flex-1">{r.label}</span>
                <span className="text-[9px] text-rmpg-500 uppercase shrink-0">{r.type}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Node Flag Parser ─────────────────────────────────────────

function parseNodeFlags(node: any): { hasWarrant: boolean; hasBolo: boolean; hasCaution: boolean } {
  let flags: string[] = [];
  if (node.metadata?.flags) {
    if (typeof node.metadata.flags === 'string') {
      try { flags = JSON.parse(node.metadata.flags); } catch { /* */ }
    } else if (Array.isArray(node.metadata.flags)) {
      flags = node.metadata.flags;
    }
  }
  const flagsLower = flags.map((f: string) => String(f).toLowerCase());
  return {
    hasWarrant: flagsLower.some(f => f.includes('warrant')),
    hasBolo: flagsLower.some(f => f.includes('bolo')),
    hasCaution: !!(node.metadata?.caution_flags),
  };
}

// ── GraphLegend Component ────────────────────────────────────

function GraphLegend({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="absolute bottom-2 left-2 z-10 bg-[#050505]/92 backdrop-blur-sm border border-rmpg-700 rounded-sm p-2.5 max-w-[210px] select-none">
      <div className="text-[8px] text-rmpg-400 uppercase tracking-wider mb-1.5 font-semibold">Entity Types</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
        {ALL_TYPES.map(t => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: NODE_PALETTE[t]?.primary }} />
            <span className="text-[8px] text-rmpg-300">{TYPE_LABELS[t]}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-rmpg-700 pt-1.5 mt-1">
        <div className="text-[8px] text-rmpg-400 uppercase tracking-wider mb-1.5 font-semibold">Edge Relationships</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {([
            ['suspect', 'Suspect'], ['owner', 'Owner'], ['victim', 'Victim'],
            ['witness', 'Witness'], ['location', 'Location'], ['linked', 'Linked'],
          ] as const).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-4 h-[2px] shrink-0 rounded-full" style={{ background: RELATIONSHIP_COLORS[key] }} />
              <span className="text-[8px] text-rmpg-300">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-rmpg-700 pt-1.5 mt-1">
        <div className="text-[8px] text-rmpg-400 uppercase tracking-wider mb-1.5 font-semibold">Flags</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <span className="text-[8px] text-rmpg-300">Warrant</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span className="text-[8px] text-rmpg-300">BOLO</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
            <span className="text-[8px] text-rmpg-300">Caution</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GraphPanel Component ─────────────────────────────────────

function GraphPanel({ graph, selectedNodeId, onSelectNode, depth, onDepthChange, typeFilter, onToggleTypeFilter, loading }: {
  graph: ConnectionGraph | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  depth: number;
  onDepthChange: (d: number) => void;
  typeFilter: Set<string>;
  onToggleTypeFilter: (type: string) => void;
  loading: boolean;
}) {
  const graphRef = useRef<any>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Filter graph by visible types
  const filteredGraph = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const visibleNodes = graph.nodes.filter(n => typeFilter.has(n.type));
    const visibleIds = new Set(visibleNodes.map(n => n.id));
    const visibleLinks = graph.edges
      .filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map(e => ({ ...e }));
    return { nodes: visibleNodes, links: visibleLinks };
  }, [graph, typeFilter]);

  // Connection count per node (for dynamic sizing)
  const connectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const link of filteredGraph.links) {
      const src = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const tgt = typeof link.target === 'object' ? (link.target as any).id : link.target;
      counts[src] = (counts[src] || 0) + 1;
      counts[tgt] = (counts[tgt] || 0) + 1;
    }
    return counts;
  }, [filteredGraph]);

  // Legend visibility
  const [showLegend, setShowLegend] = useState(true);

  // Custom node painting — multi-layer with gradients, halos, and flag indicators
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    // Guard: node may not have coordinates yet during initial force simulation
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;

    const isSelected = node.id === selectedNodeId;
    const isSeed = node.depth === 0;
    const palette = NODE_PALETTE[node.type] || NODE_PALETTE.evidence;
    const conns = connectionCounts[node.id] || 0;
    const baseSize = isSeed ? 9 : isSelected ? 7 : 5;
    const size = baseSize + Math.min(conns * 0.5, 6);

    // Depth-based opacity
    const depthAlpha = Math.max(0.35, 1 - node.depth * 0.2);
    ctx.save();
    ctx.globalAlpha = depthAlpha;

    // Layer 1: Outer glow halo
    const glowRadius = isSeed ? size * 3.5 : size * 2.5;
    const glowOpacity = isSeed ? 0.25 : 0.12;
    const glow = ctx.createRadialGradient(node.x, node.y, size * 0.3, node.x, node.y, glowRadius);
    glow.addColorStop(0, palette.glow + Math.round(glowOpacity * 255).toString(16).padStart(2, '0'));
    glow.addColorStop(0.6, palette.glow + '0a');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
    ctx.fillStyle = glow;
    ctx.fill();

    // Layer 2: Main gradient fill (3D sphere effect)
    const fill = ctx.createRadialGradient(
      node.x - size * 0.25, node.y - size * 0.25, size * 0.1,
      node.x, node.y, size
    );
    fill.addColorStop(0, palette.primary);
    fill.addColorStop(0.7, palette.primary);
    fill.addColorStop(1, palette.dark);
    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();

    // Layer 3: Inner highlight ring
    ctx.beginPath();
    ctx.arc(node.x, node.y, size * 0.65, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.8 / globalScale;
    ctx.stroke();

    // Layer 4: Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, size + 1.5, 0, 2 * Math.PI);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }

    // Layer 4b: Seed outer ring
    if (isSeed && !isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, size + 1, 0, 2 * Math.PI);
      ctx.strokeStyle = palette.primary + 'aa';
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();
    }

    // Layer 5: Flag indicators (small colored pips)
    const { hasWarrant, hasBolo, hasCaution } = parseNodeFlags(node);
    const pipDist = size + 3;
    const pipSize = Math.max(2, 3 / globalScale);

    if (hasWarrant) {
      // Red pip at 1 o'clock
      const angle = -Math.PI / 6;
      ctx.beginPath();
      ctx.arc(node.x + Math.cos(angle) * pipDist, node.y + Math.sin(angle) * pipDist, pipSize, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff5252';
      ctx.fill();
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 0.5 / globalScale;
      ctx.stroke();
    }

    if (hasBolo) {
      // Amber pip at 11 o'clock
      const angle = -5 * Math.PI / 6;
      ctx.beginPath();
      ctx.arc(node.x + Math.cos(angle) * pipDist, node.y + Math.sin(angle) * pipDist, pipSize, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffab40';
      ctx.fill();
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 0.5 / globalScale;
      ctx.stroke();
    }

    if (hasCaution) {
      // Yellow pip at 12 o'clock
      ctx.beginPath();
      ctx.arc(node.x, node.y - pipDist, pipSize, 0, 2 * Math.PI);
      ctx.fillStyle = '#fdd835';
      ctx.fill();
      ctx.strokeStyle = '#f9a825';
      ctx.lineWidth = 0.5 / globalScale;
      ctx.stroke();
    }

    ctx.restore();

    // Label with text shadow for readability
    if (globalScale > 0.6) {
      const fontSize = Math.max(10 / globalScale, 3);
      const labelAlpha = node.depth === 0 ? 1 : Math.max(0.45, 1 - node.depth * 0.18);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = `rgba(220, 225, 230, ${labelAlpha})`;
      ctx.fillText(node.label, node.x, node.y + size + 3);
      // Clear shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  }, [selectedNodeId, connectionCounts]);

  // Link label — styled pill badges at higher zoom, colored dots at medium zoom
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const start = link.source;
    const end = link.target;
    if (!start?.x || !end?.x) return;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const relColor = RELATIONSHIP_COLORS[link.relationship] || '#444444';

    if (globalScale >= 1.0 && link.relationship) {
      // Pill badge at high zoom
      const fontSize = Math.max(7 / globalScale, 2);
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      const text = link.relationship.replace(/_/g, ' ');
      const textWidth = ctx.measureText(text).width;
      const padX = 3 / globalScale;
      const padY = 1.5 / globalScale;
      const pillW = textWidth + padX * 2;
      const pillH = fontSize + padY * 2;
      const cornerR = 2 / globalScale;

      // Pill background
      ctx.beginPath();
      ctx.roundRect(midX - pillW / 2, midY - pillH / 2, pillW, pillH, cornerR);
      ctx.fillStyle = relColor + 'cc';
      ctx.fill();
      ctx.strokeStyle = relColor + '66';
      ctx.lineWidth = 0.5 / globalScale;
      ctx.stroke();

      // Pill text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, midX, midY);
    } else if (globalScale >= 0.6) {
      // Colored dot at medium zoom
      ctx.beginPath();
      ctx.arc(midX, midY, 1.5 / globalScale, 0, 2 * Math.PI);
      ctx.fillStyle = relColor + '80';
      ctx.fill();
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 px-3 py-1.5 border-b border-rmpg-700 flex items-center gap-3 flex-wrap bg-surface-base">
        {/* Depth control */}
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-rmpg-500 uppercase tracking-wider">Depth</span>
          <button type="button" onClick={() => onDepthChange(Math.max(1, depth - 1))} disabled={depth <= 1}
            className="toolbar-btn p-0.5 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
          <span className="text-[10px] text-rmpg-200 font-bold w-3 text-center">{depth}</span>
          <button type="button" onClick={() => onDepthChange(Math.min(3, depth + 1))} disabled={depth >= 3}
            className="toolbar-btn p-0.5 disabled:opacity-30"><Plus className="w-3 h-3" /></button>
        </div>

        <div className="w-px h-4 bg-rmpg-700" />

        {/* Type filters */}
        <div className="flex items-center gap-1">
          {ALL_TYPES.map(t => {
            const active = typeFilter.has(t);
            return (
              <button type="button" key={t} onClick={() => onToggleTypeFilter(t)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[9px] transition-colors border ${
                  active ? 'border-rmpg-500 bg-rmpg-800/40' : 'border-transparent opacity-40 hover:opacity-70'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: NODE_COLORS[t] }} />
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Graph controls */}
        <button type="button" onClick={() => setShowLegend(v => !v)}
          className={`toolbar-btn p-1 ${showLegend ? 'text-brand-400' : 'text-rmpg-500'}`}
          title={showLegend ? 'Hide legend' : 'Show legend'}>
          {showLegend ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <button type="button" onClick={() => graphRef.current?.zoomToFit(400, 40)}
          className="toolbar-btn p-1" title="Fit to view">
          <Maximize2 className="w-3 h-3" />
        </button>

        {loading && <Loader2 className="w-3.5 h-3.5 text-brand-400 animate-spin" role="status" aria-label="Loading" />}
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="flex-1 relative" style={{ background: '#050505' }}>
        <GraphLegend visible={showLegend && filteredGraph.nodes.length > 0} />
        {filteredGraph.nodes.length > 0 ? (
          <ForceGraph2D
            ref={graphRef}
            graphData={filteredGraph}
            width={dimensions.width}
            height={dimensions.height}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
              const conns = connectionCounts[node.id] || 0;
              const hitSize = (node.depth === 0 ? 9 : node.id === selectedNodeId ? 7 : 5) + Math.min(conns * 0.5, 6) + 4;
              ctx.beginPath();
              ctx.arc(node.x, node.y, hitSize, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkCanvasObjectMode={() => 'after'}
            linkCanvasObject={paintLink}
            onNodeClick={(node: any) => onSelectNode(node.id)}
            onBackgroundClick={() => onSelectNode(null)}
            // Enhanced link styling — colored by relationship type
            linkColor={(link: any) => RELATIONSHIP_COLORS[link.relationship] || '#444444'}
            linkWidth={(link: any) => RELATIONSHIP_WEIGHT[link.relationship] || 1}
            linkCurvature={0.15}
            // Animated directional particles
            linkDirectionalParticles={2}
            linkDirectionalParticleSpeed={0.004}
            linkDirectionalParticleWidth={(link: any) =>
              Math.max(1.5, (RELATIONSHIP_WEIGHT[link.relationship] || 1) * 0.8)
            }
            linkDirectionalParticleColor={(link: any) => {
              const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
              const targetNode = filteredGraph.nodes.find((n: any) => n.id === targetId);
              return targetNode ? (NODE_PALETTE[targetNode.type]?.glow || '#666666') : '#666666';
            }}
            // Seed glow background
            onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
              const seedNode = filteredGraph.nodes.find((n: any) => n.depth === 0);
              if (!seedNode || !(seedNode as any).x) return;
              const sx = (seedNode as any).x;
              const sy = (seedNode as any).y;
              const r = 250 / globalScale;
              const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
              grad.addColorStop(0, 'rgba(136, 136, 136, 0.07)');
              grad.addColorStop(0.5, 'rgba(136, 136, 136, 0.025)');
              grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
              ctx.fillStyle = grad;
              ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
            }}
            backgroundColor="#050505"
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            warmupTicks={50}
            cooldownTicks={100}
          />
        ) : (
          !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <Network className="w-12 h-12 mx-auto mb-3 text-rmpg-700" />
                <div className="text-[11px] text-rmpg-500">No connections to display</div>
              </div>
            </div>
          )
        )}
      </div>

      {/* Stats bar — enhanced with per-type breakdown */}
      {graph && (
        <div className="shrink-0 px-3 py-1 border-t border-rmpg-700 bg-surface-base flex items-center gap-3 flex-wrap">
          <span className="text-[9px] text-rmpg-500">{graph.nodes.length} nodes</span>
          <span className="text-[9px] text-rmpg-500">{graph.edges.length} connections</span>
          <div className="w-px h-3 bg-rmpg-700" />
          {ALL_TYPES.map(t => {
            const count = graph.nodes.filter(n => n.type === t).length;
            if (count === 0) return null;
            return (
              <div key={t} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: NODE_PALETTE[t]?.primary }} />
                <span className="text-[9px] text-rmpg-400">{count}</span>
              </div>
            );
          })}
          {graph.nodes.length >= 200 && (
            <span className="text-[9px] text-amber-500 ml-auto">⚠ Node limit reached (200)</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── DetailPanel Component ────────────────────────────────────

function DetailPanel({ node, edges, allNodes, onExpandNode }: {
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  onExpandNode: (type: string, id: number, label: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-4">
          <Network className="w-10 h-10 mx-auto mb-3 text-rmpg-700" />
          <div className="text-[11px] text-rmpg-500">Select a node to view details</div>
          <div className="text-[9px] text-rmpg-600 mt-1">Click any node in the graph</div>
        </div>
      </div>
    );
  }

  const Icon = NODE_ICONS[node.type] || Package;
  const color = NODE_COLORS[node.type] || '#666666';

  // Group edges by connected node type
  const grouped: Record<string, Array<{ edge: GraphEdge; otherNode: GraphNode }>> = {};
  for (const edge of edges) {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    const otherNode = allNodes.find(n => n.id === otherId);
    if (!otherNode) continue;
    if (!grouped[otherNode.type]) grouped[otherNode.type] = [];
    grouped[otherNode.type].push({ edge, otherNode });
  }

  // Metadata display helper
  const meta = node.metadata || {};
  const metaFields: Array<{ label: string; value: string }> = [];
  switch (node.type) {
    case 'person':
      if (meta.dob) metaFields.push({ label: 'DOB', value: meta.dob });
      if (meta.address) metaFields.push({ label: 'Address', value: `${meta.address}${meta.city ? `, ${meta.city}` : ''}${meta.state ? ` ${meta.state}` : ''}` });
      if (meta.phone) metaFields.push({ label: 'Phone', value: meta.phone });
      break;
    case 'vehicle':
      if (meta.plate_number) metaFields.push({ label: 'Plate', value: `${meta.plate_number}${meta.state ? ` (${meta.state})` : ''}` });
      if (meta.vin) metaFields.push({ label: 'VIN', value: meta.vin });
      if (meta.year) metaFields.push({ label: 'Year', value: String(meta.year) });
      break;
    case 'property':
      if (meta.address) metaFields.push({ label: 'Address', value: meta.address });
      if (meta.property_type) metaFields.push({ label: 'Type', value: meta.property_type });
      break;
    case 'case':
      if (meta.case_number) metaFields.push({ label: 'Case #', value: meta.case_number });
      if (meta.status) metaFields.push({ label: 'Status', value: meta.status });
      if (meta.priority) metaFields.push({ label: 'Priority', value: meta.priority });
      if (meta.case_type) metaFields.push({ label: 'Type', value: meta.case_type });
      break;
    case 'incident':
      if (meta.incident_number) metaFields.push({ label: 'Inc #', value: meta.incident_number });
      if (meta.status) metaFields.push({ label: 'Status', value: meta.status });
      if (meta.priority) metaFields.push({ label: 'Priority', value: meta.priority });
      if (meta.location_address) metaFields.push({ label: 'Location', value: meta.location_address });
      break;
    case 'evidence':
      if (meta.evidence_number) metaFields.push({ label: 'Ev #', value: meta.evidence_number });
      if (meta.evidence_type) metaFields.push({ label: 'Type', value: meta.evidence_type });
      if (meta.status) metaFields.push({ label: 'Status', value: meta.status });
      break;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Entity header card */}
      <div className="shrink-0 p-3 border-b border-rmpg-700 bg-surface-base">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-1.5 rounded-sm" style={{ background: color + '20', border: `1px solid ${color}40` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-rmpg-100 truncate">{node.label}</div>
            <div className="text-[9px] uppercase tracking-wider" style={{ color }}>{TYPE_LABELS[node.type]}</div>
          </div>
          <button type="button"
            onClick={() => onExpandNode(node.type, node.entityId, node.label)}
            className="toolbar-btn text-[9px] px-2 py-1 flex items-center gap-1"
            title="Re-center graph on this entity"
          >
            <RotateCcw className="w-3 h-3" />
            Center
          </button>
        </div>

        {/* Metadata fields */}
        {metaFields.length > 0 && (
          <div className="space-y-0.5 mt-2">
            {metaFields.map((f, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[9px]">
                <span className="text-rmpg-500 uppercase tracking-wider w-16 shrink-0">{f.label}</span>
                <span className="text-rmpg-300 font-mono truncate">{f.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connections list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="text-[9px] text-rmpg-500 uppercase tracking-wider px-1 mb-1">
          Connections ({edges.length})
        </div>

        {Object.entries(grouped).map(([type, items]) => {
          const GroupIcon = NODE_ICONS[type] || Package;
          const groupColor = NODE_COLORS[type] || '#666666';
          const isCollapsed = collapsed[type];

          return (
            <div key={type} className="panel-beveled bg-surface-sunken overflow-hidden">
              <button type="button"
                onClick={() => setCollapsed(prev => ({ ...prev, [type]: !prev[type] }))}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-rmpg-800/20 transition-colors"
              >
                {isCollapsed ? <ChevronRight className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: groupColor }} />
                <span className="text-[10px] font-medium text-rmpg-300 uppercase tracking-wider">{TYPE_LABELS[type]}s</span>
                <span className="text-[9px] text-rmpg-500 ml-auto">{items.length}</span>
              </button>

              {!isCollapsed && (
                <div className="border-t border-rmpg-700">
                  {items.map(({ edge, otherNode }, idx) => (
                    <button type="button"
                      key={idx}
                      onClick={() => onExpandNode(otherNode.type, otherNode.entityId, otherNode.label)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-rmpg-800/30 text-left transition-colors"
                    >
                      <GroupIcon className="w-3 h-3 shrink-0" style={{ color: groupColor }} />
                      <span className="text-[10px] text-rmpg-200 truncate flex-1">{otherNode.label}</span>
                      <span className="text-[8px] bg-rmpg-800 border border-rmpg-600 text-rmpg-400 px-1.5 py-0.5 rounded-sm uppercase shrink-0">
                        {edge.relationship}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {edges.length === 0 && (
          <div className="text-center py-4 text-[10px] text-rmpg-600">
            No connections found
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────

export default function ForensicsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  // Graph data
  const [graph, setGraph] = useState<ConnectionGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed entity
  const [seedType, setSeedType] = useState<string | null>(null);
  const [seedId, setSeedId] = useState<number | null>(null);
  const [seedLabel, setSeedLabel] = useState('');

  // Controls
  const [depth, setDepth] = useState(2);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set(ALL_TYPES));

  // Selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch graph
  const fetchGraph = useCallback(async (type: string, id: number, d: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ConnectionGraph>(
        `/connections/graph?type=${type}&id=${id}&depth=${d}`
      );
      setGraph(data);
      setSelectedNodeId(`${type}-${id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to load connections');
      addToast('Failed to load connection graph', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle seed selection
  const handleSeedSelect = useCallback((type: string, id: number, label: string) => {
    setSeedType(type);
    setSeedId(id);
    setSeedLabel(label);
    fetchGraph(type, id, depth);
  }, [depth, fetchGraph]);

  // Re-fetch on depth change
  useEffect(() => {
    if (seedType && seedId) {
      fetchGraph(seedType, seedId, depth);
    }
  }, [depth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle type filter
  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Derived state
  const selectedNode = graph?.nodes.find(n => n.id === selectedNodeId) || null;
  const selectedEdges = graph?.edges.filter(
    e => e.source === selectedNodeId || e.target === selectedNodeId
  ) || [];

  // Set document title
  useEffect(() => { document.title = 'Connection Analysis \u2014 RMPG Flex'; }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-rmpg-950">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-rmpg-800 bg-surface-base">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-sm bg-brand-600/20 border border-brand-600/30">
            <Network className="w-4 h-4 text-brand-400" />
          </div>
          <div className="shrink-0">
            <h1 className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider">Connection Analysis</h1>
            <p className="text-[9px] text-rmpg-500">Entity relationship spider web</p>
          </div>
          <div className="flex-1 max-w-md">
            <SeedSelector onSelect={handleSeedSelect} loading={loading} />
          </div>
          {seedLabel && (
            <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-rmpg-500 shrink-0">
              <span>Seed:</span>
              <span className="font-mono text-rmpg-300">{seedLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 px-4 py-1.5 bg-red-950/30 border-b border-red-800/40 flex items-center justify-between">
          <span className="text-[10px] text-red-400">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-[10px]">dismiss</button>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────── */}
      {!graph && !loading ? (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
          <div className="text-center px-6">
            <Network className="w-16 h-16 mx-auto mb-4 text-rmpg-800" />
            <h2 className="text-[13px] font-bold text-rmpg-400 mb-1">Connection Analysis</h2>
            <p className="text-[10px] text-rmpg-600 max-w-xs mx-auto leading-relaxed">
              Search for a person, vehicle, property, or case to visualize
              their connections across all records, incidents, and cases.
            </p>
            <div className="flex items-center justify-center gap-3 mt-5">
              {ALL_TYPES.map(t => (
                <div key={t} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: NODE_PALETTE[t]?.primary }} />
                  <span className="text-[9px] text-rmpg-600">{TYPE_LABELS[t]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <SplitPanel
          left={
            <GraphPanel
              graph={graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              depth={depth}
              onDepthChange={setDepth}
              typeFilter={typeFilter}
              onToggleTypeFilter={toggleTypeFilter}
              loading={loading}
            />
          }
          right={
            <DetailPanel
              node={selectedNode}
              edges={selectedEdges}
              allNodes={graph?.nodes || []}
              onExpandNode={handleSeedSelect}
            />
          }
          initialRatio={0.6}
          minLeftPx={350}
          minRightPx={250}
          persistKey="connections"
          leftLabel="Graph"
          rightLabel="Details"
        />
      )}
    </div>
  );
}
