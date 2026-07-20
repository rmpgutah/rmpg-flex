import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CompanyBrowserPage from './CompanyBrowserPage';

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ browser_bookmarks_json: null, browser_history_json: null }),
}));

describe('CompanyBrowserPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts with one tab on the new-tab page', () => {
    render(<CompanyBrowserPage />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('opens a new tab on new-tab button click', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('closes a tab, keeping at least one open', () => {
    render(<CompanyBrowserPage />);
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
    fireEvent.click(closeButtons[0]);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('navigates the active tab when the address bar is submitted, normalizing a bare domain to https', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'example.com' } });
    fireEvent.submit(addressBar.closest('form')!);
    const webview = document.querySelector('webview');
    expect(webview?.getAttribute('src')).toBe('https://example.com');
  });

  it('adds and removes a bookmark for the active tab URL', () => {
    render(<CompanyBrowserPage />);
    const addressBar = screen.getByRole('textbox', { name: /address/i });
    fireEvent.change(addressBar, { target: { value: 'https://example.com' } });
    fireEvent.submit(addressBar.closest('form')!);

    fireEvent.click(screen.getByRole('button', { name: /add bookmark/i }));
    expect(screen.getByRole('link', { name: /example\.com/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));
    expect(screen.queryByRole('link', { name: /example\.com/i })).not.toBeInTheDocument();
  });
});
