import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import type Feature from 'ol/Feature';
import type Point from 'ol/geom/Point';
import Translate from 'ol/interaction/Translate';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import type { Unit, CallForService } from '../../../types';
import { devWarn } from '../../../utils/devLog';

/**
 * Drag a unit pin onto a call pin to dispatch it.
 *
 * - Adds an OL Translate interaction filtered to features with kind='unit'.
 * - On translateend, reads the drop coordinate and hits-test for an
 *   overlapping call feature via map.forEachFeatureAtPixel.
 * - If a call is hit: POST /dispatch/calls/{id}/assign-unit, toast success.
 * - Always: snap the unit feature back to its server-known lat/lng. The
 *   next WS-driven refetch will overwrite anyway, but a synchronous snap
 *   avoids a visible "drift back" animation when the call hit fires.
 *
 * Why Translate instead of custom pointer events: Translate auto-suspends
 * the DragPan interaction while a feature is being moved, and provides
 * the filter API to scope drag-eligibility to unit markers (not calls,
 * not beat polygons, not the basemap).
 */
export function useOlDragDispatch(map: OlMap | null): void {
  const translateRef = useRef<Translate | null>(null);
  const { addToast } = useToast();

  useEffect(() => {
    if (!map || translateRef.current) return;

    const translate = new Translate({
      filter: (feature) => feature.get('kind') === 'unit',
      hitTolerance: 6,
    });
    translateRef.current = translate;
    map.addInteraction(translate);

    translate.on('translateend', (evt: any) => {
      const feature = evt.features.item(0) as Feature<Point> | undefined;
      if (!feature) return;
      const unit = feature.get('payload') as Unit | undefined;
      if (!unit) return;

      const geom = feature.getGeometry() as Point | null;
      if (!geom) return;
      const dropCoord = geom.getCoordinates();
      const dropPixel = map.getPixelFromCoordinate(dropCoord);

      // Hit-test for any call feature under the drop point. Skip the unit
      // itself by filtering on kind.
      let hitCall: CallForService | null = null;
      map.forEachFeatureAtPixel(
        dropPixel,
        (f) => {
          if (f.get('kind') === 'call') {
            hitCall = f.get('payload') as CallForService;
            return true;
          }
          return undefined;
        },
        { hitTolerance: 8 },
      );

      // Snap unit back to its server-known position (next refetch would
      // do this anyway but the visible drift is unprofessional).
      if (unit.latitude != null && unit.longitude != null) {
        geom.setCoordinates(fromLonLat([unit.longitude, unit.latitude]));
      }

      if (!hitCall) return;

      const call = hitCall as CallForService;

      // Server-side assignment
      apiFetch(`/dispatch/calls/${call.id}/assign-unit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unit.id }),
      })
        .then(() => {
          addToast(`Dispatched ${unit.call_sign} to ${call.call_number}`, 'success');
        })
        .catch((err) => {
          devWarn('[map-v2] assign-unit failed:', err);
          addToast(
            `Failed to dispatch ${unit.call_sign} to ${call.call_number}: ${err?.message || 'unknown error'}`,
            'error',
          );
        });
    });

    return () => {
      if (translateRef.current) {
        map.removeInteraction(translateRef.current);
        translateRef.current = null;
      }
    };
  }, [map, addToast]);
}
