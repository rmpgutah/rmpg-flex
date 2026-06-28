// ============================================================
// RMPG Flex — CRDT Collaboration (Yjs)
// ============================================================
// Conflict-free Replicated Data Types for real-time collaborative
// editing and offline-first document sync. Enables multiple
// dispatchers to edit the same incident simultaneously.
// ============================================================

import * as Y from 'yjs';

// ── Types ─────────────────────────────────────────────────

export interface CollaborativeDoc {
  doc: Y.Doc;
  getText: (name: string) => Y.Text;
  getMap: (name: string) => Y.Map<unknown>;
  getArray: (name: string) => Y.Array<unknown>;
  destroy: () => void;
  onUpdate: (callback: (update: Uint8Array) => void) => void;
  applyUpdate: (update: Uint8Array) => void;
  getStateVector: () => Uint8Array;
  encodeState: () => Uint8Array;
}

// ── Document factory ──────────────────────────────────────

/**
 * Create a new collaborative document.
 * Can be synced between peers via WebSocket or any transport.
 */
export function createCollaborativeDoc(docId?: string): CollaborativeDoc {
  const doc = new Y.Doc();
  if (docId) {
    doc.clientID = hashString(docId) % 2147483647;
  }

  return {
    doc,
    getText: (name: string) => doc.getText(name),
    getMap: (name: string) => doc.getMap(name),
    getArray: (name: string) => doc.getArray(name),
    destroy: () => doc.destroy(),
    onUpdate: (callback) => {
      doc.on('update', (update: Uint8Array) => {
        callback(update);
      });
    },
    applyUpdate: (update: Uint8Array) => {
      Y.applyUpdate(doc, update);
    },
    getStateVector: () => Y.encodeStateVector(doc),
    encodeState: () => Y.encodeStateAsUpdate(doc),
  };
}

/**
 * Merge two document states (for offline sync).
 * Both documents are updated to contain all changes from both.
 */
export function mergeDocuments(doc1: Y.Doc, doc2: Y.Doc): void {
  const state1 = Y.encodeStateAsUpdate(doc1);
  const state2 = Y.encodeStateAsUpdate(doc2);
  Y.applyUpdate(doc1, state2);
  Y.applyUpdate(doc2, state1);
}

/**
 * Create a shared incident editing session.
 * Returns typed accessors for common incident fields.
 */
export function createIncidentSession(doc: Y.Doc) {
  const narrative = doc.getText('narrative');
  const metadata = doc.getMap('metadata');
  const officers = doc.getArray('officers');
  const evidence = doc.getArray('evidence');
  const timeline = doc.getArray('timeline');

  return {
    narrative,
    metadata,
    officers,
    evidence,
    timeline,

    /** Set a metadata field */
    setField: (key: string, value: unknown) => {
      metadata.set(key, value);
    },

    /** Get a metadata field */
    getField: (key: string) => {
      return metadata.get(key);
    },

    /** Append to narrative text */
    appendNarrative: (text: string) => {
      narrative.insert(narrative.length, text);
    },

    /** Add an officer to the incident */
    addOfficer: (officer: { id: number; name: string; role: string }) => {
      officers.push([officer]);
    },

    /** Add a timeline event */
    addTimelineEvent: (event: { time: string; description: string; actor: string }) => {
      timeline.push([event]);
    },

    /** Get full narrative text */
    getNarrative: () => narrative.toString(),

    /** Get all metadata as plain object */
    getMetadata: () => metadata.toJSON(),

    /** Get all officers */
    getOfficers: () => officers.toJSON(),

    /** Get full timeline */
    getTimeline: () => timeline.toJSON(),
  };
}

// ── Helpers ───────────────────────────────────────────────

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
