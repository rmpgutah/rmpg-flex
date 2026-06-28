// src/utils/footage/closeStatus.ts
//
// Pure helper for the close-query at end of pollAndDownload. Decides what
// terminal status a request should carry when all its chunks are resolved.
//
// History: the original close-query was 'complete' (all downloaded) | 'partial'
// (any missing). That mis-classified the "0 downloads + all missing" case as
// 'partial' — visually it reads as "some footage retrieved" when there is
// none. Plan C's early-abandon path made this collision visible on trip 94:
// 5 minutes after repair, all 23 chunks got marked missing and the close-query
// flipped the request to 'partial' instead of 'failed'. Plan E adds the
// 'failed' verdict so the UI is honest from the moment the cron concludes.

export interface CloseStatusInput {
  /** Real number of 'downloaded' chunks the request has. */
  chunksDone: number;
  /** True if at least one chunk is in 'missing' status. */
  hasMissing: boolean;
}

export type CloseStatus = 'complete' | 'partial' | 'failed';

export function resolveCloseStatus(s: CloseStatusInput): CloseStatus {
  // Zero downloads AND chunks tried-and-missed → honest failure.
  if (s.chunksDone <= 0 && s.hasMissing) return 'failed';
  // Some downloads but not all → genuinely partial.
  if (s.hasMissing) return 'partial';
  // Nothing missing → complete (covers both "all downloaded" and the edge
  // case of a 0-chunk no-op request, where calling it 'failed' would be wrong).
  return 'complete';
}
