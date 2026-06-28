import { useEffect, useState } from 'react';
import { apiFetch } from './useApi';

export interface PlayerClip {
  seq: number;
  fromTs: number;
  toTs: number;
  durationMs: number;
  url: string;
  sha256: string | null;
  bytes: number;
}

export interface PlayerGap {
  startTs: number;
  endTs: number;
  durationMs: number;
}

export interface TripPlayerManifest {
  tripId: number;
  channel: string;
  totalDurationMs: number;
  stillDownloading: number;
  clips: PlayerClip[];
  gaps: PlayerGap[];
}

interface State {
  manifest: TripPlayerManifest | null;
  error: Error | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 10_000;

export function useFlexCamManifest(tripId: number, channel: string) {
  const [state, setState] = useState<State>({ manifest: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const m = await apiFetch<TripPlayerManifest>(
          `/flexcam/trips/${tripId}/manifest?channel=${encodeURIComponent(channel)}`
        );
        if (cancelled) return;
        setState({ manifest: m, error: null, loading: false });
        if (m.stillDownloading > 0) {
          timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setState({ manifest: null, error: err as Error, loading: false });
      }
    };

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId, channel]);

  return state;
}
