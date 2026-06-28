import { describe, it, expect } from 'vitest';
import {
  wrapText,
  stripHtmlForText,
  highestImportance,
  participantsOf,
  generateEmailThreadPdf,
} from '../emailThreadPdf';
import type { EmailMessage, EmailAttachment } from '../../types';

function mkMsg(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: 'AAMk-1',
    conversationId: 'CONV-1',
    subject: 'Subpoena duces tecum — case 2026-CR-1234',
    fromAddress: 'clerk@court.state.ut.us',
    fromName: 'Court Clerk',
    toAddresses: [{ email: 'records@rmpgutah.us', name: 'Records' }],
    ccAddresses: [],
    bodyPreview: 'Please produce records by Friday...',
    bodyHtml: '<p>Please produce records by Friday.</p>',
    hasAttachments: false,
    isRead: true,
    isFlagged: false,
    importance: 'normal',
    receivedAt: '2026-06-22T15:00:00Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// wrapText
// ─────────────────────────────────────────────────────────────

describe('wrapText (email thread)', () => {
  it('returns a single empty entry for an empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('records request', 30)).toEqual(['records request']);
  });
  it('wraps at word boundaries', () => {
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    expect(wrapText('line one\nline two', 50)).toEqual(['line one', 'line two']);
  });
  it('does not lose long unbreakable tokens (URLs, hashes)', () => {
    const url = 'https://example.com/a/very/long/url/that/has/no/spaces/at/all/case/file.pdf';
    const out = wrapText(url, 30);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(url);
  });
});

// ─────────────────────────────────────────────────────────────
// stripHtmlForText
// ─────────────────────────────────────────────────────────────

describe('stripHtmlForText', () => {
  it('returns an empty string for null / undefined / empty', () => {
    expect(stripHtmlForText(null)).toBe('');
    expect(stripHtmlForText(undefined)).toBe('');
    expect(stripHtmlForText('')).toBe('');
  });
  it('strips simple tags but keeps text', () => {
    expect(stripHtmlForText('<div>Hello <b>world</b></div>')).toBe('Hello world');
  });
  it('turns <br> into newlines', () => {
    expect(stripHtmlForText('Line A<br>Line B')).toBe('Line A\nLine B');
  });
  it('decodes &amp; &nbsp; &quot; &#39; — entity-encoded tags are stripped as tags', () => {
    // &lt;c&gt; is decoded to <c> before tag-stripping, so it disappears — this is
    // intentional: CodeQL fix ensures HTML-encoded script blocks cannot survive the strip.
    expect(stripHtmlForText('A &amp; B&nbsp;&lt;c&gt; &quot;d&quot; &#39;e&#39;'))
      .toBe('A & B "d" \'e\'');
  });
  it('strips HTML-encoded script tags — content becomes plain text (safe for PDF)', () => {
    // <script> and </script> tags are removed; the inner text remains as plain output.
    // In a PDF that is harmless — the danger only exists in DOM contexts.
    expect(stripHtmlForText('safe &lt;script&gt;alert(1)&lt;/script&gt; text'))
      .toBe('safe alert(1) text');
  });
  it('collapses runs of blank lines but keeps a single paragraph break', () => {
    expect(stripHtmlForText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });
});

// ─────────────────────────────────────────────────────────────
// highestImportance
// ─────────────────────────────────────────────────────────────

describe('highestImportance', () => {
  it('returns normal for an empty thread', () => {
    expect(highestImportance([])).toBe('normal');
  });
  it('returns normal when every message is normal', () => {
    expect(highestImportance([mkMsg({}), mkMsg({ id: '2' })])).toBe('normal');
  });
  it('returns high when any message is high (beats normal + low)', () => {
    expect(highestImportance([
      mkMsg({}),
      mkMsg({ id: '2', importance: 'low' }),
      mkMsg({ id: '3', importance: 'high' }),
    ])).toBe('high');
  });
  it('returns low only when all are low or normal and at least one is low', () => {
    expect(highestImportance([
      mkMsg({ importance: 'low' }),
      mkMsg({ id: '2', importance: 'low' }),
    ])).toBe('low');
  });
});

// ─────────────────────────────────────────────────────────────
// participantsOf
// ─────────────────────────────────────────────────────────────

describe('participantsOf', () => {
  it('returns first-seen order, dedups by email (case-insensitive)', () => {
    const out = participantsOf([
      mkMsg({
        fromAddress: 'a@x.com', fromName: 'Alice',
        toAddresses: [{ email: 'b@x.com', name: 'Bob' }],
        ccAddresses: [{ email: 'c@x.com', name: 'Carol' }],
      }),
      mkMsg({
        id: '2',
        fromAddress: 'B@X.com', fromName: 'Bob',
        toAddresses: [{ email: 'a@x.com', name: 'Alice' }],
      }),
    ]);
    expect(out).toEqual([
      'Alice <a@x.com>',
      'Bob <b@x.com>',
      'Carol <c@x.com>',
    ]);
  });
  it('returns an empty array when there are no messages', () => {
    expect(participantsOf([])).toEqual([]);
  });
  it('omits empty addresses', () => {
    const out = participantsOf([
      mkMsg({ fromAddress: '', fromName: '', toAddresses: [], ccAddresses: [] }),
    ]);
    expect(out).toEqual([]);
  });
  it('uses bare email when name is identical to email', () => {
    const out = participantsOf([
      mkMsg({ fromAddress: 'x@y.com', fromName: 'x@y.com', toAddresses: [], ccAddresses: [] }),
    ]);
    expect(out).toEqual(['x@y.com']);
  });
});

// ─────────────────────────────────────────────────────────────
// generateEmailThreadPdf (smoke)
// ─────────────────────────────────────────────────────────────

describe('generateEmailThreadPdf (smoke)', () => {
  it('does not throw on a populated single-message thread', () => {
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-1',
        folder: 'Inbox',
        messages: [mkMsg({})],
        exportedBy: 'Sgt. Smith',
      });
    }).not.toThrow();
  });

  it('does not throw on an empty messages array (banner + summary still render)', () => {
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-EMPTY',
        messages: [],
      });
    }).not.toThrow();
  });

  it('does not throw on a long body with no spaces (URL/hash tail)', () => {
    const url = 'https://example.com/' + 'a'.repeat(600);
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-LONG',
        messages: [mkMsg({ bodyPreview: url, bodyHtml: `<p>${url}</p>` })],
      });
    }).not.toThrow();
  });

  it('does not throw on a 60-message thread (page break exercised)', () => {
    const many: EmailMessage[] = Array.from({ length: 60 }, (_, i) => mkMsg({
      id: `m-${i + 1}`,
      bodyPreview: `Message ${i + 1} body content here.`,
      bodyHtml: `<p>Message ${i + 1} body content here.</p>`,
      receivedAt: `2026-06-22T${String(10 + Math.floor(i / 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
    }));
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-BIG',
        folder: 'Sent Items',
        messages: many,
      });
    }).not.toThrow();
  });

  it('does not throw when an attachment list is provided per message', () => {
    const m = mkMsg({ hasAttachments: true });
    const atts: EmailAttachment[] = [
      { id: 'a1', name: 'subpoena.pdf', contentType: 'application/pdf', size: 245678, isInline: false },
      { id: 'a2', name: 'inline-logo.png', contentType: 'image/png', size: 2456, isInline: true },
    ];
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-ATT',
        messages: [m],
        attachmentsByMessageId: { [m.id]: atts },
      });
    }).not.toThrow();
  });

  it('does not throw when high-importance + flagged + unread tags coincide', () => {
    expect(() => {
      generateEmailThreadPdf({
        threadId: 'CONV-PRIORITY',
        messages: [
          mkMsg({ importance: 'high', isFlagged: true, isRead: false }),
        ],
        exportedBy: 'Sgt. Smith',
      });
    }).not.toThrow();
  });
});
