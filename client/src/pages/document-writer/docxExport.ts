// Real .docx (Office Open XML / WordprocessingML) exporter for the Document
// Writer. Produces a genuine, fully-editable word-processing document that
// opens natively in Microsoft Word, Apple Pages, Google Docs, and LibreOffice
// — NOT an HTML file with a .doc extension (those are Word-only and Pages
// chokes on them). The previous "save" path uploaded raw editor HTML, which is
// not a writable office document; this is the replacement.
//
// The converter walks the editor's serialized HTML (the same string used for
// print/PDF) and emits paragraphs, runs, headings, lists, blockquotes, and
// tables with bold/italic/underline/strike formatting. Page size + margins from
// the document's PageSetup are written into the section properties (<w:sectPr>)
// so the .docx opens with the chosen geometry — this is what makes the margin
// presets (narrow/standard/legal/formal/custom) carry through to Word/Pages.
//
// Zipping uses fflate (already in the bundle via jspdf); no network, no new
// heavyweight dependency. Fidelity is intentionally pragmatic: it covers the
// formatting RMPG reports actually use. Unknown nodes degrade to plain text so
// content is never lost.

import { zipSync, strToU8 } from 'fflate';
import type { PageSetup } from './types';
import { PAGE_SIZES } from './types';

// CSS px at 96dpi → twips (1/1440 inch). 96px = 1in = 1440 twips ⇒ ×15.
const PX_TO_TWIP = 15;

// Encode a string to bytes in the *running realm's* Uint8Array. fflate decides
// file-vs-folder via `instanceof Uint8Array` against the global it captured at
// load; re-wrapping strToU8's output guarantees the realms match (a no-op cost
// in the browser, and it keeps the export working under jsdom in tests).
const u8 = (s: string): Uint8Array => Uint8Array.from(strToU8(s));

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

/** Emit a single <w:r> run for a span of text under the given formatting. */
function runXml(text: string, fmt: RunFmt): string {
  if (!text) return '';
  const props: string[] = [];
  if (fmt.bold) props.push('<w:b/>');
  if (fmt.italic) props.push('<w:i/>');
  if (fmt.underline) props.push('<w:u w:val="single"/>');
  if (fmt.strike) props.push('<w:strike/>');
  if (fmt.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // xml:space="preserve" keeps leading/trailing spaces between runs intact.
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

/** Collect the inline runs (with formatting) inside a block-level element. */
function inlineRuns(node: Node, fmt: RunFmt): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return runXml((node.textContent || '').replace(/\s+/g, ' '), fmt);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const next = { ...fmt };
  switch (el.tagName) {
    case 'STRONG': case 'B': next.bold = true; break;
    case 'EM': case 'I': next.italic = true; break;
    case 'U': next.underline = true; break;
    case 'S': case 'STRIKE': case 'DEL': next.strike = true; break;
    case 'CODE': next.code = true; break;
    case 'BR': return '<w:r><w:br/></w:r>';
  }
  return Array.from(el.childNodes).map((c) => inlineRuns(c, next)).join('');
}

/** Paragraph properties for a given style id (and optional list indent). */
function pPr(styleId?: string, indentTwips?: number): string {
  const parts: string[] = [];
  if (styleId) parts.push(`<w:pStyle w:val="${styleId}"/>`);
  if (indentTwips) parts.push(`<w:ind w:left="${indentTwips}"/>`);
  return parts.length ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
}

function paragraph(runs: string, styleId?: string, indentTwips?: number): string {
  return `<w:p>${pPr(styleId, indentTwips)}${runs}</w:p>`;
}

const HEADING_STYLES: Record<string, string> = {
  H1: 'Heading1', H2: 'Heading2', H3: 'Heading3',
  H4: 'Heading4', H5: 'Heading5', H6: 'Heading6',
};

/** Convert a table element to a <w:tbl>. One nesting level; cells hold text. */
function tableXml(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  const trXml = rows.map((tr) => {
    const cells = Array.from(tr.children).filter(
      (c) => c.tagName === 'TD' || c.tagName === 'TH',
    ) as HTMLElement[];
    const tcXml = cells.map((cell) => {
      const isHeader = cell.tagName === 'TH';
      const runs = Array.from(cell.childNodes)
        .map((c) => inlineRuns(c, { bold: isHeader })).join('') || runXml('', {});
      return `<w:tc><w:tcPr><w:tcBorders>` +
        `<w:top w:val="single" w:sz="4" w:color="333333"/>` +
        `<w:left w:val="single" w:sz="4" w:color="333333"/>` +
        `<w:bottom w:val="single" w:sz="4" w:color="333333"/>` +
        `<w:right w:val="single" w:sz="4" w:color="333333"/>` +
        `</w:tcBorders></w:tcPr>${paragraph(runs)}</w:tc>`;
    }).join('');
    return `<w:tr>${tcXml}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:color="333333"/>` +
    `<w:left w:val="single" w:sz="4" w:color="333333"/>` +
    `<w:bottom w:val="single" w:sz="4" w:color="333333"/>` +
    `<w:right w:val="single" w:sz="4" w:color="333333"/>` +
    `<w:insideH w:val="single" w:sz="4" w:color="333333"/>` +
    `<w:insideV w:val="single" w:sz="4" w:color="333333"/>` +
    `</w:tblBorders></w:tblPr>${trXml}</w:tbl>`;
}

/** Walk a block-level node into one or more paragraphs / tables. */
function blockXml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || '').trim();
    return t ? paragraph(runXml(t, {})) : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName;

  if (HEADING_STYLES[tag]) {
    return paragraph(inlineRuns(el, {}), HEADING_STYLES[tag]);
  }
  switch (tag) {
    case 'P':
    case 'DIV':
      return paragraph(inlineRuns(el, {}));
    case 'BLOCKQUOTE':
      return paragraph(inlineRuns(el, { italic: true }), undefined, 720);
    case 'PRE':
      return paragraph(runXml(el.textContent || '', { code: true }));
    case 'HR':
      // A thin bottom border on an empty paragraph reads as a horizontal rule.
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>`;
    case 'UL':
    case 'OL': {
      const ordered = tag === 'OL';
      return Array.from(el.children)
        .filter((li) => li.tagName === 'LI')
        .map((li, i) => {
          const prefix = ordered ? `${i + 1}. ` : '•  ';
          const runs = runXml(prefix, {}) + inlineRuns(li, {});
          return paragraph(runs, 'ListParagraph', 720);
        }).join('');
    }
    case 'TABLE':
      return tableXml(el);
    default:
      // Container with block children → recurse; otherwise treat as a paragraph.
      if (Array.from(el.childNodes).some((c) => c.nodeType === Node.ELEMENT_NODE &&
        /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR)$/.test((c as HTMLElement).tagName))) {
        return Array.from(el.childNodes).map(blockXml).join('');
      }
      return paragraph(inlineRuns(el, {}));
  }
}

/** Section properties: page size + margins from the document's PageSetup. */
function sectPrXml(page: PageSetup): string {
  const dim = PAGE_SIZES[page.size];
  const landscape = page.orientation === 'landscape';
  const wTwip = Math.round((landscape ? dim.height : dim.width) * PX_TO_TWIP);
  const hTwip = Math.round((landscape ? dim.width : dim.height) * PX_TO_TWIP);
  const m = page.margins;
  const orientAttr = landscape ? ' w:orient="landscape"' : '';
  return `<w:sectPr>` +
    `<w:pgSz w:w="${wTwip}" w:h="${hTwip}"${orientAttr}/>` +
    `<w:pgMar w:top="${Math.round(m.top * PX_TO_TWIP)}" ` +
    `w:right="${Math.round(m.right * PX_TO_TWIP)}" ` +
    `w:bottom="${Math.round(m.bottom * PX_TO_TWIP)}" ` +
    `w:left="${Math.round(m.left * PX_TO_TWIP)}" ` +
    `w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>`;
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  [1, 2, 3, 4, 5, 6].map((n) => {
    const sz = [36, 30, 26, 24, 22, 22][n - 1];
    return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>` +
      `<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  }).join('') +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>` +
  `<w:basedOn w:val="Normal"/></w:style>` +
  `</w:styles>`;

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `</Relationships>`;

const DOC_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

function corePropsXml(title: string, author: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${xmlEscape(title)}</dc:title>` +
    `<dc:creator>${xmlEscape(author || 'RMPG Flex')}</dc:creator>` +
    `</cp:coreProperties>`;
}

/**
 * Convert editor HTML + page geometry into a .docx file (Blob). The returned
 * Blob is a valid Office Open XML package — writable in Word, Pages, Google
 * Docs, and LibreOffice.
 */
export function htmlToDocxBlob(
  html: string,
  page: PageSetup,
  meta: { title?: string; author?: string } = {},
): Blob {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const content = Array.from(body.childNodes).map(blockXml).join('') || paragraph(runXml('', {}));

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${content}${sectPrXml(page)}</w:body></w:document>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': u8(CONTENT_TYPES_XML),
    '_rels/.rels': u8(ROOT_RELS_XML),
    'docProps/core.xml': u8(corePropsXml(meta.title || 'Document', meta.author || '')),
    'word/document.xml': u8(documentXml),
    'word/styles.xml': u8(STYLES_XML),
    'word/_rels/document.xml.rels': u8(DOC_RELS_XML),
  };

  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is concrete
  // (fflate's Uint8Array may be SharedArrayBuffer-backed under TS's lib types).
  const bytes = new Uint8Array(zipped.length);
  bytes.set(zipped);
  return new Blob([bytes.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
