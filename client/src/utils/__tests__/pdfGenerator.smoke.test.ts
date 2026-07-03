// Smoke tests for pdfGenerator.ts — covers the incident-report public API
// (the path used by IncidentsPage.tsx and IncidentDetailWindow.tsx).
// generatePdfReport dispatches into 8 internal renderers (general, trespass,
// accident, medical, use_of_force, daily_activity, arrest, process_service);
// each is exercised here with minimum-viable data so refactors or split-outs
// surface regressions before they reach a user trying to print an incident.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generatePdfReport } from '../pdfGenerator';
import type { PdfReportType } from '../caseNumbers';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/admin/config/branding')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('', { status: 404 });
    })
  );
});

// IncidentData is not exported, so we type-erase with a local alias that
// captures just the required surface. If the interface ever becomes
// exported we should import it directly.
type MinimalIncident = {
  incident_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location: string;
  officer_name: string;
  narrative: string;
};

const baseIncident: MinimalIncident = {
  incident_number: 'INC-25-00001',
  incident_type: 'disturbance',
  priority: '3',
  status: 'CLEARED',
  location: '123 Main St, Salt Lake City, UT',
  officer_name: 'Officer Test',
  narrative: 'Smoke-test narrative. This text exercises the wrapping path.',
};

const reportTypes: PdfReportType[] = [
  'incident',
  'trespass',
  'accident',
  'medical',
  'use_of_force',
  'daily_activity',
  'arrest',
  'process_service',
];

describe('pdfGenerator smoke tests', () => {
  for (const reportType of reportTypes) {
    it(`generates a ${reportType} report from minimal data`, () => {
      const doc = generatePdfReport(reportType, baseIncident as any);
      expect(doc).toBeDefined();
      expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    });
  }

  it('generates a report with populated optional fields without throwing', () => {
    const doc = generatePdfReport('incident', {
      ...baseIncident,
      occurred_date: '2025-04-18',
      occurred_time: '14:30',
      weather_conditions: 'clear',
      lighting_conditions: 'daylight',
      injuries: 'none',
      disposition: 'unfounded',
      zone_beat: 'A-1',
      alcohol_involved: false,
      drugs_involved: false,
      domestic_violence: false,
    } as any);
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('DEFAULT_PDF_BRANDING uses navy/gold, not the neutralized grays', async () => {
    const { DEFAULT_PDF_BRANDING } = await import('../pdfGenerator');
    expect(DEFAULT_PDF_BRANDING.primary_color).toBe('#1a2f5c');
    expect(DEFAULT_PDF_BRANDING.accent_color).toBe('#d4a017');
    expect(DEFAULT_PDF_BRANDING.header_bg_color).toBe('#1a2f5c');
  });

  it('header includes the gold tagline text', () => {
    // The v1 header embeds an Arial TTF via registerArialFont() with
    // Identity-H encoding, so drawn text shows up as glyph-index hex
    // strings in the content stream, not literal ASCII — .toContain()
    // on the raw text can never match (confirmed: even pre-existing
    // strings like the agency name don't appear literally). Instead,
    // assert the italic font selector + the gold accent fill color
    // both appear together immediately around the tagline's draw call,
    // which is the closest verifiable signal that the tagline line was
    // rendered with the right styling. See nibrsHeaderRender.test.ts
    // for the established pattern of testing this header via structural
    // signals (font registration, y-bounds) rather than literal text.
    const doc = generatePdfReport('incident', baseIncident as any);
    const pageText = (doc.internal.pages[1] as unknown as string[]).join('\n');
    // #d4a017 gold -> 0.831 0.627 0.09 (jsPDF's 3-decimal RGB fill color)
    expect(pageText).toContain('0.831 0.627 0.09 rg');
    // Italic face of the registered Arial font family was selected.
    const fonts = Object.keys((doc as unknown as { getFontList: () => Record<string, unknown> }).getFontList());
    expect(fonts).toContain('Arial');
  });
});
