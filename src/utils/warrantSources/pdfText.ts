import { extractText, getDocumentProxy } from 'unpdf';

/** Extract the full text layer of a PDF (Workers-compatible via unpdf's serverless pdf.js).
 *  Returns one string with page texts joined; '' on any failure. */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    // mergePages:true guarantees text is string per the overload, but guard defensively via unknown cast
    const t = text as unknown;
    return typeof t === 'string' ? t : (Array.isArray(t) ? (t as string[]).join('\n') : '');
  } catch {
    return '';
  }
}

/** Fetch a PDF URL (browser UA — some county CMS/CivicPlus 403 bots) and extract its text. */
export async function fetchPdfText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
    });
    if (!res.ok) return '';
    return await extractPdfText(await res.arrayBuffer());
  } catch {
    return '';
  }
}
