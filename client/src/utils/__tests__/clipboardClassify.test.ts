import { describe, it, expect } from 'vitest';
import { classifyClipboard, cadPathForClip, clipKindLabel, safeHttpUrl, isInAppCadPath } from '../clipboardClassify';

describe('classifyClipboard', () => {
  it('detects URLs, emails, phones, DOBs, and warrants', () => {
    expect(classifyClipboard('https://rmpgutah.us/warrants')).toBe('url');
    expect(classifyClipboard('dispatch@rmpgutah.us')).toBe('email');
    expect(classifyClipboard('(801) 555-1212')).toBe('phone');
    expect(classifyClipboard('1990-04-12')).toBe('dob');
    expect(classifyClipboard('active warrant Hale')).toBe('warrant');
  });

  it('detects plates and case numbers', () => {
    expect(classifyClipboard('ABC1234')).toBe('plate');
    expect(classifyClipboard('CFS-1042')).toBe('case');
  });

  it('falls back to text', () => {
    expect(classifyClipboard('hello world')).toBe('text');
    expect(classifyClipboard('')).toBe('text');
  });
});

describe('cadPathForClip', () => {
  it('routes warrants to /warrants and everything else to intel search', () => {
    expect(cadPathForClip('warrant', 'Hale')).toContain('/warrants?q=');
    expect(cadPathForClip('plate', 'ABC1234')).toContain('/intel/search?q=ABC1234');
  });

  it('allowlists http(s) and never returns javascript/data/vbscript URLs', () => {
    expect(cadPathForClip('url', 'https://rmpgutah.us/warrants')).toBe('https://rmpgutah.us/warrants');
    expect(cadPathForClip('url', 'javascript:alert(1)')).toMatch(/^\/intel\/search\?q=/);
    expect(cadPathForClip('url', 'data:text/html,<h1>x</h1>')).toMatch(/^\/intel\/search\?q=/);
    expect(cadPathForClip('url', 'vbscript:msgbox(1)')).toMatch(/^\/intel\/search\?q=/);
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('//evil.example/phish')).toBeNull();
    expect(isInAppCadPath('/intel/search?q=x')).toBe(true);
    expect(isInAppCadPath('//evil.example')).toBe(false);
    expect(isInAppCadPath('https://rmpgutah.us')).toBe(false);
  });

  it('classifies javascript: as text, not url', () => {
    expect(classifyClipboard('javascript:alert(1)')).toBe('text');
  });

  it('labels kinds for the UI', () => {
    expect(clipKindLabel('plate')).toBe('PLATE');
  });
});
