import { describe, it, expect, vi } from 'vitest';
import { sendCsv } from '../../src/utils/csvExport';

// ── Helper to create mock Express Response ──────────────
function mockRes() {
  const res: any = {
    _headers: {} as Record<string, string>,
    _body: '',
  };
  res.setHeader = vi.fn((key: string, value: string) => {
    res._headers[key] = value;
  });
  res.send = vi.fn((body: string) => {
    res._body = body;
  });
  return res;
}

// ────────────────────────────────────────────────────────
// sendCsv
// ────────────────────────────────────────────────────────
describe('sendCsv', () => {
  const columns = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' },
    { key: 'status', header: 'Status' },
  ];

  it('sets correct Content-Type header', () => {
    const res = mockRes();
    sendCsv(res, 'test.csv', columns, []);
    expect(res._headers['Content-Type']).toBe('text/csv; charset=utf-8');
  });

  it('sets Content-Disposition header with filename', () => {
    const res = mockRes();
    sendCsv(res, 'export.csv', columns, []);
    expect(res._headers['Content-Disposition']).toBe('attachment; filename="export.csv"');
  });

  it('sanitizes filename (strips newlines and quotes)', () => {
    const res = mockRes();
    sendCsv(res, 'evil\r\nheader"injection.csv', columns, []);
    expect(res._headers['Content-Disposition']).toBe('attachment; filename="evil__header_injection.csv"');
  });

  it('includes UTF-8 BOM at start of CSV', () => {
    const res = mockRes();
    sendCsv(res, 'test.csv', columns, []);
    expect(res._body.charCodeAt(0)).toBe(0xFEFF);
  });

  it('generates header row from column definitions', () => {
    const res = mockRes();
    sendCsv(res, 'test.csv', columns, []);
    const lines = res._body.substring(1).split('\r\n'); // Skip BOM
    expect(lines[0]).toBe('ID,Name,Status');
  });

  it('generates data rows from row objects', () => {
    const res = mockRes();
    const rows = [
      { id: 1, name: 'John', status: 'Active' },
      { id: 2, name: 'Jane', status: 'Inactive' },
    ];
    sendCsv(res, 'test.csv', columns, rows);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines[1]).toBe('1,John,Active');
    expect(lines[2]).toBe('2,Jane,Inactive');
  });

  it('handles empty rows array', () => {
    const res = mockRes();
    sendCsv(res, 'test.csv', columns, []);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines).toHaveLength(1); // Only header row
  });

  it('escapes values containing commas', () => {
    const res = mockRes();
    const rows = [{ id: 1, name: 'Doe, John', status: 'Active' }];
    sendCsv(res, 'test.csv', columns, rows);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines[1]).toBe('1,"Doe, John",Active');
  });

  it('escapes values containing double quotes', () => {
    const res = mockRes();
    const rows = [{ id: 1, name: 'John "JD" Doe', status: 'Active' }];
    sendCsv(res, 'test.csv', columns, rows);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines[1]).toContain('"John ""JD"" Doe"');
  });

  it('escapes values containing newlines', () => {
    const res = mockRes();
    const rows = [{ id: 1, name: 'Line1\nLine2', status: 'Active' }];
    sendCsv(res, 'test.csv', columns, rows);
    // The escaped value should be wrapped in quotes
    expect(res._body).toContain('"Line1\nLine2"');
  });

  it('handles null and undefined values as empty strings', () => {
    const res = mockRes();
    const rows = [{ id: 1, name: null, status: undefined }];
    sendCsv(res, 'test.csv', columns, rows);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines[1]).toBe('1,,');
  });

  it('handles numeric values', () => {
    const res = mockRes();
    const rows = [{ id: 42, name: 'Test', status: 0 }];
    sendCsv(res, 'test.csv', columns, rows);
    const lines = res._body.substring(1).split('\r\n');
    expect(lines[1]).toBe('42,Test,0');
  });

  it('uses CRLF line endings', () => {
    const res = mockRes();
    const rows = [{ id: 1, name: 'Test', status: 'OK' }];
    sendCsv(res, 'test.csv', columns, rows);
    const content = res._body.substring(1); // Skip BOM
    expect(content).toContain('\r\n');
  });
});
