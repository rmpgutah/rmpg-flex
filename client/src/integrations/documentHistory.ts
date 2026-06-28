// ============================================================
// RMPG Flex — Persistent Document History (Automerge)
// ============================================================
// CRDT library with Rust/WASM core for persistent document
// versioning. Each incident, case, or arrest record becomes
// an Automerge document with full version history — automatic
// audit trails showing every change, by whom, and when.
// ============================================================

import Automerge from 'automerge';

// ── Types ─────────────────────────────────────────────────

export interface VersionedDocument<T extends Record<string, unknown>> {
  doc: Automerge.Doc<T>;
  /** Apply a change to the document */
  change: (description: string, changeFn: (d: T) => void) => void;
  /** Get the current state as plain object */
  getState: () => T;
  /** Serialize for storage/transport */
  save: () => any;
  /** Get change history */
  getHistory: () => Array<{
    message: string;
  }>;
  /** Merge with a remote document */
  merge: (remote: any) => void;
  /** Get the number of changes */
  getChangeCount: () => number;
}

// ── Document factory ──────────────────────────────────────

/**
 * Create a new versioned document with Automerge.
 * Every change is automatically tracked with timestamp and description.
 */
export function createVersionedDoc<T extends Record<string, unknown>>(
  initialState: T
): VersionedDocument<T> {
  let doc = Automerge.from(initialState);

  return {
    doc,
    change: (description: string, changeFn: (d: T) => void) => {
      doc = Automerge.change(doc, description, changeFn);
    },
    getState: () => {
      return JSON.parse(JSON.stringify(doc)) as T;
    },
    save: () => {
      return Automerge.save(doc);
    },
    getHistory: () => {
      return Automerge.getHistory(doc).map((entry: any) => ({
        message: entry.change?.message || '',
      }));
    },
    merge: (remote: any) => {
      const remoteDoc = Automerge.load<T>(remote);
      doc = Automerge.merge(doc, remoteDoc);
    },
    getChangeCount: () => {
      return Automerge.getHistory(doc).length;
    },
  };
}

/**
 * Load a versioned document from saved bytes.
 */
export function loadVersionedDoc<T extends Record<string, unknown>>(
  savedBytes: any
): VersionedDocument<T> {
  let doc = Automerge.load<T>(savedBytes);

  return {
    doc,
    change: (description: string, changeFn: (d: T) => void) => {
      doc = Automerge.change(doc, description, changeFn);
    },
    getState: () => {
      return JSON.parse(JSON.stringify(doc)) as T;
    },
    save: () => {
      return Automerge.save(doc);
    },
    getHistory: () => {
      return Automerge.getHistory(doc).map((entry: any) => ({
        message: entry.change?.message || '',
      }));
    },
    merge: (remote: any) => {
      const remoteDoc = Automerge.load<T>(remote);
      doc = Automerge.merge(doc, remoteDoc);
    },
    getChangeCount: () => {
      return Automerge.getHistory(doc).length;
    },
  };
}

// ── Preset document schemas ───────────────────────────────

/**
 * Create a versioned incident document.
 */
export function createVersionedIncident(data: {
  incidentNumber: string;
  type: string;
  status: string;
  location: string;
  narrative: string;
}) {
  return createVersionedDoc({
    incidentNumber: data.incidentNumber,
    type: data.type,
    status: data.status,
    location: data.location,
    narrative: data.narrative,
    officers: [] as string[],
    evidence: [] as string[],
    supplements: [] as Array<{ author: string; text: string; timestamp: number }>,
    lastModified: Date.now(),
  });
}

/**
 * Create a versioned case file document.
 */
export function createVersionedCaseFile(data: {
  caseNumber: string;
  title: string;
  assignedTo: string;
}) {
  return createVersionedDoc({
    caseNumber: data.caseNumber,
    title: data.title,
    assignedTo: data.assignedTo,
    status: 'OPEN',
    notes: [] as Array<{ author: string; text: string; timestamp: number }>,
    linkedIncidents: [] as string[],
    linkedPersons: [] as string[],
    linkedEvidence: [] as string[],
    lastModified: Date.now(),
  });
}
