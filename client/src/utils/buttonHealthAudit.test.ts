import { describe, it, expect } from 'vitest';
import { auditButtonHealth } from './buttonHealthAudit';

// NOTE: jsdom does not implement layout — getBoundingClientRect() returns a
// zero-sized box and elementFromPoint() is a no-op — so every control is
// skipped as "off-screen". These tests therefore verify the report SHAPE and
// the safe-skip contract rather than real hit-testing (which is exercised live
// in the browser via the ButtonHealthOverlay). They guard against the audit
// throwing or returning a malformed report.

describe('auditButtonHealth', () => {
  it('returns a well-formed report on an empty document', () => {
    document.body.innerHTML = '';
    const report = auditButtonHealth();
    expect(report).toMatchObject({
      url: expect.any(String),
      viewport: expect.any(Array),
      totalVisible: expect.any(Number),
      blocked: expect.any(Number),
      sliver: expect.any(Number),
      interceptorTally: expect.any(Array),
      entries: expect.any(Array),
    });
    expect(report.blocked).toBe(0);
    expect(report.sliver).toBe(0);
  });

  it('never throws even with disabled / aria-hidden controls present', () => {
    document.body.innerHTML = `
      <button disabled>Disabled</button>
      <div aria-hidden="true"><button>Hidden</button></div>
      <button aria-disabled="true">AriaDisabled</button>
      <a href="#">Link</a>
    `;
    expect(() => auditButtonHealth()).not.toThrow();
  });
});
