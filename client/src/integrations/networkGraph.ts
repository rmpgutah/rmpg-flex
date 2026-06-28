// ============================================================
// RMPG Flex — Network Graph (sigma.js + graphology)
// ============================================================
// Criminal network visualization for intelligence-led policing:
// - Person-to-person connections (co-offenders, associates)
// - Entity relationships (persons, vehicles, addresses, incidents)
// - Skip tracer relationship mapping
// - Gang affiliation networks
// ============================================================

import Graph from 'graphology';
import Sigma from 'sigma';

// Use 'any' type for graph to avoid strict typing issues with graphology's
// complex generic types. The runtime API is correct.
type AnyGraph = any;

// ── Types ─────────────────────────────────────────────────

export interface NetworkNode {
  id: string;
  label: string;
  type: 'person' | 'vehicle' | 'address' | 'incident' | 'phone' | 'organization';
  size?: number;
  color?: string;
  x?: number;
  y?: number;
  data?: Record<string, unknown>;
}

export interface NetworkEdge {
  source: string;
  target: string;
  label?: string;
  type?: 'associate' | 'co-offender' | 'family' | 'employer' | 'witness' | 'suspect' | 'victim' | 'owns' | 'resides' | 'linked';
  weight?: number;
  color?: string;
}

export interface NetworkConfig {
  container: HTMLElement;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  onNodeClick?: (nodeId: string, data: Record<string, unknown>) => void;
  onEdgeClick?: (edgeId: string) => void;
}

// ── Color scheme ──────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  person: '#d4a017',     // Gold
  vehicle: '#4a9eff',    // Blue
  address: '#22c55e',    // Green
  incident: '#ef4444',   // Red
  phone: '#a855f7',      // Purple
  organization: '#f97316', // Orange
};

const EDGE_COLORS: Record<string, string> = {
  associate: '#555',
  'co-offender': '#ef4444',
  family: '#22c55e',
  employer: '#4a9eff',
  witness: '#a855f7',
  suspect: '#ef4444',
  victim: '#f97316',
  owns: '#888',
  resides: '#22c55e',
  linked: '#444',
};

// ── Network graph factory ─────────────────────────────────

/**
 * Create an interactive network graph visualization.
 * Returns the sigma instance and helper functions.
 */
export function createNetworkGraph(config: NetworkConfig): {
  sigma: Sigma;
  graph: AnyGraph;
  destroy: () => void;
  addNode: (node: NetworkNode) => void;
  addEdge: (edge: NetworkEdge) => void;
  removeNode: (id: string) => void;
  highlightNeighbors: (nodeId: string) => void;
  resetHighlight: () => void;
  fitView: () => void;
} {
  const graph: AnyGraph = new Graph();

  // Add nodes with force-directed layout initial positions
  config.nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / config.nodes.length;
    const radius = Math.sqrt(config.nodes.length) * 2;
    graph.addNode(node.id, {
      label: node.label,
      x: node.x ?? Math.cos(angle) * radius,
      y: node.y ?? Math.sin(angle) * radius,
      size: node.size || getNodeSize(node.type),
      color: node.color || NODE_COLORS[node.type] || '#888',
      nodeType: node.type,
      ...node.data,
    });
  });

  // Add edges
  config.edges.forEach((edge, i) => {
    try {
      graph.addEdge(edge.source, edge.target, {
        label: edge.label || edge.type || '',
        color: edge.color || EDGE_COLORS[edge.type || 'linked'] || '#444',
        size: edge.weight || 1,
        edgeType: edge.type,
      });
    } catch {
      // Skip duplicate edges or missing nodes
    }
  });

  // Create sigma renderer with dark theme
  const sigma = new Sigma(graph, config.container, {
    renderEdgeLabels: true,
    defaultNodeColor: '#888',
    defaultEdgeColor: '#333',
    labelColor: { color: '#ccc' },
    labelSize: 12,
    labelRenderedSizeThreshold: 6,
    edgeLabelSize: 10,
  });

  // Event handlers
  if (config.onNodeClick) {
    sigma.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      config.onNodeClick?.(node, attrs);
    });
  }

  return {
    sigma,
    graph,
    destroy: () => sigma.kill(),
    addNode: (node: NetworkNode) => {
      if (!graph.hasNode(node.id)) {
        graph.addNode(node.id, {
          label: node.label,
          x: node.x ?? Math.random() * 10,
          y: node.y ?? Math.random() * 10,
          size: node.size || getNodeSize(node.type),
          color: node.color || NODE_COLORS[node.type] || '#888',
          nodeType: node.type,
        });
      }
    },
    addEdge: (edge: NetworkEdge) => {
      try {
        graph.addEdge(edge.source, edge.target, {
          label: edge.label || '',
          color: edge.color || EDGE_COLORS[edge.type || 'linked'] || '#444',
          size: edge.weight || 1,
        });
      } catch { /* skip duplicates */ }
    },
    removeNode: (id: string) => {
      if (graph.hasNode(id)) graph.dropNode(id);
    },
    highlightNeighbors: (nodeId: string) => {
      const neighbors = new Set(graph.neighbors(nodeId));
      neighbors.add(nodeId);
      graph.forEachNode((node: string) => {
        graph.setNodeAttribute(node, 'color',
          neighbors.has(node)
            ? (graph.getNodeAttribute(node, 'originalColor') || graph.getNodeAttribute(node, 'color'))
            : '#222'
        );
      });
      sigma.refresh();
    },
    resetHighlight: () => {
      graph.forEachNode((node: string) => {
        const type = graph.getNodeAttribute(node, 'nodeType');
        graph.setNodeAttribute(node, 'color', NODE_COLORS[type] || '#888');
      });
      sigma.refresh();
    },
    fitView: () => {
      // sigma auto-fits by default
      sigma.refresh();
    },
  };
}

function getNodeSize(type: string): number {
  switch (type) {
    case 'person': return 8;
    case 'incident': return 6;
    case 'vehicle': return 5;
    case 'address': return 5;
    case 'organization': return 7;
    case 'phone': return 4;
    default: return 5;
  }
}
