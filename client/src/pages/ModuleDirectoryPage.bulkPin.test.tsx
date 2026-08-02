import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: '1', role: 'officer' } }) }));

import ModuleDirectoryPage from './ModuleDirectoryPage';

describe('ModuleDirectoryPage — bulk pin', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('select-multiple mode stars every checked module in one save', () => {
    render(<MemoryRouter><ModuleDirectoryPage /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText(/Select multiple/i));
    fireEvent.change(screen.getByPlaceholderText(/Search modules/i), { target: { value: 'Dispatch Console' } });
    fireEvent.click(screen.getByLabelText(/Select Dispatch Console/i));
    fireEvent.change(screen.getByPlaceholderText(/Search modules/i), { target: { value: 'Tactical Map' } });
    fireEvent.click(screen.getByLabelText(/Select Tactical Map/i));
    fireEvent.click(screen.getByText(/Pin 2 selected/i));
    const favorites = JSON.parse(localStorage.getItem('rmpg_nav_favorites') ?? '[]');
    expect(favorites).toEqual(expect.arrayContaining(['/dispatch', '/map']));
  });
});
