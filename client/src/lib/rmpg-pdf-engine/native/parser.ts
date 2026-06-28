// PDF object graph parser.
//
// Reads xref tables and resolves indirect references. Returns parsed
// PdfValue objects representing the document object graph.
//
// Intentional minimal subset. When we encounter:
//   - cross-reference streams (PDF 1.5+ /Type /XRef)
//   - encrypted documents (presence of /Encrypt entry in trailer)
//   - object streams (/Type /ObjStm)
// we throw BackendUnsupportedError so the dispatcher falls back to PDF.js.

import { BackendUnsupportedError } from '../types';
import { Lexer, Token } from './lexer';
import { flateDecode } from './decompress';

export type PdfValue =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'name'; value: string }
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'array'; items: PdfValue[] }
  | { kind: 'dict'; entries: Map<string, PdfValue> }
  | { kind: 'stream'; dict: Map<string, PdfValue>; raw: Uint8Array }
  | { kind: 'ref'; objNum: number; gen: number };

export interface XrefEntry { offset: number; gen: number; inUse: boolean; }

export class PdfObjectParser {
  constructor(public bytes: Uint8Array) {}

  findStartxref(): number {
    const tail = Math.max(0, this.bytes.length - 1024);
    const slice = this.bytes.subarray(tail);
    const text = new TextDecoder('latin1').decode(slice);
    const m = text.match(/startxref\s+(\d+)/);
    if (!m) throw new BackendUnsupportedError('Could not locate startxref');
    return parseInt(m[1], 10);
  }

  parseXrefTable(start: number): { entries: Map<number, XrefEntry>; trailer: Map<string, PdfValue> } {
    const lex = new Lexer(this.bytes);
    lex.pos = start;
    const first = lex.next();
    if (first.kind !== 'keyword' || first.value !== 'xref') {
      throw new BackendUnsupportedError('Cross-reference streams not yet supported by native backend');
    }

    const entries = new Map<number, XrefEntry>();
    while (true) {
      const t = lex.next();
      if (t.kind === 'keyword' && t.value === 'trailer') {
        const dict = this.readObject(lex);
        if (dict.kind !== 'dict') throw new BackendUnsupportedError('Trailer is not a dictionary');
        return { entries, trailer: dict.entries };
      }
      if (t.kind !== 'number') throw new BackendUnsupportedError(`Unexpected token in xref: ${t.kind}`);
      const firstObj = t.value;
      const count = lex.next();
      if (count.kind !== 'number') throw new BackendUnsupportedError('xref subsection missing count');
      while (lex.pos < this.bytes.length && (this.bytes[lex.pos] === 0x20 || this.bytes[lex.pos] === 0x0a || this.bytes[lex.pos] === 0x0d)) lex.pos++;
      for (let i = 0; i < count.value; i++) {
        const lineStart = lex.pos;
        const text = new TextDecoder('latin1').decode(this.bytes.subarray(lineStart, lineStart + 20));
        const m = /^(\d{10}) (\d{5}) (n|f)/.exec(text);
        if (!m) throw new BackendUnsupportedError('Malformed xref entry');
        entries.set(firstObj + i, { offset: parseInt(m[1], 10), gen: parseInt(m[2], 10), inUse: m[3] === 'n' });
        lex.pos += 20;
      }
    }
  }

  readObject(lex: Lexer): PdfValue {
    return this.fromToken(lex.next(), lex);
  }

  private fromToken(t: Token, lex: Lexer): PdfValue {
    switch (t.kind) {
      case 'number': {
        const saved = lex.pos;
        const a = lex.next();
        if (a.kind === 'number') {
          const b = lex.next();
          if (b.kind === 'keyword' && b.value === 'R') {
            return { kind: 'ref', objNum: t.value, gen: a.value };
          }
        }
        lex.pos = saved;
        return { kind: 'number', value: t.value };
      }
      case 'boolean': return { kind: 'boolean', value: t.value };
      case 'null': return { kind: 'null' };
      case 'name': return { kind: 'name', value: t.value };
      case 'string': return { kind: 'string', bytes: t.bytes };
      case 'arrayStart': {
        const items: PdfValue[] = [];
        while (true) {
          const next = lex.next();
          if (next.kind === 'arrayEnd') break;
          if (next.kind === 'eof') throw new BackendUnsupportedError('Unexpected EOF in array');
          items.push(this.fromToken(next, lex));
        }
        return { kind: 'array', items };
      }
      case 'dictStart': {
        const entries = new Map<string, PdfValue>();
        while (true) {
          const k = lex.next();
          if (k.kind === 'dictEnd') break;
          if (k.kind !== 'name') throw new BackendUnsupportedError(`Dict key not a name: ${k.kind}`);
          entries.set(k.value, this.readObject(lex));
        }
        const peek = lex.peek();
        if (peek.kind === 'keyword' && peek.value === 'stream') {
          lex.next();
          if (this.bytes[lex.pos] === 0x0d) lex.pos++;
          if (this.bytes[lex.pos] === 0x0a) lex.pos++;
          const lengthVal = entries.get('Length');
          if (!lengthVal || lengthVal.kind !== 'number') {
            throw new BackendUnsupportedError('Stream missing direct /Length');
          }
          const len = lengthVal.value;
          const raw = this.bytes.subarray(lex.pos, lex.pos + len);
          lex.pos += len;
          while (lex.pos < this.bytes.length && (this.bytes[lex.pos] === 0x0a || this.bytes[lex.pos] === 0x0d)) lex.pos++;
          const end = lex.next();
          if (end.kind !== 'keyword' || end.value !== 'endstream') {
            throw new BackendUnsupportedError('Stream missing endstream');
          }
          return { kind: 'stream', dict: entries, raw };
        }
        return { kind: 'dict', entries };
      }
      default:
        throw new BackendUnsupportedError(`Unexpected token kind: ${t.kind}`);
    }
  }

  readIndirect(xref: Map<number, XrefEntry>, objNum: number): PdfValue {
    const entry = xref.get(objNum);
    if (!entry || !entry.inUse) throw new BackendUnsupportedError(`Object ${objNum} not found in xref`);
    const lex = new Lexer(this.bytes);
    lex.pos = entry.offset;
    const num = lex.next();
    const gen = lex.next();
    const head = lex.next();
    if (num.kind !== 'number' || gen.kind !== 'number' || head.kind !== 'keyword' || head.value !== 'obj') {
      throw new BackendUnsupportedError(`Object ${objNum} header malformed`);
    }
    return this.readObject(lex);
  }

  resolve(xref: Map<number, XrefEntry>, value: PdfValue): PdfValue {
    if (value.kind === 'ref') return this.resolve(xref, this.readIndirect(xref, value.objNum));
    return value;
  }
}

export async function decodeStream(value: Extract<PdfValue, { kind: 'stream' }>): Promise<Uint8Array> {
  const filterVal = value.dict.get('Filter');
  if (!filterVal || filterVal.kind === 'null') return value.raw;
  const filters: string[] = [];
  if (filterVal.kind === 'name') filters.push(filterVal.value);
  else if (filterVal.kind === 'array') {
    for (const f of filterVal.items) if (f.kind === 'name') filters.push(f.value);
  } else {
    throw new BackendUnsupportedError(`Unexpected /Filter kind: ${filterVal.kind}`);
  }
  let bytes = value.raw;
  for (const f of filters) {
    if (f === 'FlateDecode' || f === 'Fl') bytes = await flateDecode(bytes);
    else throw new BackendUnsupportedError(`Stream filter not implemented in native: ${f}`);
  }
  return bytes;
}
