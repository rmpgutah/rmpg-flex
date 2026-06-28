import { describe, it, expect } from 'vitest';
import { toChatRow, isVal } from './build-dataset-alpr';

describe('alpr dataset builder', () => {
  it('shapes a chat row with image + JSON target', () => {
    const row = toChatRow({ image: 'crops/1.jpg', target: { plate: '5KJH345', state: 'CA' } });
    expect(row.messages[0].content[0]).toEqual({ type: 'image', image: 'crops/1.jpg' });
    expect(JSON.parse(row.messages[1].content as string).plate).toBe('5KJH345');
  });
  it('splits deterministically', () => {
    expect(isVal('crops/1.jpg')).toBe(isVal('crops/1.jpg'));
  });
});
