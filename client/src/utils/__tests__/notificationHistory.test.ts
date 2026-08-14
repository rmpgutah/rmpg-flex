import { describe, it, expect, beforeEach } from 'vitest';
import {
  pushNotification, getNotificationHistory, markAllRead,
  clearCategory, getUnreadCount,
} from '../notificationHistory';

describe('notificationHistory', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty array initially', () => {
    expect(getNotificationHistory()).toEqual([]);
  });

  it('pushes and retrieves a notification', () => {
    pushNotification({ category: 'dispatch', title: 'Test', body: 'Body', ts: 1 });
    const hist = getNotificationHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].title).toBe('Test');
    expect(hist[0].read).toBe(false);
  });

  it('getUnreadCount counts unread', () => {
    pushNotification({ category: 'dispatch', title: 'A', body: '', ts: 1 });
    pushNotification({ category: 'system',   title: 'B', body: '', ts: 2 });
    expect(getUnreadCount()).toBe(2);
  });

  it('markAllRead sets all to read', () => {
    pushNotification({ category: 'dispatch', title: 'A', body: '', ts: 1 });
    markAllRead();
    expect(getUnreadCount()).toBe(0);
  });

  it('clearCategory removes only that category', () => {
    pushNotification({ category: 'dispatch', title: 'A', body: '', ts: 1 });
    pushNotification({ category: 'system',   title: 'B', body: '', ts: 2 });
    clearCategory('dispatch');
    const remaining = getNotificationHistory();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].category).toBe('system');
  });

  it('caps at 100 entries', () => {
    for (let i = 0; i < 105; i++)
      pushNotification({ category: 'system', title: `N${i}`, body: '', ts: i });
    expect(getNotificationHistory()).toHaveLength(100);
  });
});
