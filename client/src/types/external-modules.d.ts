declare module '@excalidraw/excalidraw' {
  import React from 'react';
  export const Excalidraw: React.ComponentType<any>;
  export function exportToBlob(opts: {
    elements: readonly any[];
    appState: any;
    mimeType?: string;
  }): Promise<Blob>;
}

declare module '@turf/turf' {
  export function point(coords: [number, number], properties?: any): any;
  export function featureCollection(features: any[]): any;
  export function booleanPointInPolygon(point: any, polygon: any): boolean;
  export function nearestPoint(target: any, points: any): any;
  export function distance(from: any, to: any, options?: { units?: string }): number;
  export function buffer(geojson: any, radius: number, options?: { units?: string }): any;
  export function clustersDbscan(points: any, radius: number, options?: { units?: string; minPoints?: number }): any;
  export function convex(points: any): any;
  export function centroid(feature: any): any;
  export function area(feature: any): number;
  export function voronoi(points: any, options?: { bbox: [number, number, number, number] }): any;
}

declare module 'tesseract.js' {
  interface TesseractResult {
    data: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
      lines?: Array<{
        text: string;
        confidence: number;
      }>;
    };
  }
  interface TesseractStatic {
    recognize(
      image: string | Blob | File,
      lang?: string,
      options?: { logger?: (m: { status: string; progress: number }) => void }
    ): Promise<TesseractResult>;
  }
  declare const Tesseract: TesseractStatic;
  export default Tesseract;
}

declare module 'peerjs' {
  interface PeerOptions {
    config?: {
      iceServers?: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }>;
    };
  }
  class Peer {
    id: string;
    open: boolean;
    constructor(id?: string, options?: PeerOptions);
    connect(peerId: string, options?: { reliable?: boolean }): DataConnection;
    call(peerId: string, stream: MediaStream): MediaConnection;
    destroy(): void;
    on(event: string, cb: (...args: any[]) => void): void;
  }
  class DataConnection {
    peer: string;
    open: boolean;
    send(data: unknown): void;
    close(): void;
    on(event: string, cb: (...args: any[]) => void): void;
  }
  class MediaConnection {
    peer: string;
    answer(stream: MediaStream): void;
    close(): void;
    on(event: string, cb: (...args: any[]) => void): void;
  }
  export default Peer;
  export { DataConnection, MediaConnection };
}

declare module 'rrweb' {
  interface RecordOptions {
    emit(event: any): void;
    maskInputOptions?: Record<string, boolean>;
    blockSelector?: string;
    maskTextSelector?: string;
    sampling?: {
      mousemove?: boolean | number;
      mouseInteraction?: boolean;
      scroll?: number | boolean;
      input?: 'last' | number;
    };
  }
  export function record(options: RecordOptions): (() => void) | undefined;
}

declare module '@rrweb/types' {
  export interface eventWithTime {
    type: number;
    timestamp: number;
    data: any;
  }
}

declare module 'yjs' {
  export class Doc {
    clientID: number;
    getText(name: string): Text;
    getMap<T = unknown>(name: string): Map<T>;
    getArray<T = unknown>(name: string): Array<T>;
    on(event: 'update', handler: (update: Uint8Array, origin: any) => void): void;
    destroy(): void;
  }
  export class Text {
    length: number;
    insert(index: number, content: string): void;
    toString(): string;
  }
  export class Map<T = unknown> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    toJSON(): Record<string, T>;
  }
  export class Array<T = unknown> {
    push(items: T[]): void;
    toJSON(): T[];
  }
  export function applyUpdate(doc: Doc, update: Uint8Array): void;
  export function encodeStateVector(doc: Doc): Uint8Array;
  export function encodeStateAsUpdate(doc: Doc): Uint8Array;
}

declare module 'automerge' {
  namespace Automerge {
    type Doc<T> = T;
    function from<T extends Record<string, unknown>>(initial: T): Doc<T>;
    function change<T extends Record<string, unknown>>(
      doc: Doc<T>,
      message: string,
      callback: (d: T) => void
    ): Doc<T>;
    function save<T>(doc: Doc<T>): any;
    function load<T extends Record<string, unknown>>(data: any): Doc<T>;
    function merge<T extends Record<string, unknown>>(local: Doc<T>, remote: Doc<T>): Doc<T>;
    function getHistory<T>(doc: Doc<T>): Array<{
      change?: { message?: string };
    }>;
  }
  export = Automerge;
}

declare module 'graphology' {
  class Graph {
    constructor();
    addNode(node: string, attributes?: Record<string, any>): void;
    addEdge(source: string, target: string, attributes?: Record<string, any>): void;
    getNodeAttributes(node: string): Record<string, any>;
    getNodeAttribute(node: string, name: string): any;
    setNodeAttribute(node: string, name: string, value: any): void;
    hasNode(node: string): boolean;
    dropNode(node: string): void;
    neighbors(node: string): string[];
    forEachNode(callback: (node: string, attributes?: Record<string, any>) => void): void;
  }
  export default Graph;
}

declare module 'sigma' {
  import Graph from 'graphology';
  interface SigmaOptions {
    renderEdgeLabels?: boolean;
    defaultNodeColor?: string;
    defaultEdgeColor?: string;
    labelColor?: { color: string };
    labelSize?: number;
    labelRenderedSizeThreshold?: number;
    edgeLabelSize?: number;
    [key: string]: any;
  }
  class Sigma {
    constructor(graph: Graph, container: HTMLElement, options?: SigmaOptions);
    on(event: string, handler: (...args: any[]) => void): void;
    kill(): void;
    refresh(): void;
  }
  export default Sigma;
}

declare module '@observablehq/plot' {
  interface PlotOptions {
    width?: number;
    height?: number;
    marginLeft?: number;
    marginBottom?: number;
    style?: Record<string, string>;
    x?: any;
    y?: any;
    color?: any;
    marks?: any[];
    title?: string;
    [key: string]: any;
  }
  namespace Plot {
    function plot(options?: PlotOptions): SVGSVGElement | HTMLElement;
    function barY(data: any[], options?: any): any;
    function ruleY(data?: any[]): any;
    function lineY(data: any[], options?: any): any;
    function dot(data: any[], options?: any): any;
    function cell(data: any[], options?: any): any;
    function boxX(data: any[], options?: any): any;
    function barX(data: any[], options?: any): any;
    function ruleX(data?: any[]): any;
  }
  export = Plot;
}

declare module '@deck.gl/google-maps' {
  import type { Layer } from '@deck.gl/core';
  export class GoogleMapsOverlay {
    constructor(props: { layers: Layer[] | any[] });
    setMap(map: google.maps.Map): void;
    setProps(props: { layers: Layer[] | any[] }): void;
    finalize(): void;
  }
}

declare module '@deck.gl/layers' {
  import type { Layer } from '@deck.gl/core';
  export class ScatterplotLayer extends Layer {
    constructor(props: any);
  }
  export class ArcLayer extends Layer {
    constructor(props: any);
  }
  export class IconLayer extends Layer {
    constructor(props: any);
  }
}

declare module 'vis-timeline/standalone' {
  import { DataSet } from 'vis-data/standalone';
  export class Timeline {
    constructor(container: HTMLElement, items: DataSet, options?: any);
    setGroups(groups: DataSet): void;
    destroy(): void;
    fit(options?: any): void;
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
  }
}

declare module 'vis-data/standalone' {
  export class DataSet<T = any> {
    constructor(data?: T[]);
    add(data: T | T[]): void;
    remove(id: string | number | (string | number)[]): void;
    clear(): void;
    get(id?: string | number): T | T[];
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
  }
}

declare module 'vis-timeline/styles/vis-timeline-graph2d.css' {}

declare module '@mapbox/search-js-react' {
  import React from 'react';
  interface AddressAutofillProps {
    accessToken: string;
    onRetrieve: (res: any) => void;
    options?: {
      country?: string;
      proximity?: { lng: number; lat: number };
      language?: string;
      [key: string]: any;
    };
    children: React.ReactNode;
    [key: string]: any;
  }
  export const AddressAutofill: React.ComponentType<AddressAutofillProps>;
  export const config: { accessToken: string };
}
