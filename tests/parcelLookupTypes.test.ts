import { describe, it, expect } from 'vitest';
import { AssessorError, AssessorConfigError, AssessorHttpError, AssessorParseError, AssessorTimeoutError } from '../src/utils/parcel-lookup/types';
import { AssessorError as SlAssessorError } from '../src/utils/sl-assessor/types';

describe('parcel-lookup shared types', () => {
  it('re-exports the same error classes sl-assessor uses', () => {
    expect(AssessorError).toBe(SlAssessorError);
  });

  it('AssessorHttpError carries status + message', () => {
    const e = new AssessorHttpError(404, 'not found');
    expect(e.status).toBe(404);
    expect(e.message).toBe('not found');
    expect(e).toBeInstanceOf(AssessorError);
  });

  it('AssessorParseError carries an optional excerpt', () => {
    const e = new AssessorParseError('bad html', '<div>...</div>');
    expect(e.excerpt).toBe('<div>...</div>');
  });

  it('AssessorConfigError has a default message', () => {
    const e = new AssessorConfigError();
    expect(e.message).toMatch(/FIRECRAWL_API_KEY/);
  });

  it('AssessorTimeoutError is a distinct subclass', () => {
    const e = new AssessorTimeoutError('timed out');
    expect(e.name).toBe('AssessorTimeoutError');
  });
});
