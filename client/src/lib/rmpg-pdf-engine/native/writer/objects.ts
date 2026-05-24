// Proprietary PDF object types + serializer.
//
// These are write-side types — distinct from the read-side PdfValue in
// parser.ts. The reader is permissive (accepts anything legal in the
// spec). The writer is strict and shapes-output we control.
//
// Output is byte-precise: every dict/array is emitted with single-space
// separators and newline-terminated streams, matching the format of
// Adobe Acrobat's saves so consumers (qpdf, browsers, archival tools)
// have nothing exotic to negotiate.

export type WriterValue =
  | { kind: 'null' }
  | { kind: 'bool'; v: boolean }
  | { kind: 'num'; v: number }
  | { kind: 'name'; v: string }
  | { kind: 'lit'; v: string }     // literal string ( ... ) — caller already escaped
  | { kind: 'hex'; v: Uint8Array } // hex string < ... >
  | { kind: 'array'; v: WriterValue[] }
  | { kind: 'dict'; v: Map<string, WriterValue> }
  | { kind: 'ref'; objNum: number }
  | { kind: 'raw'; bytes: Uint8Array }; // already-serialized bytes

const TE = new TextEncoder();

export const N = (v: number): WriterValue => ({ kind: 'num', v });
export const NAME = (v: string): WriterValue => ({ kind: 'name', v });
export const REF = (objNum: number): WriterValue => ({ kind: 'ref', objNum });
export const ARR = (...items: WriterValue[]): WriterValue => ({ kind: 'array', v: items });
export const DICT = (entries: Record<string, WriterValue | undefined>): WriterValue => {
  const m = new Map<string, WriterValue>();
  for (const k of Object.keys(entries)) {
    const v = entries[k];
    if (v !== undefined) m.set(k, v);
  }
  return { kind: 'dict', v: m };
};
export const NULL: WriterValue = { kind: 'null' };
export const BOOL = (v: boolean): WriterValue => ({ kind: 'bool', v });

/** Encode a literal-string body, escaping ( ) \ + non-printable bytes. */
export function literalString(s: string): WriterValue {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x28) out += '\\(';
    else if (c === 0x29) out += '\\)';
    else if (c === 0x5c) out += '\\\\';
    else if (c < 0x20 || c > 0x7e) out += '\\' + c.toString(8).padStart(3, '0');
    else out += s[i];
  }
  return { kind: 'lit', v: out };
}

/** Encode a Unicode string as UTF-16BE with BOM, hex-escaped — used for
 *  PDF metadata fields that need full Unicode (Title, Author, etc.). */
export function unicodeString(s: string): WriterValue {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xfe; out[1] = 0xff;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = (c >> 8) & 0xff;
    out[3 + i * 2] = c & 0xff;
  }
  return { kind: 'hex', v: out };
}

/** Serialize a single value to bytes (no trailing newline). */
export function serializeValue(v: WriterValue, parts: Uint8Array[]): void {
  switch (v.kind) {
    case 'null': parts.push(TE.encode('null')); return;
    case 'bool': parts.push(TE.encode(v.v ? 'true' : 'false')); return;
    case 'num': {
      // Avoid scientific notation; PDF requires plain decimal.
      const s = Number.isInteger(v.v) ? String(v.v) : v.v.toFixed(6).replace(/\.?0+$/, '');
      parts.push(TE.encode(s));
      return;
    }
    case 'name': {
      // Names use # encoding for non-printable / delimiter chars.
      let out = '/';
      for (let i = 0; i < v.v.length; i++) {
        const c = v.v.charCodeAt(i);
        if (c < 0x21 || c > 0x7e || '()<>[]{}/%#'.indexOf(v.v[i]) >= 0) {
          out += '#' + c.toString(16).padStart(2, '0');
        } else out += v.v[i];
      }
      parts.push(TE.encode(out));
      return;
    }
    case 'lit': parts.push(TE.encode('(' + v.v + ')')); return;
    case 'hex': {
      let h = '<';
      for (let i = 0; i < v.v.length; i++) h += v.v[i].toString(16).padStart(2, '0');
      h += '>';
      parts.push(TE.encode(h));
      return;
    }
    case 'array': {
      parts.push(TE.encode('['));
      for (let i = 0; i < v.v.length; i++) {
        if (i > 0) parts.push(TE.encode(' '));
        serializeValue(v.v[i], parts);
      }
      parts.push(TE.encode(']'));
      return;
    }
    case 'dict': {
      parts.push(TE.encode('<<\n'));
      for (const [k, val] of v.v) {
        parts.push(TE.encode('/' + k + ' '));
        serializeValue(val, parts);
        parts.push(TE.encode('\n'));
      }
      parts.push(TE.encode('>>'));
      return;
    }
    case 'ref': parts.push(TE.encode(`${v.objNum} 0 R`)); return;
    case 'raw': parts.push(v.bytes); return;
  }
}

/** Concatenate Uint8Array chunks. */
export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}
