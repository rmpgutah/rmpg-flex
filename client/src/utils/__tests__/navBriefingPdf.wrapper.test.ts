import { describe, it, expect, vi } from 'vitest';
import type { RouteInfo } from '../../hooks/useMapRouting';

const saveSpy = vi.fn();
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class PatchedJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = ((filename?: string) => {
        saveSpy(filename);
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...actual, default: PatchedJsPDF, jsPDF: PatchedJsPDF };
});

vi.mock('../pdfStaticMap', () => ({
  fetchLocationMapImage: vi.fn().mockResolvedValue(null),
}));

import { generateNavBriefing, buildNavBriefingPdf } from '../navBriefingPdf';

function baseRoute(): RouteInfo {
  return {
    unitCallSign: '4-Adam-12',
    callNumber: 'C-2026-004417',
    eta: '6 min',
    distance: '2.1 mi',
    durationSec: 360,
    distanceMeters: 3380,
    steps: [],
    trafficAware: false,
    worstCongestion: 'low' as RouteInfo['worstCongestion'],
    postedLimitMph: null,
  };
}

describe('navBriefingPdf wrapper (builder-extraction)', () => {
  it('generateNavBriefing still returns void and triggers a save', async () => {
    saveSpy.mockClear();
    const result = await generateNavBriefing({ route: baseRoute(), officerName: 'Marcus Reyes' });
    expect(result).toBeUndefined();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).toMatch(/^nav-briefing-marcus-reyes-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('buildNavBriefingPdf returns the jsPDF document without saving', async () => {
    saveSpy.mockClear();
    const doc = await buildNavBriefingPdf({ route: baseRoute() });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
