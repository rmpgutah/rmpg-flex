// Content-stream interpreter — walks PDF rendering operators and replays them
// onto an HTML canvas 2D context.
//
// The supported operator set (the subset we render natively):
//   Graphics state:  q  Q  cm  w
//   Path:            m  l  c  v  y  h  re
//   Painting:        S  s  f  F  f*  B  B*  b  b*  n
//   Color:           RG  rg  G  g
//   Text:            BT  ET  Tf  Tj  TJ  '  "  Td  TD  Tm  T*  Tc  Tw  Tz  TL  Tr  Ts
//
// Operators outside this list cause the page to fall back to PDF.js. That
// includes images (Do, BI/EI), patterns/shadings, transparency groups, and
// most font-encoding maths beyond Standard 14.

import { BackendUnsupportedError } from '../types';
import { Lexer } from './lexer';
import { decodeText } from './lexer';

interface Mat { a: number; b: number; c: number; d: number; e: number; f: number; }
const ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m1: Mat, m2: Mat): Mat {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

interface GState {
  ctm: Mat;
  lineWidth: number;
  strokeColor: [number, number, number];
  fillColor: [number, number, number];
  // Text state.
  fontSize: number;
  fontFamily: string;
  charSpacing: number;
  wordSpacing: number;
  horizScaling: number;     // %
  leading: number;
  textRise: number;
  // Text matrices set by BT/ET pair.
  tm: Mat;
  tlm: Mat;
}

function defaultState(): GState {
  return {
    ctm: { ...ID }, lineWidth: 1,
    strokeColor: [0, 0, 0], fillColor: [0, 0, 0],
    fontSize: 12, fontFamily: 'Helvetica',
    charSpacing: 0, wordSpacing: 0, horizScaling: 100,
    leading: 0, textRise: 0,
    tm: { ...ID }, tlm: { ...ID },
  };
}

interface RenderContext {
  ctx: CanvasRenderingContext2D;
  pageHeight: number;       // PDF user-space height
  scale: number;
  fontByResName: Map<string, { family: string; encoding: 'standard' | 'identity-h' }>;
}

/**
 * Read all operators from the content stream and dispatch them.
 * The lexer differentiates operands (numbers / names / strings / arrays) from
 * operators (keyword tokens). We accumulate operands until we see a keyword,
 * then pop them off as the operator's arguments.
 */
export async function renderContentStream(streamBytes: Uint8Array, rc: RenderContext): Promise<void> {
  const lex = new Lexer(streamBytes);
  const stack: GState[] = [defaultState()];
  const get = () => stack[stack.length - 1];
  const operands: any[] = [];

  // Convert PDF→canvas coords. PDF: origin bottom-left, canvas: origin top-left.
  // We bake the y-flip + scale into a single transform applied to the canvas
  // once. Then ctm just needs to be applied as a pre-transform per op.
  rc.ctx.save();
  rc.ctx.setTransform(rc.scale, 0, 0, -rc.scale, 0, rc.pageHeight * rc.scale);

  // Helper to set current transform = ctm.
  const applyCtm = () => {
    const m = get().ctm;
    rc.ctx.setTransform(rc.scale * m.a, rc.scale * m.b, -rc.scale * m.c, -rc.scale * m.d,
      rc.scale * m.e, rc.pageHeight * rc.scale - rc.scale * m.f);
  };

  while (true) {
    const t = lex.next();
    if (t.kind === 'eof') break;

    // Stack operands until we hit a keyword (operator).
    if (t.kind === 'number') { operands.push(t.value); continue; }
    if (t.kind === 'string') { operands.push(t.bytes); continue; }
    if (t.kind === 'name') { operands.push(t.value); continue; }
    if (t.kind === 'arrayStart') {
      const arr: any[] = [];
      while (true) {
        const e = lex.next();
        if (e.kind === 'arrayEnd') break;
        if (e.kind === 'number') arr.push(e.value);
        else if (e.kind === 'string') arr.push(e.bytes);
        else if (e.kind === 'eof') break;
      }
      operands.push(arr);
      continue;
    }
    if (t.kind !== 'keyword') continue;

    const op = t.value;
    const args = operands.splice(0);
    const s = get();

    switch (op) {
      case 'q':
        stack.push({ ...s, ctm: { ...s.ctm }, tm: { ...s.tm }, tlm: { ...s.tlm } });
        rc.ctx.save();
        break;
      case 'Q':
        stack.pop();
        rc.ctx.restore();
        break;
      case 'cm': {
        const [a, b, c, d, e, f] = args;
        s.ctm = mul({ a, b, c, d, e, f }, s.ctm);
        break;
      }
      case 'w': s.lineWidth = args[0]; break;
      case 'RG': s.strokeColor = [args[0], args[1], args[2]]; break;
      case 'rg': s.fillColor = [args[0], args[1], args[2]]; break;
      case 'G':  s.strokeColor = [args[0], args[0], args[0]]; break;
      case 'g':  s.fillColor = [args[0], args[0], args[0]]; break;

      // Path construction — collect into the canvas current path.
      case 'm': applyCtm(); rc.ctx.beginPath(); rc.ctx.moveTo(args[0], args[1]); break;
      case 'l': rc.ctx.lineTo(args[0], args[1]); break;
      case 'c': rc.ctx.bezierCurveTo(args[0], args[1], args[2], args[3], args[4], args[5]); break;
      case 'v': {
        // y0 control = current point; y1 control = args[0..1]; end = args[2..3]
        const cur = rc.ctx as any;
        rc.ctx.bezierCurveTo(cur._lastX ?? args[0], cur._lastY ?? args[1], args[0], args[1], args[2], args[3]);
        break;
      }
      case 'y':
        rc.ctx.bezierCurveTo(args[0], args[1], args[2], args[3], args[2], args[3]);
        break;
      case 'h': rc.ctx.closePath(); break;
      case 're':
        applyCtm();
        rc.ctx.beginPath();
        rc.ctx.rect(args[0], args[1], args[2], args[3]);
        break;

      // Path painting.
      case 'S': stroke(rc.ctx, s); break;
      case 's': rc.ctx.closePath(); stroke(rc.ctx, s); break;
      case 'f': case 'F': fill(rc.ctx, s, 'nonzero'); break;
      case 'f*': fill(rc.ctx, s, 'evenodd'); break;
      case 'B': fill(rc.ctx, s, 'nonzero'); stroke(rc.ctx, s); break;
      case 'B*': fill(rc.ctx, s, 'evenodd'); stroke(rc.ctx, s); break;
      case 'b': rc.ctx.closePath(); fill(rc.ctx, s, 'nonzero'); stroke(rc.ctx, s); break;
      case 'b*': rc.ctx.closePath(); fill(rc.ctx, s, 'evenodd'); stroke(rc.ctx, s); break;
      case 'n': rc.ctx.beginPath(); break;

      // Text ops.
      case 'BT': s.tm = { ...ID }; s.tlm = { ...ID }; break;
      case 'ET': break;
      case 'Tf': {
        const name = args[0] as string;
        s.fontSize = args[1];
        const meta = rc.fontByResName.get(name);
        if (!meta) throw new BackendUnsupportedError(`Font /${name} not found in page resources`);
        s.fontFamily = meta.family;
        break;
      }
      case 'Tc': s.charSpacing = args[0]; break;
      case 'Tw': s.wordSpacing = args[0]; break;
      case 'Tz': s.horizScaling = args[0]; break;
      case 'TL': s.leading = args[0]; break;
      case 'Tr': /* render mode — ignored */ break;
      case 'Ts': s.textRise = args[0]; break;
      case 'Td': {
        const [tx, ty] = args;
        s.tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, s.tlm);
        s.tm = { ...s.tlm };
        break;
      }
      case 'TD': {
        const [tx, ty] = args;
        s.leading = -ty;
        s.tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }, s.tlm);
        s.tm = { ...s.tlm };
        break;
      }
      case 'Tm': {
        const [a, b, c, d, e, f] = args;
        s.tm = { a, b, c, d, e, f };
        s.tlm = { a, b, c, d, e, f };
        break;
      }
      case 'T*': {
        s.tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -s.leading }, s.tlm);
        s.tm = { ...s.tlm };
        break;
      }
      case 'Tj': drawText(rc, s, decodeText(args[0])); break;
      case "'":
        s.tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -s.leading }, s.tlm);
        s.tm = { ...s.tlm };
        drawText(rc, s, decodeText(args[0]));
        break;
      case '"':
        s.wordSpacing = args[0]; s.charSpacing = args[1];
        s.tlm = mul({ a: 1, b: 0, c: 0, d: 1, e: 0, f: -s.leading }, s.tlm);
        s.tm = { ...s.tlm };
        drawText(rc, s, decodeText(args[2]));
        break;
      case 'TJ': {
        for (const part of args[0] as any[]) {
          if (typeof part === 'number') {
            // Negative number = leftward shift in glyph space (1/1000 of font size).
            const dx = -part / 1000 * s.fontSize * (s.horizScaling / 100);
            s.tm = mul({ a: 1, b: 0, c: 0, d: 1, e: dx, f: 0 }, s.tm);
          } else if (part instanceof Uint8Array) {
            drawText(rc, s, decodeText(part));
          }
        }
        break;
      }

      // Anything we don't recognize forces fallback.
      default:
        if (KNOWN_NOOPS.has(op)) break;
        throw new BackendUnsupportedError(`Operator not implemented in native renderer: ${op}`);
    }
  }

  rc.ctx.restore();
}

const KNOWN_NOOPS = new Set([
  'CS', 'cs', 'SC', 'SCN', 'sc', 'scn', // color space + extended fill — we map all colors via RG/rg
  'gs',                                  // ExtGState — opacity etc; ignore for now
  'M', 'd', 'i', 'J', 'j', 'ri',        // line caps/joins/dash etc — ignore for now
  'EX', 'BX',                            // compatibility blocks
]);

/** Operators that we *cannot* render meaningfully today — their presence in
 *  a content stream means we must fall back to PDF.js. The pre-flight scan
 *  in NativeBackend.open() looks for these and throws BackendUnsupportedError
 *  so the dispatcher hands the document to PDF.js cleanly, instead of the
 *  renderer silently producing a blank page mid-stream. */
const FORCE_FALLBACK_OPS = new Set([
  'Do',                  // XObject placement (images + form XObjects)
  'BI', 'ID', 'EI',      // inline image markers
  'BMC', 'BDC', 'EMC',   // marked-content blocks
  'MP', 'DP',            // marked-content single-points
  'sh',                  // shading pattern paint
]);

const ALL_KNOWN_OPS = new Set([
  ...KNOWN_NOOPS,
  // Graphics state + transforms
  'q', 'Q', 'cm', 'w',
  // Colors
  'RG', 'rg', 'G', 'g',
  // Path construction
  'm', 'l', 'c', 'v', 'y', 'h', 're',
  // Path painting
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n',
  // Text
  'BT', 'ET', 'Tf', 'Tc', 'Tw', 'Tz', 'TL', 'Tr', 'Ts',
  'Td', 'TD', 'Tm', 'T*', 'Tj', 'TJ', "'", '"',
]);

/** Pre-flight scan: walk every operator token in a content stream and verify
 *  we know how to handle it. Returns the first operator that would force a
 *  fallback (or null if every operator is supported). Cheap — just a lex
 *  pass, no rendering math, no canvas allocation. */
export function findUnsupportedOperator(streamBytes: Uint8Array): string | null {
  const lex = new Lexer(streamBytes);
  while (true) {
    const t = lex.next();
    if (t.kind === 'eof') return null;
    if (t.kind !== 'keyword') continue;
    if (FORCE_FALLBACK_OPS.has(t.value)) return t.value;
    if (!ALL_KNOWN_OPS.has(t.value)) return t.value;
  }
}

function stroke(ctx: CanvasRenderingContext2D, s: GState) {
  ctx.strokeStyle = `rgb(${s.strokeColor.map(c => Math.round(c * 255)).join(',')})`;
  ctx.lineWidth = s.lineWidth;
  ctx.stroke();
}

function fill(ctx: CanvasRenderingContext2D, s: GState, rule: CanvasFillRule) {
  ctx.fillStyle = `rgb(${s.fillColor.map(c => Math.round(c * 255)).join(',')})`;
  ctx.fill(rule);
}

function drawText(rc: RenderContext, s: GState, text: string): void {
  if (!text) return;
  // Build the canvas transform from CTM × Tm.
  const m = mul(s.tm, s.ctm);
  const fontSize = s.fontSize;
  rc.ctx.save();
  rc.ctx.setTransform(rc.scale * m.a, rc.scale * m.b, -rc.scale * m.c, -rc.scale * m.d,
    rc.scale * m.e, rc.pageHeight * rc.scale - rc.scale * m.f);
  // Flip y so the glyph is upright (PDF text matrix already accounts for it,
  // but our outer transform is inverted).
  rc.ctx.scale(1, -1);
  rc.ctx.font = `${fontSize}px ${s.fontFamily}, sans-serif`;
  rc.ctx.fillStyle = `rgb(${s.fillColor.map(c => Math.round(c * 255)).join(',')})`;
  rc.ctx.fillText(text, 0, 0);
  // Advance text matrix by the rendered string's width (approximation: use
  // canvas measureText since we don't have full font metrics).
  const metrics = rc.ctx.measureText(text);
  rc.ctx.restore();
  s.tm = mul({ a: 1, b: 0, c: 0, d: 1, e: metrics.width + s.charSpacing * text.length, f: 0 }, s.tm);
}
