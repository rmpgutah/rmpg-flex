import { describe, it, expect } from 'vitest';
import { svgElementToPngDataUrl } from '../graphToPng';

describe('graphToPng', () => {
  it('produces a data URL starting with data:image/png', async () => {
    // Minimal SVG with a circle
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '25'); c.setAttribute('fill', '#d4a017');
    svg.appendChild(c);
    document.body.appendChild(svg);

    const dataUrl = await svgElementToPngDataUrl(svg);
    expect(dataUrl).toMatch(/^data:image\/png/);

    document.body.removeChild(svg);
  });

  it('returns a URL under 5MB for a modest SVG (sanity)', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 200');
    svg.setAttribute('width', '200');
    svg.setAttribute('height', '200');
    document.body.appendChild(svg);
    const dataUrl = await svgElementToPngDataUrl(svg, { scale: 1 });
    expect(dataUrl.length).toBeLessThan(5 * 1024 * 1024);
    document.body.removeChild(svg);
  });
});
