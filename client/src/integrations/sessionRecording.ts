// ============================================================
// RMPG Flex — Session Recording (rrweb)
// ============================================================
// CJIS-compliant session recording for audit trails.
// Records dispatch console sessions (DOM mutations, inputs,
// scrolling) as compressed event streams for supervisory review.
// ============================================================

import { record as rrwebRecord } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';

// ── Types ─────────────────────────────────────────────────

export interface SessionRecording {
  sessionId: string;
  userId: number;
  username: string;
  startedAt: string;
  events: eventWithTime[];
  metadata: {
    url: string;
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
  };
}

// ── Recording manager ─────────────────────────────────────

let stopFn: (() => void) | null = null;
let currentEvents: eventWithTime[] = [];
let currentSessionId: string | null = null;
const MAX_EVENTS = 50_000; // Safety cap to prevent memory issues

/**
 * Start recording the current session.
 * Events are buffered in memory until flushed or stopped.
 */
export function startRecording(sessionId: string): void {
  if (stopFn) {
    stopRecording();
  }

  currentSessionId = sessionId;
  currentEvents = [];

  stopFn = rrwebRecord({
    emit(event) {
      if (currentEvents.length < MAX_EVENTS) {
        currentEvents.push(event);
      }
    },
    // Mask sensitive inputs (passwords, SSN, etc.)
    maskInputOptions: {
      password: true,
    },
    // Block recording of sensitive elements
    blockSelector: '.no-record, [data-no-record]',
    // Mask text in sensitive elements
    maskTextSelector: '.mask-text, [data-mask-text]',
    // Sample mouse movements to reduce data volume
    sampling: {
      mousemove: true,
      mouseInteraction: true,
      scroll: 150,
      input: 'last',
    },
  }) || null;
}

/**
 * Stop recording and return the captured events.
 */
export function stopRecording(): eventWithTime[] {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
  const events = [...currentEvents];
  currentEvents = [];
  currentSessionId = null;
  return events;
}

/**
 * Get the current recording status.
 */
export function getRecordingStatus(): {
  isRecording: boolean;
  sessionId: string | null;
  eventCount: number;
  estimatedSizeKB: number;
} {
  const sizeEstimate = currentEvents.length > 0
    ? Math.round(JSON.stringify(currentEvents).length / 1024)
    : 0;

  return {
    isRecording: stopFn !== null,
    sessionId: currentSessionId,
    eventCount: currentEvents.length,
    estimatedSizeKB: sizeEstimate,
  };
}

/**
 * Flush current events (for periodic uploads to server).
 * Returns the events and resets the buffer.
 */
export function flushEvents(): eventWithTime[] {
  const events = [...currentEvents];
  currentEvents = [];
  return events;
}

/**
 * Build a complete session recording object for storage.
 */
export function buildSessionRecording(
  userId: number,
  username: string
): SessionRecording | null {
  if (!currentSessionId) return null;

  return {
    sessionId: currentSessionId,
    userId,
    username,
    startedAt: new Date().toISOString(),
    events: [...currentEvents],
    metadata: {
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
    },
  };
}
