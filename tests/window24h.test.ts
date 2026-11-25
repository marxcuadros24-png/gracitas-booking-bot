import { describe, expect, it } from 'vitest';
import { isWithin24HourWindow } from '../src/whatsapp/client.js';

describe('isWithin24HourWindow', () => {
  it('returns true when elapsed time is under 24 hours', () => {
    const now = new Date('2026-11-25T15:00:00Z');
    const lastMsg = new Date('2026-11-24T15:01:00Z'); // 23h 59m ago
    expect(isWithin24HourWindow(lastMsg, now)).toBe(true);
  });

  it('returns false when elapsed time is 24 hours or more', () => {
    const now = new Date('2026-11-25T15:00:00Z');
    const exact24h = new Date('2026-11-24T15:00:00Z');
    const over24h = new Date('2026-11-24T14:59:00Z');
    expect(isWithin24HourWindow(exact24h, now)).toBe(false);
    expect(isWithin24HourWindow(over24h, now)).toBe(false);
  });
});
