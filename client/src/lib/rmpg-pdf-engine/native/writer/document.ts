// RmpgPdfBuilder — high-level proprietary PDF builder.
//
// Loads a source PDF (via the native parser), exposes per-page operations
// that the editor's save pipeline needs (annotation overlays, image
// embedding, rotation, crop), and emits a fresh PDF byte stream — without
// any third-party PDF library in the path.
//
// What the builder owns
//   - Object graph construction + serialization (writer/objects.ts)
//   - Annotation overlay content streams (writer/streams.ts)
//   - JPEG image XObjects via DCTDecode (PDF reads JPEG bytes natively)
//   - Page tree + Catalog + Info dict + xref + trailer
//
// What is intentionally outside this v1
//   - Multi-document merge (still routes through the merge endpoint that
//     uses pdf-lib for now — flagged in the editor save.ts as TODO)
//   - Encryption (qpdf binary on the server handles that — separate path)
//   - Form-field generation (read-only AcroForm support is out of scope)

import { PdfObjectParser, PdfValue, XrefEntry, decodeStream } from '../parser';
import { ContentStreamBuilder, flateEncode } from './streams';
import {
  ARR, BOOL, DICT, N, NAME, NULL, NULL as _N, REF, WriterValue,
  concat, literalString, serializeValue, unicodeString,
} from './objects';

const TE = new TextEncoder();

interface PageBuild {
  /** Bytes of original /Contents stream(s) concatenated (decoded). May be empty. */
  originalContent: Uint8Array;
  /** Original /Resources dict raw bytes — copied verbatim into the new page. */
  originalResources: WriterValue | null;
  /** Original /MediaBox. */
  mediaBox: [number, number, number, number];
  /** Effective rotation (original + edits, 0/90/180/270). */
  rotation: number;
  /** Optional crop box in PDF user space. */
  cropBox?: [number, number, number, number];
  /** Annotation overlay drawing ops (uncompressed). */
  overlay: ContentStreamBuilder;
  /** Image XObjects to embed for this page. */
  images: { name: string; jpegBytes: Uint8Array; width: number; height: number }[];
  /** Font names used by the overlay (subset of Standard 14). */
  fonts: Set<string>;
}

const STD_14 = {
  Helvetica: 'Helvetica',
  HelveticaBold: 'Helvetica-Bold',
  HelveticaOblique: 'Helvetica-Oblique',
  TimesRoman: 'Times-Roman',
  TimesBold: 'Times-Bold',
  TimesItalic: 'Times-Italic',
  Courier: 'Courier',
  CourierBold: 'Courier-Bold',
} as const;

export interface BuilderMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

export class RmpgPdfBuilder {
  private pages: PageBuild[] = [];
  private metadata: BuilderMetadata = {};
  private parser: PdfObjectParser | null = null;
  private xref: Map<number, XrefEntry> | null = null;

  /** Load a source PDF. The page tree is parsed into an internal builder
   *  representation; subsequent page operations modify that representation. */
  static async load(source: Uint8Array): Promise<RmpgPdfBuilder> {
    const builder = new RmpgPdfBuilder();
    builder.parser = new PdfObjectParser(source);
    const startxref = builder.parser.findStartxref();
    const { entries, trailer } = builder.parser.parseXrefTable(startxref);
    builder.xref = entries;
    if (trailer.has('Encrypt')) {
      throw new Error('RmpgPdfBuilder: encrypted source PDFs must be decrypted server-side first');
    }
    const rootRef = trailer.get('Root');
    if (!rootRef || rootRef.kind !== 'ref') throw new Error('Source missing /Root');
    const catalog = builder.parser.resolve(entries, rootRef);
    if (catalog.kind !== 'dict') throw new Error('Catalog not a dictionary');
    const pagesRef = catalog.entries.get('Pages');
    if (!pagesRef) throw new Error('Catalog missing /Pages');
    await builder.collectPages(builder.parser.resolve(entries, pagesRef), {});
    return builder;
  }

  /** Number of pages currently in the builder. */
  get numPages(): number { return this.pages.length; }

  /** Set document metadata fields. */
  setMetadata(meta: BuilderMetadata): void {
    this.metadata = { ...this.metadata, ...meta };
  }

  /** Set page rotation (0/90/180/270). */
  setPageRotation(pageIdx: number, rotation: 0 | 90 | 180 | 270): void {
    const p = this.pages[pageIdx];
    if (!p) throw new Error(`Page ${pageIdx} out of range`);
    p.rotation = rotation;
  }

  /** Set page crop in PDF user-space (lower-left + upper-right). */
  setCropBox(pageIdx: number, x: number, y: number, w: number, h: number): void {
    const p = this.pages[pageIdx];
    if (!p) throw new Error(`Page ${pageIdx} out of range`);
    p.cropBox = [x, y, x + w, y + h];
  }

  /** Reorder pages — provide the new visual order as 0-based source page indices. */
  reorderPages(newOrder: number[]): void {
    const next: PageBuild[] = [];
    for (const idx of newOrder) {
      const p = this.pages[idx];
      if (!p) throw new Error(`reorderPages: source index ${idx} out of range`);
      next.push(p);
    }
    this.pages = next;
  }

  /** Drop a page entirely. */
  deletePage(pageIdx: number): void {
    if (pageIdx < 0 || pageIdx >= this.pages.length) throw new Error('deletePage: out of range');
    this.pages.splice(pageIdx, 1);
  }

  /** Append text + shape annotations to a page via the content-stream builder.
   *  The callback is called with a CSB that draws on top of the original page. */
  drawOnPage(pageIdx: number, fn: (csb: ContentStreamBuilder, useFont: (name: keyof typeof STD_14) => string) => void): void {
    const p = this.pages[pageIdx];
    if (!p) throw new Error(`drawOnPage: page ${pageIdx} out of range`);
    const useFont = (name: keyof typeof STD_14): string => {
      p.fonts.add(name);
      return name; // resource name in the page's /Font dict will mirror the key
    };
    fn(p.overlay, useFont);
  }

  /** Embed a JPEG image (data URL or raw bytes) and return the resource name
   *  to reference in subsequent drawImage calls. */
  embedJpeg(pageIdx: number, jpeg: Uint8Array, width: number, height: number): string {
    const p = this.pages[pageIdx];
    if (!p) throw new Error(`embedJpeg: page ${pageIdx} out of range`);
    const name = `Im${p.images.length}`;
    p.images.push({ name, jpegBytes: jpeg, width, height });
    return name;
  }

  /** Convert a PNG/JPEG data URL to JPEG bytes via canvas re-encoding.
   *  PDF supports JPEG natively (DCTDecode); PNG would require FlateDecode +
   *  raw RGBA which is several kilobytes more code. JPEG round-trip is
   *  acceptable for screenshots/signatures/QR codes used in annotations. */
  static async dataUrlToJpeg(dataUrl: string, quality = 0.92): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded: Promise<void> = new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Image decode failed'));
    });
    img.src = dataUrl;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    // White background so PNG transparent areas don't render black under JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', quality));
    const buf = new Uint8Array(await jpegBlob.arrayBuffer());
    return { bytes: buf, width: canvas.width, height: canvas.height };
  }

  /** Serialize the in-memory page tree to a fresh PDF byte stream. */
  async save(): Promise<Uint8Array> {
    const objects: { num: number; bytes: Uint8Array }[] = [];
    let nextObjNum = 1;
    const allocate = (): number => nextObjNum++;
    const writeObject = (num: number, body: WriterValue): void => {
      const parts: Uint8Array[] = [];
      parts.push(TE.encode(`${num} 0 obj\n`));
      serializeValue(body, parts);
      parts.push(TE.encode('\nendobj\n'));
      objects.push({ num, bytes: concat(parts) });
    };
    const writeStreamObject = (num: number, dict: WriterValue, body: Uint8Array): void => {
      const parts: Uint8Array[] = [];
      parts.push(TE.encode(`${num} 0 obj\n`));
      serializeValue(dict, parts);
      parts.push(TE.encode('\nstream\n'));
      parts.push(body);
      parts.push(TE.encode('\nendstream\nendobj\n'));
      objects.push({ num, bytes: concat(parts) });
    };

    // Pre-allocate Catalog + Pages so children can /Parent them.
    const catalogNum = allocate();
    const pagesNum = allocate();

    const pageObjNums: number[] = [];

    for (const p of this.pages) {
      // 1) Original /Contents stream (verbatim — already FlateDecode-encoded).
      let originalContentRef: WriterValue | null = null;
      if (p.originalContent.byteLength > 0) {
        const compressed = await flateEncode(p.originalContent);
        const num = allocate();
        writeStreamObject(num, DICT({
          Length: N(compressed.byteLength),
          Filter: NAME('FlateDecode'),
        }), compressed);
        originalContentRef = REF(num);
      }

      // 2) Annotation overlay stream — the editor's drawings.
      const overlayBytes = p.overlay.toBytes();
      let overlayRef: WriterValue | null = null;
      if (overlayBytes.byteLength > 0) {
        const compressed = await flateEncode(overlayBytes);
        const num = allocate();
        writeStreamObject(num, DICT({
          Length: N(compressed.byteLength),
          Filter: NAME('FlateDecode'),
        }), compressed);
        overlayRef = REF(num);
      }

      // 3) Embedded images for this page.
      const xobjects: Map<string, WriterValue> = new Map();
      for (const img of p.images) {
        const num = allocate();
        writeStreamObject(num, DICT({
          Type: NAME('XObject'),
          Subtype: NAME('Image'),
          Width: N(img.width),
          Height: N(img.height),
          ColorSpace: NAME('DeviceRGB'),
          BitsPerComponent: N(8),
          Filter: NAME('DCTDecode'),
          Length: N(img.jpegBytes.byteLength),
        }), img.jpegBytes);
        xobjects.set(img.name, REF(num));
      }

      // 4) Resources: keep originals where present + add fonts + xobjects.
      const fontDict = new Map<string, WriterValue>();
      // If the original page already has fonts, preserve them so original
      // /Contents continues to render. Then add Standard 14 entries used by
      // the overlay under their canonical resource names.
      if (p.originalResources && p.originalResources.kind === 'dict') {
        const f = p.originalResources.v.get('Font');
        if (f) fontDict.set('__inheritFont', { kind: 'raw', bytes: TE.encode('') });
      }
      for (const fontKey of p.fonts) {
        const baseFont = (STD_14 as Record<string, string>)[fontKey];
        if (!baseFont) continue;
        const num = allocate();
        writeObject(num, DICT({
          Type: NAME('Font'),
          Subtype: NAME('Type1'),
          BaseFont: NAME(baseFont),
          Encoding: NAME('WinAnsiEncoding'),
        }));
        fontDict.set(fontKey, REF(num));
      }
      // Build the resources dict, merging original + overlay.
      const resources = mergeResources(p.originalResources, fontDict, xobjects);

      // 5) Build the page dict.
      const contentsValue = buildContentsArray(originalContentRef, overlayRef);
      const pageNum = allocate();
      pageObjNums.push(pageNum);
      const pageDict: Record<string, WriterValue | undefined> = {
        Type: NAME('Page'),
        Parent: REF(pagesNum),
        MediaBox: ARR(N(p.mediaBox[0]), N(p.mediaBox[1]), N(p.mediaBox[2]), N(p.mediaBox[3])),
        Resources: resources,
      };
      if (contentsValue) pageDict.Contents = contentsValue;
      if (p.rotation) pageDict.Rotate = N(p.rotation);
      if (p.cropBox) pageDict.CropBox = ARR(N(p.cropBox[0]), N(p.cropBox[1]), N(p.cropBox[2]), N(p.cropBox[3]));
      writeObject(pageNum, DICT(pageDict));
    }

    // Pages root.
    writeObject(pagesNum, DICT({
      Type: NAME('Pages'),
      Kids: ARR(...pageObjNums.map(n => REF(n))),
      Count: N(pageObjNums.length),
    }));

    // Catalog.
    writeObject(catalogNum, DICT({
      Type: NAME('Catalog'),
      Pages: REF(pagesNum),
    }));

    // /Info dict for metadata.
    let infoNum: number | null = null;
    if (this.metadata.title || this.metadata.author || this.metadata.subject || this.metadata.keywords) {
      infoNum = allocate();
      writeObject(infoNum, DICT({
        Title: this.metadata.title ? unicodeString(this.metadata.title) : undefined,
        Author: this.metadata.author ? unicodeString(this.metadata.author) : undefined,
        Subject: this.metadata.subject ? unicodeString(this.metadata.subject) : undefined,
        Keywords: this.metadata.keywords ? unicodeString(this.metadata.keywords) : undefined,
        Producer: literalString('RMPG PDF Engine v1.0'),
        CreationDate: literalString(formatPdfDate(new Date())),
        ModDate: literalString(formatPdfDate(new Date())),
      }));
    }

    // 6) Assemble the final byte stream with header, objects, xref, trailer.
    const header = TE.encode('%PDF-1.7\n%\xff\xff\xff\xff\n');
    const objectsByNum = new Map<number, Uint8Array>();
    for (const o of objects) objectsByNum.set(o.num, o.bytes);

    let cursor = header.byteLength;
    const offsets = new Map<number, number>();
    const orderedParts: Uint8Array[] = [header];
    // Sort by object number for predictable output.
    const sortedNums = [...objectsByNum.keys()].sort((a, b) => a - b);
    for (const num of sortedNums) {
      const bytes = objectsByNum.get(num)!;
      offsets.set(num, cursor);
      orderedParts.push(bytes);
      cursor += bytes.byteLength;
    }

    // xref table.
    const xrefStart = cursor;
    const totalCount = nextObjNum; // includes object 0
    let xrefStr = `xref\n0 ${totalCount}\n0000000000 65535 f \n`;
    for (let i = 1; i < totalCount; i++) {
      const off = offsets.get(i);
      if (off === undefined) {
        xrefStr += `0000000000 00000 f \n`;
      } else {
        xrefStr += `${String(off).padStart(10, '0')} 00000 n \n`;
      }
    }
    orderedParts.push(TE.encode(xrefStr));

    // Trailer.
    const trailerDict: Record<string, WriterValue | undefined> = {
      Size: N(totalCount),
      Root: REF(catalogNum),
      Info: infoNum != null ? REF(infoNum) : undefined,
    };
    const trailerParts: Uint8Array[] = [];
    trailerParts.push(TE.encode('trailer\n'));
    serializeValue(DICT(trailerDict), trailerParts);
    trailerParts.push(TE.encode(`\nstartxref\n${xrefStart}\n%%EOF\n`));
    orderedParts.push(concat(trailerParts));

    return concat(orderedParts);
  }

  // ─── Internals ──────────────────────────────────────────────

  /** Walk the source /Pages tree and capture per-page state for rebuild. */
  private async collectPages(node: PdfValue, inherited: { mediaBox?: [number, number, number, number]; rotate?: number; resources?: PdfValue }): Promise<void> {
    if (!this.parser || !this.xref) throw new Error('Builder not initialized');
    if (node.kind !== 'dict') throw new Error('Page tree node not a dict');
    const type = node.entries.get('Type');
    const mediaBox = (node.entries.get('MediaBox') ?? inherited.mediaBox) as PdfValue | [number, number, number, number] | undefined;
    const resolvedMediaBox = mediaBox
      ? (Array.isArray(mediaBox) ? mediaBox : this.readBox(this.parser.resolve(this.xref, mediaBox)))
      : undefined;
    const rotateV = node.entries.get('Rotate');
    const rotation = rotateV && rotateV.kind === 'number' ? rotateV.value : (inherited.rotate ?? 0);
    const resources = node.entries.get('Resources') ?? inherited.resources;

    if (type && type.kind === 'name' && type.value === 'Pages') {
      const kids = node.entries.get('Kids');
      if (!kids) throw new Error('Pages node missing /Kids');
      const arr = this.parser.resolve(this.xref, kids);
      if (arr.kind !== 'array') throw new Error('/Kids not an array');
      for (const k of arr.items) {
        await this.collectPages(this.parser.resolve(this.xref, k), { mediaBox: resolvedMediaBox, rotate: rotation, resources });
      }
      return;
    }
    if (!type || type.kind !== 'name' || type.value !== 'Page') return;
    if (!resolvedMediaBox) throw new Error('Page missing /MediaBox');

    // Concatenate all original /Contents streams into a single decoded buffer.
    const contentsRef = node.entries.get('Contents');
    let originalContent = new Uint8Array(0);
    if (contentsRef) {
      const resolved = this.parser.resolve(this.xref, contentsRef);
      const streams: Uint8Array[] = [];
      if (resolved.kind === 'stream') streams.push(await decodeStream(resolved));
      else if (resolved.kind === 'array') {
        for (const it of resolved.items) {
          const s = this.parser.resolve(this.xref, it);
          if (s.kind === 'stream') streams.push(await decodeStream(s));
        }
      }
      let total = 0;
      for (const s of streams) total += s.byteLength;
      originalContent = new Uint8Array(total);
      let off = 0;
      for (const s of streams) {
        originalContent.set(s, off);
        off += s.byteLength;
        // PDF requires whitespace between concatenated content streams.
        if (off < total) { originalContent[off] = 0x0a; off += 1; }
      }
    }

    // Convert original /Resources to a writer value via raw passthrough — we
    // re-serialize it without modification for the output document.
    let originalResources: WriterValue | null = null;
    if (resources) {
      const r = this.parser.resolve(this.xref, resources);
      originalResources = pdfValueToWriter(r);
    }

    this.pages.push({
      originalContent,
      originalResources,
      mediaBox: resolvedMediaBox,
      rotation,
      overlay: new ContentStreamBuilder(),
      images: [],
      fonts: new Set(),
    });
  }

  private readBox(v: PdfValue): [number, number, number, number] {
    if (v.kind !== 'array' || v.items.length !== 4) throw new Error('Box not [llx lly urx ury]');
    const out: number[] = [];
    for (const it of v.items) {
      if (it.kind !== 'number') throw new Error('Box entry not a number');
      out.push(it.value);
    }
    return [out[0], out[1], out[2], out[3]];
  }
}

/** Convert a parser-side PdfValue to a writer-side WriterValue. */
function pdfValueToWriter(v: PdfValue): WriterValue {
  switch (v.kind) {
    case 'null': return NULL;
    case 'boolean': return BOOL(v.value);
    case 'number': return N(v.value);
    case 'name': return NAME(v.value);
    case 'string': return literalString(new TextDecoder('latin1').decode(v.bytes));
    case 'array': return ARR(...v.items.map(pdfValueToWriter));
    case 'dict': {
      const entries: Record<string, WriterValue> = {};
      for (const [k, val] of v.entries) entries[k] = pdfValueToWriter(val);
      return DICT(entries);
    }
    case 'stream':
      // We don't support inlining source streams as writer values — they're
      // handled separately via the per-page content concatenation. Encountering
      // one here means we hit an unexpected nested stream.
      throw new Error('Nested stream in resources is not supported');
    case 'ref':
      // A ref pointing to a resource sub-dict we haven't materialized; emit
      // the target dict resolved to a writer value. Caller should have already
      // resolved before reaching here.
      throw new Error('Unresolved /Resources ref reached the writer');
  }
}

/** Build the /Contents array entry for a page given optional original + overlay. */
function buildContentsArray(original: WriterValue | null, overlay: WriterValue | null): WriterValue | null {
  const items: WriterValue[] = [];
  if (original) items.push(original);
  if (overlay) items.push(overlay);
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return ARR(...items);
}

/** Merge original /Resources + the overlay's Font/XObject entries. */
function mergeResources(
  original: WriterValue | null,
  overlayFonts: Map<string, WriterValue>,
  overlayXobjects: Map<string, WriterValue>,
): WriterValue {
  const merged: Record<string, WriterValue> = {};
  if (original && original.kind === 'dict') {
    for (const [k, v] of original.v) merged[k] = v;
  }
  // Merge into a Font sub-dict.
  if (overlayFonts.size > 0) {
    const fontEntries: Record<string, WriterValue> = {};
    const existingFont = merged.Font;
    if (existingFont && existingFont.kind === 'dict') {
      for (const [k, v] of existingFont.v) fontEntries[k] = v;
    }
    for (const [k, v] of overlayFonts) {
      if (k === '__inheritFont') continue;
      fontEntries[k] = v;
    }
    merged.Font = DICT(fontEntries);
  }
  if (overlayXobjects.size > 0) {
    const xEntries: Record<string, WriterValue> = {};
    const existingX = merged.XObject;
    if (existingX && existingX.kind === 'dict') {
      for (const [k, v] of existingX.v) xEntries[k] = v;
    }
    for (const [k, v] of overlayXobjects) xEntries[k] = v;
    merged.XObject = DICT(xEntries);
  }
  // Standard PDF requires /ProcSet for PDF 1.4 readers; harmless for newer.
  if (!merged.ProcSet) merged.ProcSet = ARR(NAME('PDF'), NAME('Text'), NAME('ImageC'));
  return DICT(merged);
}

function formatPdfDate(d: Date): string {
  const z = (n: number, w = 2) => String(n).padStart(w, '0');
  return `D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z`;
}
