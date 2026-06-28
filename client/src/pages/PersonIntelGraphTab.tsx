// client/src/pages/PersonIntelGraphTab.tsx
// Dynamic import of react-force-graph-2d to avoid SSR issues.
// Falls back to a plain connection list if the canvas fails to render.
import { useRef, useEffect, useCallback, useState } from 'react';
import { Network } from 'lucide-react';

interface Connection {
  id: number;
  from_subject: string;
  relationship: string;
  to_subject: string;
  confidence: number;
  sources: string;
}

interface Props {
  subjectName: string;
  connections: Connection[];
}

interface GraphNode { id: string; label: string; isSubject?: boolean }
interface GraphLink { source: string; target: string; label: string; value: number }

function buildGraph(subjectName: string, connections: Connection[]) {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  nodeMap.set(subjectName, { id: subjectName, label: subjectName, isSubject: true });

  for (const c of connections) {
    if (!nodeMap.has(c.from_subject)) nodeMap.set(c.from_subject, { id: c.from_subject, label: c.from_subject });
    if (!nodeMap.has(c.to_subject)) nodeMap.set(c.to_subject, { id: c.to_subject, label: c.to_subject });
    links.push({ source: c.from_subject, target: c.to_subject, label: c.relationship, value: Math.max(1, c.confidence * 3) });
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

export default function PersonIntelGraphTab({ subjectName, connections }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ForceGraph, setForceGraph] = useState<any>(null);
  const [loadError, setLoadError] = useState(false);
  const [dims, setDims] = useState({ w: 600, h: 400 });

  useEffect(() => {
    import('react-force-graph-2d').then(m => setForceGraph(() => m.default)).catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      const e = entries[0];
      if (e) setDims({ w: e.contentRect.width, h: Math.max(400, e.contentRect.width * 0.6) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
        <Network className="w-8 h-8 mb-2" />
        <p className="text-xs">No connections to display</p>
        <p className="text-[10px] mt-1">Connections appear once OSINT APIs or web crawl find associates</p>
      </div>
    );
  }

  const { nodes, links } = buildGraph(subjectName, connections);

  if (loadError || !ForceGraph) {
    // Fallback: plain text list
    return (
      <div className="space-y-1">
        {connections.map(c => (
          <div key={c.id} className="bg-surface-raised rounded px-3 py-2 text-xs">
            <span className="text-rmpg-100">{c.from_subject}</span>
            <span className="text-rmpg-500 mx-2">—{c.relationship}→</span>
            <span className="text-rmpg-100">{c.to_subject}</span>
            <span className="text-[10px] text-rmpg-500 ml-2">{(c.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rounded overflow-hidden bg-surface-base border border-rmpg-800">
      <ForceGraph
        graphData={{ nodes, links }}
        width={dims.w}
        height={dims.h}
        backgroundColor="#0d1722"
        nodeLabel="label"
        nodeColor={(n: GraphNode) => n.isSubject ? '#d4a017' : '#4a90d9'}
        nodeRelSize={6}
        linkLabel="label"
        linkColor={() => '#334155'}
        linkWidth={(l: GraphLink) => l.value}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D) => {
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'center';
          ctx.fillText(node.label?.slice(0, 20) ?? '', node.x ?? 0, (node.y ?? 0) + 12);
        }}
      />
    </div>
  );
}
