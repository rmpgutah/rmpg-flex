import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { htmlToDocxBlob } from '../docxExport';
import { DEFAULT_PAGE_SETUP } from '../types';
import type { PageSetup } from '../types';

async function unzipDocx(blob: Blob): Promise<Record<string, string>> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(buf);
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) out[name] = strFromU8(bytes);
  return out;
}

describe('htmlToDocxBlob', () => {
  it('produces a structurally valid OOXML package', async () => {
    const blob = htmlToDocxBlob('<p>Hello world</p>', DEFAULT_PAGE_SETUP, { title: 'T', author: 'A' });
    expect(blob.type).toContain('wordprocessingml.document');
    const parts = await unzipDocx(blob);
    // Required package parts for Word/Pages to open it.
    expect(parts['[Content_Types].xml']).toBeTruthy();
    expect(parts['_rels/.rels']).toContain('officeDocument');
    expect(parts['word/document.xml']).toContain('<w:document');
    expect(parts['word/styles.xml']).toContain('<w:styles');
    expect(parts['word/_rels/document.xml.rels']).toContain('styles.xml');
  });

  it('writes the text content into runs', async () => {
    const parts = await unzipDocx(htmlToDocxBlob('<p>Hello world</p>', DEFAULT_PAGE_SETUP));
    expect(parts['word/document.xml']).toContain('Hello world');
    expect(parts['word/document.xml']).toContain('<w:t');
  });

  it('maps headings to heading styles and bold/italic to run props', async () => {
    const html = '<h1>Title</h1><p><strong>bold</strong> and <em>italic</em></p>';
    const xml = (await unzipDocx(htmlToDocxBlob(html, DEFAULT_PAGE_SETUP)))['word/document.xml'];
    expect(xml).toContain('w:pStyle w:val="Heading1"');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('renders tables as w:tbl', async () => {
    const html = '<table><tr><th>H</th></tr><tr><td>C</td></tr></table>';
    const xml = (await unzipDocx(htmlToDocxBlob(html, DEFAULT_PAGE_SETUP)))['word/document.xml'];
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tc>');
  });

  it('carries page margins into sectPr as twips (px*15)', async () => {
    const page: PageSetup = {
      size: 'letter',
      orientation: 'portrait',
      margins: { top: 96, right: 48, bottom: 96, left: 144 }, // 1" / .5" / 1" / 1.5"
    };
    const xml = (await unzipDocx(htmlToDocxBlob('<p>x</p>', page)))['word/document.xml'];
    // 96px*15=1440, 48*15=720, 144*15=2160
    expect(xml).toContain('w:top="1440"');
    expect(xml).toContain('w:right="720"');
    expect(xml).toContain('w:left="2160"');
    // Letter portrait: 8.5x11in → 12240 x 15840 twips.
    expect(xml).toContain('w:w="12240"');
    expect(xml).toContain('w:h="15840"');
  });

  it('swaps page dimensions for landscape', async () => {
    const page: PageSetup = { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' };
    const xml = (await unzipDocx(htmlToDocxBlob('<p>x</p>', page)))['word/document.xml'];
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('w:w="15840"'); // width and height swapped
    expect(xml).toContain('w:h="12240"');
  });
});
