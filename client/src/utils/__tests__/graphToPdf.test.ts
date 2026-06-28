import { describe, it, expect } from 'vitest';
import { exportGraphToPdf } from '../graphToPdf';

describe('graphToPdf', () => {
  it('produces a Blob whose type indicates a PDF', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    document.body.appendChild(svg);

    const blob = await exportGraphToPdf(
      svg as unknown as SVGSVGElement,
      [
        { type: 'person', label: 'Jane Doe', annotation: 'Prime suspect' },
        { type: 'incident', label: 'I-0001 Burglary' },
      ],
      {
        investigationName: 'Test Case',
        seedType: 'person',
        seedId: 42,
        seedLabel: 'Jane Doe',
        generatedBy: 'admin',
      }
    );

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toMatch(/application\/pdf/);
    expect(blob.size).toBeGreaterThan(500);

    document.body.removeChild(svg);
  });

  it('handles empty node list', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    document.body.appendChild(svg);

    const blob = await exportGraphToPdf(svg as unknown as SVGSVGElement, [], {});
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    document.body.removeChild(svg);
  });
});
