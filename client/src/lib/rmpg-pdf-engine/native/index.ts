// Native PDF backend.
//
// Implements RmpgPdfBackend. Pre-validates the document on open() so we
// throw BackendUnsupportedError early when we hit features outside our
// scope, letting the dispatcher fall back to PDF.js without wasted work.
//
// Currently supported document profile:
//   - Classic /Catalog + /Pages tree (no flat page lists in object streams)
//   - FlateDecode'd or uncompressed content streams
//   - Standard 14 fonts only (no embedded Type1/TrueType/CFF)
//   - Solid DeviceRGB / DeviceGray fills + strokes
//   - Operators listed in contentStream.ts
//   - No /Encrypt entry (encrypted PDFs always fall back)
//   - No images (Do op forces fallback)
//
// Anything else → BackendUnsupportedError → PDF.js takes over.

import {
  BackendUnsupportedError,
  PageViewport,
  RenderOptions,
  RmpgPdfBackend,
  RmpgPdfDocument,
  RmpgPdfPage,
  TextItem,
} from '../types';
import { PdfObjectParser, PdfValue, XrefEntry, decodeStream } from './parser';
import { renderContentStream } from './contentStream';
import { stdFontFamily } from './fonts';
import { Lexer, decodeText } from './lexer';

interface NativePageRecord {
  pageNumber: number;
  mediaBox: [number, number, number, number];
  rotation: number;
  contentStreams: Uint8Array[];
  fonts: Map<string, { family: string; encoding: 'standard' | 'identity-h' }>;
}

class NativePage implements RmpgPdfPage {
  constructor(public pageNumber: number, private record: NativePageRecord) {}

  getViewport({ scale }: { scale: number }): PageViewport {
    const [x0, y0, x1, y1] = this.record.mediaBox;
    const w = (x1 - x0) * scale;
    const h = (y1 - y0) * scale;
    return { width: w, height: h, scale, rotation: this.record.rotation };
  }

  async render(opts: RenderOptions): Promise<HTMLCanvasElement> {
    const v = this.getViewport({ scale: opts.scale });
    const canvas = opts.canvas ?? document.createElement('canvas');
    canvas.width = v.width;
    canvas.height = v.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new BackendUnsupportedError('2D canvas context unavailable');
    // White page background.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pageHeight = this.record.mediaBox[3] - this.record.mediaBox[1];
    for (const stream of this.record.contentStreams) {
      await renderContentStream(stream, {
        ctx, pageHeight, scale: opts.scale,
        fontByResName: this.record.fonts,
      });
    }
    return canvas;
  }

  async getTextContent(): Promise<TextItem[]> {
    // Native text-content extraction would require running the content
    // stream interpreter in "measure" mode and collecting Tj/TJ positions.
    // Out-of-scope for this iteration — return empty so callers know to
    // fall back to PDF.js for selection if they need it.
    return [];
  }
}

class NativeDocument implements RmpgPdfDocument {
  readonly backend = 'native' as const;
  constructor(
    private records: NativePageRecord[],
    public backendReason: string,
  ) {}
  get numPages(): number { return this.records.length; }
  async getPage(pageNumber: number): Promise<RmpgPdfPage> {
    const r = this.records[pageNumber - 1];
    if (!r) throw new Error(`Page ${pageNumber} out of range`);
    return new NativePage(pageNumber, r);
  }
  async destroy(): Promise<void> { /* no-op — we hold no native resources */ }
}

export class NativeBackend implements RmpgPdfBackend {
  readonly name = 'native' as const;

  async open(bytes: Uint8Array): Promise<RmpgPdfDocument> {
    // Sanity: %PDF- header at byte 0..4.
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
      throw new BackendUnsupportedError('Missing %PDF- header');
    }

    const parser = new PdfObjectParser(bytes);
    const startxref = parser.findStartxref();
    const { entries, trailer } = parser.parseXrefTable(startxref);

    if (trailer.has('Encrypt')) {
      throw new BackendUnsupportedError('Document is encrypted');
    }

    const rootRef = trailer.get('Root');
    if (!rootRef || rootRef.kind !== 'ref') throw new BackendUnsupportedError('Trailer missing /Root reference');
    const catalog = parser.resolve(entries, rootRef);
    if (catalog.kind !== 'dict') throw new BackendUnsupportedError('Catalog not a dictionary');

    const pagesRef = catalog.entries.get('Pages');
    if (!pagesRef) throw new BackendUnsupportedError('Catalog missing /Pages');

    const pageRecords: NativePageRecord[] = [];
    await this.walkPages(parser, entries, parser.resolve(entries, pagesRef), {}, pageRecords);

    const reason = `Native engine — ${pageRecords.length} page(s) parsed without unsupported features`;
    return new NativeDocument(pageRecords, reason);
  }

  /** Recursively walk the /Pages tree, inheriting /MediaBox /Rotate /Resources. */
  private async walkPages(
    parser: PdfObjectParser,
    xref: Map<number, XrefEntry>,
    node: PdfValue,
    inherited: { mediaBox?: [number, number, number, number]; rotate?: number; resources?: PdfValue },
    out: NativePageRecord[],
  ): Promise<void> {
    if (node.kind !== 'dict') throw new BackendUnsupportedError('Page tree node is not a dictionary');
    const type = node.entries.get('Type');
    const mediaBoxV = node.entries.get('MediaBox');
    const rotateV = node.entries.get('Rotate');
    const resourcesV = node.entries.get('Resources');
    const next = {
      mediaBox: mediaBoxV ? this.readBox(parser.resolve(xref, mediaBoxV)) : inherited.mediaBox,
      rotate: rotateV && rotateV.kind === 'number' ? rotateV.value : inherited.rotate,
      resources: resourcesV ? parser.resolve(xref, resourcesV) : inherited.resources,
    };

    if (type && type.kind === 'name' && type.value === 'Pages') {
      const kids = node.entries.get('Kids');
      if (!kids) throw new BackendUnsupportedError('Pages node missing /Kids');
      const arr = parser.resolve(xref, kids);
      if (arr.kind !== 'array') throw new BackendUnsupportedError('/Kids not an array');
      for (const k of arr.items) {
        await this.walkPages(parser, xref, parser.resolve(xref, k), next, out);
      }
      return;
    }

    if (type && type.kind === 'name' && type.value === 'Page') {
      if (!next.mediaBox) throw new BackendUnsupportedError('Page missing inherited /MediaBox');
      const fonts = await this.collectFonts(parser, xref, next.resources);

      // Read /Contents — can be a single stream or an array of streams.
      const contentsRef = node.entries.get('Contents');
      const streams: Uint8Array[] = [];
      if (contentsRef) {
        const resolved = parser.resolve(xref, contentsRef);
        if (resolved.kind === 'stream') {
          streams.push(await decodeStream(resolved));
        } else if (resolved.kind === 'array') {
          for (const it of resolved.items) {
            const s = parser.resolve(xref, it);
            if (s.kind !== 'stream') throw new BackendUnsupportedError('Contents array entry not a stream');
            streams.push(await decodeStream(s));
          }
        }
      }

      out.push({
        pageNumber: out.length + 1,
        mediaBox: next.mediaBox,
        rotation: next.rotate ?? 0,
        contentStreams: streams,
        fonts,
      });
    }
  }

  private readBox(v: PdfValue): [number, number, number, number] {
    if (v.kind !== 'array' || v.items.length !== 4) throw new BackendUnsupportedError('Box not [llx lly urx ury]');
    const out: number[] = [];
    for (const it of v.items) {
      if (it.kind !== 'number') throw new BackendUnsupportedError('Box entry not a number');
      out.push(it.value);
    }
    return [out[0], out[1], out[2], out[3]];
  }

  /** Resolve /Resources/Font into a name → web-font-family map. */
  private async collectFonts(
    parser: PdfObjectParser,
    xref: Map<number, XrefEntry>,
    resources: PdfValue | undefined,
  ): Promise<Map<string, { family: string; encoding: 'standard' | 'identity-h' }>> {
    const fonts = new Map<string, { family: string; encoding: 'standard' | 'identity-h' }>();
    if (!resources || resources.kind !== 'dict') return fonts;
    const fontDict = resources.entries.get('Font');
    if (!fontDict) return fonts;
    const dict = parser.resolve(xref, fontDict);
    if (dict.kind !== 'dict') return fonts;
    for (const [resName, fontRef] of dict.entries) {
      const f = parser.resolve(xref, fontRef);
      if (f.kind !== 'dict') throw new BackendUnsupportedError(`Font /${resName} not a dictionary`);
      const subtype = f.entries.get('Subtype');
      if (!subtype || subtype.kind !== 'name') {
        throw new BackendUnsupportedError(`Font /${resName} missing /Subtype`);
      }
      if (subtype.value !== 'Type1' && subtype.value !== 'TrueType') {
        throw new BackendUnsupportedError(`Font /${resName} subtype ${subtype.value} not supported in native`);
      }
      const baseFontV = f.entries.get('BaseFont');
      const baseName = baseFontV && baseFontV.kind === 'name' ? baseFontV.value : null;
      const family = stdFontFamily(baseName);
      if (!family) {
        throw new BackendUnsupportedError(`Font /${resName} (${baseName}) is not Standard 14`);
      }
      fonts.set(resName, { family, encoding: 'standard' });
    }
    return fonts;
  }
}

export const nativeBackend = new NativeBackend();
