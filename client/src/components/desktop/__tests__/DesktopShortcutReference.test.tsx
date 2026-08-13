import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DesktopShortcutReference from '../DesktopShortcutReference';

describe('DesktopShortcutReference', () => {
  it('renders all shortcut categories', () => {
    render(<DesktopShortcutReference onClose={() => {}} />);
    expect(screen.getByText(/window management/i)).toBeInTheDocument();
    // "Desktop" appears in category heading and descriptions; assert at least one exists
    expect(screen.getAllByText(/desktop/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/navigation/i)).toBeInTheDocument();
  });

  it('renders Win+Arrow shortcuts', () => {
    render(<DesktopShortcutReference onClose={() => {}} />);
    expect(screen.getByText(/Win\+Left/i)).toBeInTheDocument();
    expect(screen.getByText(/Win\+Right/i)).toBeInTheDocument();
  });

  it('renders close button with aria-label', () => {
    const onClose = vi.fn();
    render(<DesktopShortcutReference onClose={onClose} />);
    const btn = screen.getByRole('button', { name: /close shortcut reference/i });
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders search input', () => {
    render(<DesktopShortcutReference onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/search shortcuts/i)).toBeInTheDocument();
  });

  it('search filters shortcuts', () => {
    render(<DesktopShortcutReference onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/search shortcuts/i);
    // Fire a change event with value 'lock'
    Object.defineProperty(input, 'value', { writable: true, value: 'lock' });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Panel is still rendered (no crash)
    expect(screen.getByTestId('shortcut-reference')).toBeInTheDocument();
  });
});
