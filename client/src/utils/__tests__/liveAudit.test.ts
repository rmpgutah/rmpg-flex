import { describe, it, expect } from 'vitest';
import { findBlackOverlays, findGoldLeaks } from '../liveAudit';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('findBlackOverlays', () => {
  it('flags a large near-black background that is not blue-dominant', () => {
    const host = mount('<div style="background-color: rgb(6,6,6); width: 200px; height: 100px"></div>');
    const found = findBlackOverlays(host);
    expect(found).toHaveLength(1);
    expect(found[0].luminance).toBeLessThan(26);
  });

  it('does not flag the navy surface ramp', () => {
    const host = mount('<div style="background-color: rgb(20,40,64); width: 200px; height: 100px"></div>');
    expect(findBlackOverlays(host)).toHaveLength(0);
  });

  it('ignores elements below the area threshold', () => {
    const host = mount('<div style="background-color: rgb(0,0,0); width: 4px; height: 4px"></div>');
    expect(findBlackOverlays(host)).toHaveLength(0);
  });
});

describe('findGoldLeaks', () => {
  it('flags legacy brand gold', () => {
    const host = mount('<span style="color: rgb(212,160,23)">x</span>');
    const found = findGoldLeaks(host);
    expect(found).toHaveLength(1);
    expect(found[0].property).toBe('color');
  });

  it('does not flag warning amber, which is a legitimate severity hue', () => {
    const host = mount('<span style="color: rgb(245,158,11)">x</span>');
    expect(findGoldLeaks(host)).toHaveLength(0);
  });

  it('does not flag the approved deepened gold', () => {
    const host = mount('<span style="color: rgb(184,145,47)">x</span>');
    expect(findGoldLeaks(host)).toHaveLength(0);
  });
});
