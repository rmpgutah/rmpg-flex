import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnFootBadge from '../OnFootBadge';

describe('OnFootBadge', () => {
  it('renders ON FOOT with elapsed minutes', () => {
    const since = new Date(Date.now() - 4 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    render(<OnFootBadge since={since} />);
    expect(screen.getByText(/ON FOOT/)).toBeTruthy();
    expect(screen.getByText(/4m/)).toBeTruthy();
  });
  it('renders without elapsed when since is missing', () => {
    render(<OnFootBadge since={null} />);
    expect(screen.getByText('ON FOOT')).toBeTruthy();
  });
  it('fires onClick', () => {
    const fn = vi.fn();
    render(<OnFootBadge since={null} onClick={fn} />);
    screen.getByText('ON FOOT').click();
    expect(fn).toHaveBeenCalled();
  });
});
