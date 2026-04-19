import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import { fromLonLat } from 'ol/proj';
import { useWebSocket } from '../../../context/WebSocketContext';
import { devLog } from '../../../utils/devLog';

interface DispatchUpdateMsg {
  data?: any;
  action?: string;
  call?: any;
}

/**
 * Auto-pan + zoom-to-fit when a new P1 call is broadcast over WebSocket.
 *
 * Subscribes to dispatch_update events. On a `call_created` action with
 * priority='P1' and known lat/lng, animates the view to the call point
 * at zoom 14. Designed to grab the dispatcher's eye when the highest-
 * priority calls hit the queue, even if they're focused elsewhere on
 * the map.
 *
 * Toggleable via the `enabled` opt — defaults off so dispatchers don't
 * get yanked around when they don't want it. They can opt in via the
 * coverage bar's "AUTO" toggle.
 *
 * Dedupe: tracks the last 50 panned-to call IDs to avoid re-panning if
 * the same call broadcasts an update event within seconds of creation.
 */
export function useOlAutoPanToP1(map: OlMap | null, opts: { enabled: boolean }): void {
  const recentRef = useRef<Set<string>>(new Set());
  const recentOrderRef = useRef<string[]>([]);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!map || !opts.enabled) return;

    const handler = (msg: DispatchUpdateMsg) => {
      const data = msg.data || msg;
      if (data?.action !== 'call_created') return;
      const call = data.call;
      if (!call || call.priority !== 'P1') return;
      const id = String(call.id);
      if (recentRef.current.has(id)) return;
      const lat = Number(call.latitude);
      const lng = Number(call.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      recentRef.current.add(id);
      recentOrderRef.current.push(id);
      if (recentOrderRef.current.length > 50) {
        const old = recentOrderRef.current.shift();
        if (old) recentRef.current.delete(old);
      }

      devLog(`[map-v2] auto-pan to P1 ${call.call_number}`);
      map.getView().animate({
        center: fromLonLat([lng, lat]),
        zoom: 14,
        duration: 700,
      });
    };

    const unsub = subscribe('dispatch_update', handler);
    return unsub;
  }, [map, opts.enabled, subscribe]);
}
