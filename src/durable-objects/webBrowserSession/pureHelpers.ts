// Pure, dependency-free helpers for WebBrowserSessionDO — kept separate so
// they're unit-testable without a live Durable Object or Browser Rendering
// binding, matching this codebase's existing pattern of pulling pure logic
// out of DO files (see desktop/windowManager.js's role in the desktop app
// for the same idea, or WelfareWatchDO's own escalation-timing constants).

/** 5 minutes of no input (navigate/click/type/scroll) ends the session. */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function isIdleTimedOut(lastInputAt: number, now: number): boolean {
  return now - lastInputAt >= IDLE_TIMEOUT_MS;
}

export function shapeFrameMessage(base64Jpeg: string): { type: 'frame'; data: string } {
  return { type: 'frame', data: base64Jpeg };
}

export function shapeErrorMessage(message: string): { type: 'error'; message: string } {
  return { type: 'error', message };
}

export function shapeSessionEndedMessage(reason: 'idle_timeout' | 'closed'): { type: 'session_ended'; reason: string } {
  return { type: 'session_ended', reason };
}
