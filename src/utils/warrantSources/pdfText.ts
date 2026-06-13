import { extractText, getDocumentProxy } from 'unpdf';

/** Options for PDF text extraction. */
export interface PdfTextOptions {
  /** When true, preserve pdf.js row newlines (mergePages:false, pages joined by '\n').
   *  Use for table layouts whose rows can only be reconstructed from line breaks
   *  (e.g. all-caps TX-municipal lists where names and offenses are indistinguishable
   *  in the flat single-space stream). Default false → flat single-space text. */
  lines?: boolean;
}

/** Extract the full text layer of a PDF (Workers-compatible via unpdf's serverless pdf.js).
 *  Default: one flat string (mergePages:true). With `{ lines: true }`: row newlines are
 *  preserved (mergePages:false, pages joined by '\n'). Returns '' on any failure. */
export async function extractPdfText(buffer: ArrayBuffer, opts?: PdfTextOptions): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    if (opts?.lines) {
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = (Array.isArray(text) ? text : [text]) as unknown[];
      // A page with no text layer (scanned image) can come back null/undefined;
      // drop those so they don't coerce to literal "null"/"undefined" via join.
      return pages.filter((p): p is string => typeof p === 'string').join('\n');
    }
    const { text } = await extractText(pdf, { mergePages: true });
    // mergePages:true guarantees text is string per the overload, but guard defensively via unknown cast
    const t = text as unknown;
    return typeof t === 'string' ? t : (Array.isArray(t) ? (t as string[]).join('\n') : '');
  } catch {
    return '';
  }
}

/** Fetch a PDF URL (browser UA — some county CMS/CivicPlus 403 bots) and extract its text. */
export async function fetchPdfText(url: string, opts?: PdfTextOptions): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
    });
    if (!res.ok) return '';
    return await extractPdfText(await res.arrayBuffer(), opts);
  } catch {
    return '';
  }
}
