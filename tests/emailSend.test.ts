import { describe, it, expect } from 'vitest';
import { parseAddrList, mapAttachments, buildSendPayload } from '../src/utils/emailSend';

describe('parseAddrList', () => {
  it('splits a comma/semicolon string and drops blanks/non-addresses', () => {
    expect(parseAddrList('a@x.com, b@y.com ; ,notanemail')).toEqual([
      { emailAddress: { address: 'a@x.com' } },
      { emailAddress: { address: 'b@y.com' } },
    ]);
  });
  it('accepts an array', () => {
    expect(parseAddrList(['a@x.com', '', 'c@z.com'])).toEqual([
      { emailAddress: { address: 'a@x.com' } },
      { emailAddress: { address: 'c@z.com' } },
    ]);
  });
  it('returns [] for undefined', () => {
    expect(parseAddrList(undefined)).toEqual([]);
  });
});

describe('mapAttachments', () => {
  it('maps base64 attachments to Graph fileAttachments and caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.pdf`, contentBytes: 'AA' }));
    const out = mapAttachments(many);
    expect(out).toHaveLength(20);
    expect(out[0]).toEqual({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'f0.pdf', contentType: 'application/octet-stream', contentBytes: 'AA',
    });
  });
  it('drops entries with no contentBytes', () => {
    expect(mapAttachments([{ name: 'x.pdf' }])).toEqual([]);
  });
});

describe('buildSendPayload', () => {
  it('builds an HTML payload with recipients and an attachment', () => {
    const p = buildSendPayload({
      to: 'a@x.com', cc: ['b@y.com'], subject: 'Hi', body: '<b>hi</b>', isHtml: true,
      attachments: [{ name: 'doc.pdf', contentType: 'application/pdf', contentBytes: 'QQ' }],
    });
    expect(p.message.subject).toBe('Hi');
    expect(p.message.body).toEqual({ contentType: 'HTML', content: '<b>hi</b>' });
    expect(p.message.toRecipients).toEqual([{ emailAddress: { address: 'a@x.com' } }]);
    expect(p.message.ccRecipients).toEqual([{ emailAddress: { address: 'b@y.com' } }]);
    expect(p.message.attachments?.[0].name).toBe('doc.pdf');
    expect(p.saveToSentItems).toBe(true);
  });
  it('defaults subject, uses Text when isHtml===false, omits empty attachments, clamps importance', () => {
    const p = buildSendPayload({ to: 'a@x.com', isHtml: false, importance: 'bogus' });
    expect(p.message.subject).toBe('(no subject)');
    expect(p.message.body.contentType).toBe('Text');
    expect(p.message.attachments).toBeUndefined();
    expect(p.message.importance).toBe('normal');
  });
});
