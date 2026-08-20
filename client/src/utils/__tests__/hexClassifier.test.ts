import { describe, it, expect } from 'vitest';
import { classifyFile } from '../hexClassifier';

describe('classifyFile', () => {
  it('excludes PDF generators, whose hex is a literal jsPDF argument', () => {
    for (const p of [
      'src/utils/dispatchGuidePdfGenerator.ts',
      'src/utils/pdfTokens.ts',
      'src/pages/fleet/utils/fleetPdfReports.ts',
      'src/utils/navTripPdf.ts',
    ]) {
      expect(classifyFile(p)).toBe('excluded');
    }
  });

  it('excludes the pdf-editor canvas renderer', () => {
    expect(classifyFile('src/pages/pdf-editor/components/PageCanvas.tsx')).toBe('excluded');
  });

  it('excludes the map basemap module, which owns its own fixed palette', () => {
    expect(classifyFile('src/utils/mapboxBasemap.ts')).toBe('excluded');
    expect(classifyFile('src/pages/map/utils/mapMarkers.ts')).toBe('excluded');
  });

  it('excludes tests and fixtures', () => {
    expect(classifyFile('src/utils/__tests__/mapboxSafeLayer.test.ts')).toBe('excluded');
    expect(classifyFile('src/utils/liveAudit.ts')).toBe('excluded');
  });

  it('excludes fixed categorical palettes, where the colors ARE the data', () => {
    // connectionsGraphStyle assigns one color per entity type and was hand-tuned
    // for collision avoidance; geographyLabels assigns district/sector identity
    // colors operators learn by sight. Re-theming either changes meaning.
    expect(classifyFile('src/utils/connectionsGraphStyle.ts')).toBe('excluded');
    expect(classifyFile('src/utils/geographyLabels.ts')).toBe('excluded');
  });

  it('includes ordinary page and component chrome', () => {
    for (const p of [
      'src/pages/CrashReportsPage.tsx',
      'src/pages/AlarmTrackingPage.tsx',
      'src/components/StatsCard.tsx',
    ]) {
      expect(classifyFile(p)).toBe('in-scope');
    }
  });
});
