import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstallCoachingModal } from '../InstallCoachingModal';

describe('InstallCoachingModal', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(navigator, 'userAgent', {
      writable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 });
  });

  it('renders for iOS Safari mobile when not standalone and not dismissed', () => {
    render(<InstallCoachingModal />);
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
  });

  it('does not render when already dismissed within 30 days', () => {
    localStorage.setItem('rmpg_install_dismissed_at', String(Date.now()));
    render(<InstallCoachingModal />);
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it('persists dismissal on close click', () => {
    render(<InstallCoachingModal />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(localStorage.getItem('rmpg_install_dismissed_at')).toBeTruthy();
  });
});
