// Content-stream builder + FlateDecode compressor for the writer.
//
// The editor expresses annotations as high-level shapes (rectangles,
// lines, text). This module translates those to PDF content-stream
// operators that the proprietary reader (or any standards-compliant
// reader) can render. It mirrors the operator list the native reader
// already understands — same dialect for round-tripping.

const TE = new TextEncoder();

export class ContentStreamBuilder {
  private parts: string[] = [];

  /** Save the graphics state. */
  saveState(): this { this.parts.push('q'); return this; }
  /** Restore the graphics state. */
  restoreState(): this { this.parts.push('Q'); return this; }

  /** Set fill color in DeviceRGB (0..1 components). */
  setFillRgb(r: number, g: number, b: number): this {
    this.parts.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`); return this;
  }
  /** Set stroke color in DeviceRGB. */
  setStrokeRgb(r: number, g: number, b: number): this {
    this.parts.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`); return this;
  }
  /** Set line width. */
  setLineWidth(w: number): this { this.parts.push(`${fmt(w)} w`); return this; }
  /** Set fill opacity via an inline ExtGState — caller must provide a registered name. */
  setExtGState(name: string): this { this.parts.push(`/${name} gs`); return this; }

  /** Draw a rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number): this {
    this.parts.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
    return this;
  }
  /** Fill a rectangle. */
  fillRect(x: number, y: number, w: number, h: number): this {
    this.parts.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`);
    return this;
  }

  /** Draw a line from (x1,y1) to (x2,y2). */
  drawLine(x1: number, y1: number, x2: number, y2: number): this {
    this.parts.push(`${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`);
    return this;
  }

  /** Approximate an ellipse with four cubic bezier segments. */
  drawEllipse(cx: number, cy: number, rx: number, ry: number, fill: boolean): this {
    const k = 0.5522847498;
    const ox = rx * k;
    const oy = ry * k;
    this.parts.push([
      `${fmt(cx - rx)} ${fmt(cy)} m`,
      `${fmt(cx - rx)} ${fmt(cy + oy)} ${fmt(cx - ox)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)} c`,
      `${fmt(cx + ox)} ${fmt(cy + ry)} ${fmt(cx + rx)} ${fmt(cy + oy)} ${fmt(cx + rx)} ${fmt(cy)} c`,
      `${fmt(cx + rx)} ${fmt(cy - oy)} ${fmt(cx + ox)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)} c`,
      `${fmt(cx - ox)} ${fmt(cy - ry)} ${fmt(cx - rx)} ${fmt(cy - oy)} ${fmt(cx - rx)} ${fmt(cy)} c`,
      fill ? 'b' : 'S',
    ].join(' '));
    return this;
  }

  /** Render text at (x, y) using a previously-registered font resource name. */
  drawText(text: string, x: number, y: number, fontResName: string, size: number): this {
    this.parts.push([
      'BT',
      `/${fontResName} ${fmt(size)} Tf`,
      `${fmt(x)} ${fmt(y)} Td`,
      `(${escapeLit(text)}) Tj`,
      'ET',
    ].join(' '));
    return this;
  }

  /** Place an image XObject by registered name. */
  drawImage(name: string, x: number, y: number, w: number, h: number): this {
    this.parts.push([
      'q',
      `${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(y)} cm`,
      `/${name} Do`,
      'Q',
    ].join(' '));
    return this;
  }

  /** Free-form path move-to. */
  moveTo(x: number, y: number): this { this.parts.push(`${fmt(x)} ${fmt(y)} m`); return this; }
  lineTo(x: number, y: number): this { this.parts.push(`${fmt(x)} ${fmt(y)} l`); return this; }
  closeStroke(): this { this.parts.push('s'); return this; }
  stroke(): this { this.parts.push('S'); return this; }

  toBytes(): Uint8Array {
    return TE.encode(this.parts.join('\n') + '\n');
  }
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function escapeLit(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x28) out += '\\(';
    else if (c === 0x29) out += '\\)';
    else if (c === 0x5c) out += '\\\\';
    else if (c < 0x20 || c > 0x7e) out += '\\' + c.toString(8).padStart(3, '0');
    else out += s[i];
  }
  return out;
}

/** FlateDecode (deflate) compress a byte buffer using the platform API. */
export async function flateEncode(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}
