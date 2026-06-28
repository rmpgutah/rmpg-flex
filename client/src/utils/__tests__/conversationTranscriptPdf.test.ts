import { describe, it, expect } from 'vitest';
import {
  wrapText,
  highestPriority,
  participantsOf,
  generateConversationTranscriptPdf,
} from '../conversationTranscriptPdf';
import type { Message } from '../../types';

function mkMsg(overrides: Partial<Message>): Message {
  return {
    id: '1',
    from_user_id: '10',
    from_user_name: 'Officer Smith',
    subject: 'Test',
    body: 'hello',
    priority: 'normal',
    is_read: true,
    is_broadcast: false,
    created_at: '2026-06-22T10:00:00Z',
    ...overrides,
  };
}

describe('wrapText (conversation transcript)', () => {
  it('returns a single empty entry for an empty input', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });
  it('keeps short strings as one line', () => {
    expect(wrapText('roger that', 20)).toEqual(['roger that']);
  });
  it('wraps at word boundaries', () => {
    // 10-char budget — "one two" = 7, "+three" overruns, breaks before "three"
    expect(wrapText('one two three four', 10)).toEqual(['one two', 'three four']);
  });
  it('preserves explicit newlines as paragraph breaks', () => {
    const out = wrapText('line one\nline two', 50);
    expect(out).toEqual(['line one', 'line two']);
  });
  it('does not lose data when a single word is longer than the budget', () => {
    const out = wrapText('SUPERCALIFRAGILISTICEXPIALIDOCIOUS', 10);
    expect(out.length).toBe(1);
    expect(out[0]).toBe('SUPERCALIFRAGILISTICEXPIALIDOCIOUS');
  });
});

describe('highestPriority', () => {
  it('returns normal for an empty array', () => {
    expect(highestPriority([])).toBe('normal');
  });
  it('returns normal when every message is normal', () => {
    expect(highestPriority([mkMsg({}), mkMsg({ id: '2' })])).toBe('normal');
  });
  it('returns urgent when any message is urgent', () => {
    expect(highestPriority([
      mkMsg({}),
      mkMsg({ id: '2', priority: 'urgent' }),
    ])).toBe('urgent');
  });
  it('returns emergency when any message is emergency (beats urgent)', () => {
    expect(highestPriority([
      mkMsg({ priority: 'urgent' }),
      mkMsg({ id: '2', priority: 'emergency' }),
      mkMsg({ id: '3', priority: 'normal' }),
    ])).toBe('emergency');
  });
});

describe('participantsOf', () => {
  it('returns first-seen order with no duplicates', () => {
    expect(participantsOf([
      mkMsg({ from_user_name: 'Smith', to_user_name: 'Jones' }),
      mkMsg({ id: '2', from_user_name: 'Jones', to_user_name: 'Smith' }),
      mkMsg({ id: '3', from_user_name: 'Smith', to_user_name: 'Davis' }),
    ])).toEqual(['Smith', 'Jones', 'Davis']);
  });
  it('omits empty / undefined recipient (e.g. raw broadcasts)', () => {
    expect(participantsOf([
      mkMsg({ from_user_name: 'Smith', to_user_name: undefined, is_broadcast: true }),
      mkMsg({ id: '2', from_user_name: 'Jones', to_user_name: undefined, is_broadcast: true }),
    ])).toEqual(['Smith', 'Jones']);
  });
  it('returns an empty array for no messages', () => {
    expect(participantsOf([])).toEqual([]);
  });
});

describe('generateConversationTranscriptPdf (smoke)', () => {
  it('does not throw on a populated thread', () => {
    expect(() => {
      generateConversationTranscriptPdf({
        threadId: '42',
        subject: 'Backup needed at 7-Eleven',
        messages: [
          mkMsg({ id: '1', body: 'Need 10-15', priority: 'urgent' }),
          mkMsg({ id: '2', from_user_name: 'Jones', body: 'Copy, en route' }),
        ],
        exportedBy: 'Sgt. Smith',
      });
    }).not.toThrow();
  });

  it('does not throw on an empty messages array (header still renders)', () => {
    expect(() => {
      generateConversationTranscriptPdf({
        threadId: '0',
        subject: '(No Subject)',
        messages: [],
      });
    }).not.toThrow();
  });

  it('does not throw when bodies contain very long words (no spaces)', () => {
    const longWord = 'A'.repeat(500);
    expect(() => {
      generateConversationTranscriptPdf({
        threadId: '99',
        subject: 'Edge case',
        messages: [mkMsg({ body: longWord })],
      });
    }).not.toThrow();
  });

  it('does not throw on a thread with 50+ messages (page break exercised)', () => {
    const many: Message[] = Array.from({ length: 60 }, (_, i) => mkMsg({
      id: String(i + 1),
      body: `Message ${i + 1} body content here.`,
      created_at: `2026-06-22T${String(10 + Math.floor(i / 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
    }));
    expect(() => {
      generateConversationTranscriptPdf({
        threadId: '500',
        subject: 'Long thread',
        messages: many,
      });
    }).not.toThrow();
  });

  it('does not throw when a broadcast emergency thread is rendered', () => {
    expect(() => {
      generateConversationTranscriptPdf({
        threadId: '13',
        subject: 'EMERGENCY BROADCAST',
        messages: [
          mkMsg({
            body: 'Active shooter at 100 Main',
            priority: 'emergency',
            is_broadcast: true,
            to_user_name: undefined,
          }),
        ],
      });
    }).not.toThrow();
  });
});
