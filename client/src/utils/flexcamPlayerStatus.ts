// client/src/utils/flexcamPlayerStatus.ts
//
// Pure formatter for the FlexCam player's empty-state / status badge. Picks the
// most informative message for a player that has no clips loaded yet — error
// > terminal-failed > downloading > partial-count > no-footage > ready — so
// the player stops looking dead when the real story is "the queue is still
// pulling clips" or "the fetch errored, here is why."

export interface PlayerStatusInput {
  err: string | null;
  chunkCount: number;
  downloadedCount: number;
  requestStatus: string;
}

export interface PlayerStatus {
  label: string;
  severity: 'error' | 'progress' | 'idle';
}

export function formatPlayerStatus(s: PlayerStatusInput): PlayerStatus {
  if (s.err) return { label: `Failed: ${s.err}`, severity: 'error' };
  if (s.requestStatus === 'failed') {
    return { label: 'Footage capture failed — try repair', severity: 'error' };
  }
  if (s.downloadedCount === 0 && s.requestStatus === 'fulfilling') {
    return { label: 'Downloading footage…', severity: 'progress' };
  }
  if (s.downloadedCount === 0) {
    return { label: 'No footage available', severity: 'idle' };
  }
  if (s.downloadedCount < s.chunkCount) {
    return { label: `${s.downloadedCount} of ${s.chunkCount} clips ready`, severity: 'progress' };
  }
  return { label: 'Ready', severity: 'idle' };
}
