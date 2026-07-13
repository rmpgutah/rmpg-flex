import { describe, it, expect } from 'vitest';
import { statusFromError } from '../apiFetchV2';

describe('statusFromError', () => {
  it('returns err.status when present and finite', () => {
    expect(statusFromError({ name: 'Error', message: 'ignored', status: 404 } as never)).toBe(404);
  });

  it('parses "HTTP 404" style messages', () => {
    expect(statusFromError({ name: 'Error', message: 'HTTP 404' } as never)).toBe(404);
  });

  it('parses "Request failed with status 500" style messages', () => {
    expect(statusFromError({ name: 'Error', message: 'Request failed with status 500' } as never)).toBe(500);
  });

  it('does NOT misread an embedded 3-digit number as a status when there is no HTTP/status marker', () => {
    expect(statusFromError({ name: 'Error', message: 'Vehicle at 404 Main St not found' } as never)).toBe(0);
  });

  it('returns 0 when the message has no digits at all', () => {
    expect(statusFromError({ name: 'Error', message: 'Network error' } as never)).toBe(0);
  });
});
