import { describe, it, expect } from 'vitest';
import {
  channelLabel,
  sourceLabel,
  formatDuration,
  formatFileSize,
  prettyEntityType,
  needsCaseLinkAlert,
} from '../dashcamReviewPdf';

describe('channelLabel', () => {
  it('maps "outside" → FRONT CAM (the UI convention)', () => {
    expect(channelLabel('outside')).toBe('FRONT CAM');
  });
  it('maps "inside" → REAR CAM', () => {
    expect(channelLabel('inside')).toBe('REAR CAM');
  });
  it('returns em-dash for missing value', () => {
    expect(channelLabel(undefined)).toBe('—');
    expect(channelLabel(null)).toBe('—');
    expect(channelLabel('')).toBe('—');
  });
  it('passes through unknown channels uppercased', () => {
    expect(channelLabel('cabin')).toBe('CABIN');
  });
});

describe('sourceLabel', () => {
  it('defaults missing/upload → Manual Upload', () => {
    expect(sourceLabel(undefined)).toBe('Manual Upload');
    expect(sourceLabel('')).toBe('Manual Upload');
    expect(sourceLabel('upload')).toBe('Manual Upload');
  });
  it('maps clearpathgps → ClearPathGPS', () => {
    expect(sourceLabel('clearpathgps')).toBe('ClearPathGPS');
  });
  it('passes through unknown sources', () => {
    expect(sourceLabel('flexcam')).toBe('flexcam');
  });
});

describe('formatDuration', () => {
  it('returns em-dash for invalid input', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Infinity)).toBe('—');
  });
  it('formats sub-hour as m:ss', () => {
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(125)).toBe('2:05');
  });
  it('formats >=1h as h:mm:ss', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('floors fractional seconds', () => {
    expect(formatDuration(45.9)).toBe('0:45');
  });
});

describe('formatFileSize', () => {
  it('returns em-dash for missing / zero / negative', () => {
    expect(formatFileSize(null)).toBe('—');
    expect(formatFileSize(undefined)).toBe('—');
    expect(formatFileSize(0)).toBe('—');
    expect(formatFileSize(-100)).toBe('—');
  });
  it('formats KB / MB / GB', () => {
    expect(formatFileSize(512 * 1024)).toBe('512 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});

describe('prettyEntityType', () => {
  it('capitalizes a known entity type', () => {
    expect(prettyEntityType('case')).toBe('Case');
    expect(prettyEntityType('incident')).toBe('Incident');
  });
  it('returns em-dash for missing', () => {
    expect(prettyEntityType(undefined)).toBe('—');
    expect(prettyEntityType('')).toBe('—');
  });
});

describe('needsCaseLinkAlert', () => {
  it('fires for evidence-classified video with no case_number and no case link', () => {
    expect(needsCaseLinkAlert({ classification: 'evidence' }, [])).toBe(true);
  });
  it('fires for flagged classification too', () => {
    expect(needsCaseLinkAlert({ classification: 'flagged' }, [])).toBe(true);
  });
  it('fires for restricted', () => {
    expect(needsCaseLinkAlert({ classification: 'restricted' }, [])).toBe(true);
  });
  it('does NOT fire when routine', () => {
    expect(needsCaseLinkAlert({ classification: 'routine' }, [])).toBe(false);
  });
  it('does NOT fire when case_number is set on the row', () => {
    expect(needsCaseLinkAlert({ classification: 'evidence', case_number: '25-1234' }, [])).toBe(false);
  });
  it('does NOT fire when an explicit case link exists', () => {
    expect(needsCaseLinkAlert(
      { classification: 'evidence' },
      [{ entity_type: 'case', entity_id: 42 }],
    )).toBe(false);
  });
  it('ignores non-case links — an incident-only link still trips the alert', () => {
    expect(needsCaseLinkAlert(
      { classification: 'evidence' },
      [{ entity_type: 'incident', entity_id: 7 }],
    )).toBe(true);
  });
  it('ignores classification case (handles upper-case input)', () => {
    expect(needsCaseLinkAlert({ classification: 'EVIDENCE' }, [])).toBe(true);
  });
});
