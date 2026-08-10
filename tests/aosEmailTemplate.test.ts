import { describe, it, expect } from 'vitest';
import { buildAosEmailHtml } from '../src/utils/aosEmailTemplate';

describe('buildAosEmailHtml', () => {
  it('produces valid HTML with recipient name', () => {
    const html = buildAosEmailHtml({
      recipientName: 'Jane Doe',
      formTitle: 'Acknowledgement of Service Form (Individual)',
      documents: [{ title: 'Summons', copies: 1 }],
      caseNumber: '240301234',
      dateServed: '2026-08-10',
      serverName: 'Ofc. Smith',
      serverBadge: '#412',
    });
    expect(html).toContain('Jane Doe');
    expect(html).toContain('acknowledgement of service form (individual)');
    expect(html).toContain('Summons');
    expect(html).toContain('240301234');
    expect(html).toContain('#22405f');
    expect(html).toContain('Rocky Mountain Protective Group');
    expect(html).toContain('server@rmpgutah.us');
  });

  it('omits case number when not provided', () => {
    const html = buildAosEmailHtml({
      recipientName: 'John Smith',
      formTitle: 'Acknowledgement of Service Form',
      documents: [],
    });
    expect(html).not.toContain('Case');
    expect(html).toContain('John Smith');
  });

  it('escapes HTML in recipient name', () => {
    const html = buildAosEmailHtml({
      recipientName: '<script>alert("xss")</script>',
      formTitle: 'Test Form',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
