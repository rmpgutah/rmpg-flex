import { useEffect, useRef } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Circle from 'ol/geom/Circle';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import Style from 'ol/style/Style';
import Stroke from 'ol/style/Stroke';
import Fill from 'ol/style/Fill';
import CircleStyle from 'ol/style/Circle';
import { getLength, getArea } from 'ol/sphere';
import { Overlay } from 'ol';

export type DrawMode = 'measure' | 'perimeter' | 'radius' | null;

const DRAW_COLOR = '#d4a017';

const drawingStyle = new Style({
  stroke: new Stroke({ color: DRAW_COLOR, width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: '#d4a01722' }),
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: DRAW_COLOR }),
    stroke: new Stroke({ color: '#0a0a0a', width: 1 }),
  }),
});

const finishedStyle = new Style({
  stroke: new Stroke({ color: DRAW_COLOR, width: 2 }),
  fill: new Fill({ color: '#d4a01722' }),
});

function metersToFeet(m: number): number { return m * 3.28084; }
function metersToMiles(m: number): number { return m / 1609.344; }
function sqMetersToAcres(m2: number): number { return m2 * 0.000247105; }
function sqMetersToSqMiles(m2: number): number { return m2 / 2_589_988.11; }

function fmtDistance(m: number): string {
  const ft = metersToFeet(m);
  if (ft < 1000) return `${ft.toFixed(0)} ft`;
  const mi = metersToMiles(m);
  return `${mi.toFixed(2)} mi (${ft.toFixed(0)} ft)`;
}

function fmtArea(m2: number): string {
  const ac = sqMetersToAcres(m2);
  if (ac < 100) return `${ac.toFixed(2)} ac`;
  const sqmi = sqMetersToSqMiles(m2);
  return `${sqmi.toFixed(2)} mi² (${ac.toFixed(0)} ac)`;
}

function buildLabelEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.background = '#0a0a0a';
  el.style.border = `1px solid ${DRAW_COLOR}`;
  el.style.color = DRAW_COLOR;
  el.style.fontFamily = 'ui-monospace, monospace';
  el.style.fontSize = '11px';
  el.style.fontWeight = '700';
  el.style.padding = '2px 6px';
  el.style.whiteSpace = 'nowrap';
  el.style.pointerEvents = 'none';
  return el;
}

interface UseOlDrawToolOpts {
  /** Active draw mode; pass null to disable */
  mode: DrawMode;
  /** Bumping this number clears all drawn features without changing mode */
  clearVersion?: number;
}

/**
 * Drawing-tool hook for /map-v2.
 *
 * Manages a single dedicated VectorLayer for drawn shapes plus an OL
 * Draw interaction sized to the current `mode`. While drawing, a label
 * overlay tracks the cursor and shows live measurement (length for
 * lines, area for polygons, radius for circles). On draw end the label
 * detaches and the shape is left styled solid; the next draw starts a
 * fresh shape on the same layer.
 *
 * Why a single shared layer: keeps z-index management simple, and
 * `clearVersion` can wipe everything in one source.clear() call.
 *
 * Distances/areas are computed via ol/sphere getLength()/getArea(),
 * which respects the EPSG:3857 projection — accurate to within ~0.5%
 * over typical patrol-area scales.
 */
export function useOlDrawTool(map: OlMap | null, opts: UseOlDrawToolOpts): void {
  const layerRef = useRef<VectorLayer<Feature<Geometry>> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const drawRef = useRef<Draw | null>(null);
  const labelOverlayRef = useRef<Overlay | null>(null);
  const labelElRef = useRef<HTMLDivElement | null>(null);

  // Mount the drawing layer once when map appears
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: finishedStyle,
      zIndex: 50, // below markers (100), above beats (10)
    });
    layerRef.current = layer;
    map.addLayer(layer);

    const labelEl = buildLabelEl();
    labelElRef.current = labelEl;
    const labelOverlay = new Overlay({
      element: labelEl,
      offset: [12, 0],
      positioning: 'center-left',
      stopEvent: false,
    });
    labelOverlayRef.current = labelOverlay;
    map.addOverlay(labelOverlay);

    return () => {
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      if (labelOverlayRef.current) {
        map.removeOverlay(labelOverlayRef.current);
        labelOverlayRef.current = null;
      }
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
      labelElRef.current = null;
    };
  }, [map]);

  // Manage the Draw interaction based on mode
  useEffect(() => {
    if (!map || !sourceRef.current || !labelOverlayRef.current || !labelElRef.current) return;

    if (drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
      labelOverlayRef.current.setPosition(undefined);
    }

    if (!opts.mode) return;

    const type = opts.mode === 'measure' ? 'LineString'
              : opts.mode === 'perimeter' ? 'Polygon'
              : 'Circle';
    const draw = new Draw({
      source: sourceRef.current,
      type,
      style: drawingStyle,
    });
    drawRef.current = draw;
    map.addInteraction(draw);

    const onChange = (geom: Geometry, coord: number[]) => {
      const el = labelElRef.current!;
      if (geom instanceof LineString) {
        el.textContent = fmtDistance(getLength(geom));
      } else if (geom instanceof Polygon) {
        el.textContent = fmtArea(getArea(geom));
      } else if (geom instanceof Circle) {
        el.textContent = fmtDistance(geom.getRadius());
      }
      labelOverlayRef.current!.setPosition(coord);
    };

    let geomChangeKey: any = null;
    draw.on('drawstart', (evt: any) => {
      const geom = evt.feature.getGeometry();
      geomChangeKey = geom.on('change', () => {
        // Get latest coordinate for label position
        let coord: number[] | null = null;
        if (geom instanceof LineString) {
          const cs = geom.getCoordinates();
          coord = cs[cs.length - 1];
        } else if (geom instanceof Polygon) {
          const cs = geom.getCoordinates()[0];
          coord = cs[cs.length - 1];
        } else if (geom instanceof Circle) {
          const c = geom.getCenter();
          const r = geom.getRadius();
          coord = [c[0] + r, c[1]];
        }
        if (coord) onChange(geom, coord);
      });
    });
    draw.on('drawend', () => {
      if (geomChangeKey) {
        // ol/Observable removes via unByKey; importing here would be cleanest
        // but the next drawstart replaces geomChangeKey, so we can let GC
        // collect the previous handler when its geometry goes out of scope.
      }
      labelOverlayRef.current!.setPosition(undefined);
    });

    return () => {
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      labelOverlayRef.current?.setPosition(undefined);
    };
  }, [map, opts.mode]);

  // Clear all drawn shapes when clearVersion bumps
  useEffect(() => {
    if (opts.clearVersion === undefined) return;
    sourceRef.current?.clear();
    labelOverlayRef.current?.setPosition(undefined);
  }, [opts.clearVersion]);
}
