// PDF lexer — splits a byte buffer into PDF tokens.
//
// Tokens we recognize:
//   number / boolean / null / name (/Foo) / string ((...) and <...>)
//   array start/end ([ ]) / dict start/end (<< >>)
//   keyword (operators like Tj, BT, ET, q, Q, ...)
//   stream / endstream / obj / endobj / R / xref / trailer / startxref
//
// Bytes vs strings: PDF is fundamentally byte-oriented (string contents may
// contain arbitrary bytes). Names and keywords are ASCII; strings are read
// as raw bytes and exposed both as Uint8Array and as a UTF-8-best-effort
// string via decodeText().

export type Token =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'name'; value: string }
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'arrayStart' } | { kind: 'arrayEnd' }
  | { kind: 'dictStart' } | { kind: 'dictEnd' }
  | { kind: 'keyword'; value: string }
  | { kind: 'streamData'; bytes: Uint8Array }
  | { kind: 'eof' };

const SP = 0x20, LF = 0x0a, CR = 0x0d, TAB = 0x09, FF = 0x0c, NUL = 0x00;
const isWS = (b: number) => b === SP || b === LF || b === CR || b === TAB || b === FF || b === NUL;
const isDelim = (b: number) =>
  b === 0x28 || b === 0x29 || b === 0x3c || b === 0x3e ||
  b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d ||
  b === 0x2f || b === 0x25;
const isDigit = (b: number) => b >= 0x30 && b <= 0x39;

export class Lexer {
  pos = 0;
  constructor(public bytes: Uint8Array) {}

  /** Skip whitespace + line comments. */
  private skipTrivia(): void {
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos];
      if (isWS(b)) { this.pos++; continue; }
      if (b === 0x25) { // % comment
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== LF && this.bytes[this.pos] !== CR) this.pos++;
        continue;
      }
      break;
    }
  }

  /** Read a literal string (...) honoring nested parens + escapes. */
  private readLiteralString(): Uint8Array {
    this.pos++; // skip '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length && depth > 0) {
      const b = this.bytes[this.pos++];
      if (b === 0x28) { depth++; out.push(b); continue; }
      if (b === 0x29) { depth--; if (depth > 0) out.push(b); continue; }
      if (b === 0x5c) { // \
        const esc = this.bytes[this.pos++];
        switch (esc) {
          case 0x6e: out.push(0x0a); break; // \n
          case 0x72: out.push(0x0d); break; // \r
          case 0x74: out.push(0x09); break; // \t
          case 0x62: out.push(0x08); break; // \b
          case 0x66: out.push(0x0c); break; // \f
          case 0x28: out.push(0x28); break;
          case 0x29: out.push(0x29); break;
          case 0x5c: out.push(0x5c); break;
          case LF: break; // line continuation
          case CR: if (this.bytes[this.pos] === LF) this.pos++; break;
          default:
            if (esc >= 0x30 && esc <= 0x37) {
              // Octal escape, up to 3 digits.
              let v = esc - 0x30;
              for (let i = 0; i < 2; i++) {
                const n = this.bytes[this.pos];
                if (n >= 0x30 && n <= 0x37) { v = v * 8 + (n - 0x30); this.pos++; } else break;
              }
              out.push(v & 0xff);
            } else {
              out.push(esc);
            }
        }
        continue;
      }
      out.push(b);
    }
    return new Uint8Array(out);
  }

  /** Read a hex string <...>. */
  private readHexString(): Uint8Array {
    this.pos++; // skip '<'
    const out: number[] = [];
    let nibble = -1;
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos++];
      if (b === 0x3e) { // >
        if (nibble >= 0) out.push(nibble << 4);
        return new Uint8Array(out);
      }
      if (isWS(b)) continue;
      const v = hexVal(b);
      if (v < 0) continue;
      if (nibble < 0) nibble = v;
      else { out.push((nibble << 4) | v); nibble = -1; }
    }
    return new Uint8Array(out);
  }

  /** Read a name token /Foo. */
  private readName(): string {
    this.pos++; // skip '/'
    const start = this.pos;
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos];
      if (isWS(b) || isDelim(b)) break;
      this.pos++;
    }
    let s = new TextDecoder('utf-8', { fatal: false }).decode(this.bytes.subarray(start, this.pos));
    // Decode hex escapes #XX.
    s = s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return s;
  }

  /** Read the next non-trivia token. */
  next(): Token {
    this.skipTrivia();
    if (this.pos >= this.bytes.length) return { kind: 'eof' };

    const b = this.bytes[this.pos];

    // Dict markers <<  >>
    if (b === 0x3c && this.bytes[this.pos + 1] === 0x3c) { this.pos += 2; return { kind: 'dictStart' }; }
    if (b === 0x3e && this.bytes[this.pos + 1] === 0x3e) { this.pos += 2; return { kind: 'dictEnd' }; }

    // Array markers
    if (b === 0x5b) { this.pos++; return { kind: 'arrayStart' }; }
    if (b === 0x5d) { this.pos++; return { kind: 'arrayEnd' }; }

    // Strings
    if (b === 0x28) return { kind: 'string', bytes: this.readLiteralString() };
    if (b === 0x3c) return { kind: 'string', bytes: this.readHexString() };

    // Names
    if (b === 0x2f) return { kind: 'name', value: this.readName() };

    // Numbers (with optional sign / decimal)
    if (b === 0x2d || b === 0x2b || b === 0x2e || isDigit(b)) {
      const start = this.pos;
      if (b === 0x2d || b === 0x2b) this.pos++;
      while (this.pos < this.bytes.length) {
        const c = this.bytes[this.pos];
        if (!isDigit(c) && c !== 0x2e) break;
        this.pos++;
      }
      const text = new TextDecoder('ascii').decode(this.bytes.subarray(start, this.pos));
      const n = parseFloat(text);
      if (!Number.isNaN(n)) return { kind: 'number', value: n };
      // fall through to keyword if it's not a number
      this.pos = start;
    }

    // Keyword (true / false / null / obj / endobj / Tf / etc.)
    const start = this.pos;
    while (this.pos < this.bytes.length) {
      const c = this.bytes[this.pos];
      if (isWS(c) || isDelim(c)) break;
      this.pos++;
    }
    const word = new TextDecoder('ascii').decode(this.bytes.subarray(start, this.pos));
    if (word === 'true') return { kind: 'boolean', value: true };
    if (word === 'false') return { kind: 'boolean', value: false };
    if (word === 'null') return { kind: 'null' };
    return { kind: 'keyword', value: word };
  }

  /** Peek the next token without advancing. */
  peek(): Token {
    const saved = this.pos;
    const t = this.next();
    this.pos = saved;
    return t;
  }
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  return -1;
}

/** Decode a PDF byte string to JS string (best-effort UTF-8 / PDFDocEncoding). */
export function decodeText(bytes: Uint8Array): string {
  // UTF-16BE BOM signals Unicode string.
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const out: number[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out.push((bytes[i] << 8) | bytes[i + 1]);
    }
    return String.fromCharCode(...out);
  }
  // Otherwise, assume PDFDocEncoding which is mostly Latin-1 for ASCII.
  return new TextDecoder('latin1').decode(bytes);
}
