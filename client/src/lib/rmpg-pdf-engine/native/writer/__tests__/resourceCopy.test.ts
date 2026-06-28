// @vitest-environment node
// flateEncode() uses Blob.stream()/CompressionStream, which jsdom does not
// implement; the node environment provides both (Node 18+).
import { describe, it, expect } from 'vitest';
import { RmpgPdfBuilder } from '../document';

const TE = new TextEncoder();

// Build a minimal but spec-valid PDF whose /Resources references a font via an
// INDIRECT reference (`/F1 5 0 R`). This is the exact shape that used to make
// the native writer throw "Unresolved /Resources ref reached the writer" and
// fall back to pdf-lib. The classic xref table is assembled with real byte
// offsets so the native parser can load it.
function buildSourcePdf(): Uint8Array {
  const objects: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 5 0 R>>/ProcSet[/PDF/Text]>>/Contents 4 0 R>>',
    // contents stream
    null as unknown as string, // placeholder, filled below
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ];
  const streamBody = 'BT /F1 12 Tf 20 100 Td (Hello World) Tj ET';
  objects[3] = `<</Length ${streamBody.length}>>\nstream\n${streamBody}\nendstream`;

  const header = '%PDF-1.7\n';
  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return TE.encode(body + xref + trailer);
}

describe('native writer — /Resources indirect-ref copy', () => {
  it('saves a PDF with an indirect font ref without falling back', async () => {
    const source = buildSourcePdf();
    const builder = await RmpgPdfBuilder.load(source);
    expect(builder.numPages).toBe(1);

    // Previously this threw "Unresolved /Resources ref reached the writer".
    const out = await builder.save();
    expect(out.byteLength).toBeGreaterThan(0);

    const text = new TextDecoder('latin1').decode(out);
    // Output is a real PDF...
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('%%EOF');
    // The referenced font object was copied into the output as an indirect
    // object (page dicts + copied font objects are serialized uncompressed; the
    // original /Contents stream itself is re-flated so its text won't appear).
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/Type /Font');
    // The page /Resources still references the font indirectly (not inlined).
    expect(text).toMatch(/\/Font <<\s*\/F1 \d+ 0 R/);
    // A page content stream is present (original re-emitted as a Flate stream).
    expect(text).toContain('/FlateDecode');
  });
});
