// ============================================================
// RMPG Flex — Dispatcher Brain Speak Queue
//
// Single prioritized queue that every Dispatcher Brain rule emits
// through. Enforces:
//  1. Severity preemption — 'major' beats 'moderate' beats 'minor'.
//  2. Per-rule cooldown — same ruleId+entityKey inside cooldownMs
//     is silently dropped (dedup).
//  3. Global non-major rate limit — at most one non-major utterance
//     per GLOBAL_LOW_GAP_MS so coaching + event rules cannot flood.
//
// Design rationale: by funneling ALL brain speech through here, the
// 15+ rules that land later in Phases 2–4 don't each need to ship
// their own rate-limit / dedup logic. The queue is the only place
// volume is controlled.
// ============================================================

import { speak } from './edgeTTS';
import type { AlertSeverity } from './alertSeverity';

export interface SpeechItem {
  text: string;
  severity: AlertSeverity;
  ruleId: string;
  entityKey: string;
  /** Per-rule silence window (ms). 0 means no cooldown. */
  cooldownMs?: number;
}

// Lower rank = higher priority. 'major' preempts everything else.
const SEV_RANK: Record<AlertSeverity, number> = {
  major:    0,
  moderate: 1,
  minor:    2,
};

/** Max gap between consecutive non-major utterances (ms). */
const GLOBAL_LOW_GAP_MS = 6000;

const queue: SpeechItem[] = [];
const lastSpoken = new Map<string, number>(); // key = `${ruleId}|${entityKey}`
let draining = false;
let lastNonMajorAt = 0;

function cooldownKey(item: SpeechItem): string {
  return `${item.ruleId}|${item.entityKey}`;
}

let drainScheduled = false;

export function enqueueSpeech(item: SpeechItem): void {
  // Dedup: if the same rule+entity spoke inside the cooldown window, drop.
  const cd = item.cooldownMs ?? 0;
  if (cd > 0) {
    const last = lastSpoken.get(cooldownKey(item));
    if (last != null && Date.now() - last < cd) return;
  }

  queue.push(item);
  // Sort by severity so major alerts drain first even if enqueued later.
  queue.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  // Defer drain via a microtask so callers that enqueue multiple items
  // in the same synchronous turn all land before the first shift()+await.
  // Without this, the first enqueue starts draining immediately and
  // later higher-severity items sit behind the in-flight one.
  if (!drainScheduled) {
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      void drain();
    });
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;

      // Global non-major rate limit — enforce MIN gap between utterances.
      if (next.severity !== 'major') {
        const gap = Date.now() - lastNonMajorAt;
        if (gap < GLOBAL_LOW_GAP_MS) {
          await new Promise((r) => setTimeout(r, GLOBAL_LOW_GAP_MS - gap));
        }
      }

      await speak(next.text, next.severity);
      lastSpoken.set(cooldownKey(next), Date.now());
      if (next.severity !== 'major') lastNonMajorAt = Date.now();
    }
  } finally {
    draining = false;
  }
}

/** Test-only: wipe queue + cooldown map. Not exported for production use. */
export function __resetQueueForTest(): void {
  queue.length = 0;
  lastSpoken.clear();
  lastNonMajorAt = 0;
  draining = false;
  drainScheduled = false;
}
