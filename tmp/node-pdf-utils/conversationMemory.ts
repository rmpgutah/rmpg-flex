// ============================================================
// RMPG Flex — Conversation Memory
//
// Stores recent voice exchanges for multi-turn dialogs and
// confirmation flows. Module-level state with TTL expiration.
//
// Usage:
//   addEntry({ role: 'officer', text: 'Show me active calls', timestamp: Date.now() });
//   const pending = getPendingConfirmation();
//   if (pending && isConfirmation(transcript)) { /* execute */ }
// ============================================================

// ─── Types ──────────────────────────────────────────────────

export interface ConversationEntry {
  role: 'officer' | 'system';
  text: string;
  timestamp: number;
  action?: string;
  awaitingConfirmation?: boolean;
  confirmationAction?: string;
  confirmationParams?: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────

const MAX_ENTRIES = 6;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── State ──────────────────────────────────────────────────

let entries: ConversationEntry[] = [];
let lastInteraction = 0;

// ─── Confirmation patterns ──────────────────────────────────

const CONFIRM_RE = /\b(confirm|affirm|10-4|copy|yes|roger|go ahead|proceed)\b/i;
const DENIAL_RE = /\b(cancel|negative|no|deny|stop|abort|disregard)\b/i;

// ─── Public API ─────────────────────────────────────────────

export function addEntry(entry: Omit<ConversationEntry, 'timestamp'> & { timestamp?: number }): void {
  entries.push({ ...entry, timestamp: entry.timestamp ?? Date.now() });
  lastInteraction = Date.now();

  // Auto-trim to max
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

export function getHistory(): ConversationEntry[] {
  if (entries.length === 0) return [];

  // Expire if past TTL
  if (Date.now() - lastInteraction > TTL_MS) {
    entries = [];
    return [];
  }

  return [...entries];
}

export function getPendingConfirmation(): ConversationEntry | null {
  if (entries.length === 0) return null;

  // Expire check
  if (Date.now() - lastInteraction > TTL_MS) {
    entries = [];
    return null;
  }

  const last = entries[entries.length - 1];
  if (last.role === 'system' && last.awaitingConfirmation) {
    return last;
  }
  return null;
}

export function setPendingConfirmation(
  message: string,
  action: string,
  params: Record<string, unknown>,
): void {
  addEntry({
    role: 'system',
    text: message,
    timestamp: Date.now(),
    awaitingConfirmation: true,
    confirmationAction: action,
    confirmationParams: params,
  });
}

export function isConfirmation(transcript: string): boolean {
  return CONFIRM_RE.test(transcript);
}

export function isDenial(transcript: string): boolean {
  return DENIAL_RE.test(transcript);
}

export function clearMemory(): void {
  entries = [];
  lastInteraction = 0;
}

export function getLastOfficerText(): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'officer') {
      return entries[i].text;
    }
  }
  return null;
}
