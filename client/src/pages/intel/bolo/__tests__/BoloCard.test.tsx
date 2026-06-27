import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import BoloCard from '../BoloCard';
import type { Bolo } from '../../useBolos';

const bolo: Bolo = {
  id: 1, bolo_number: '26-BOLO-00001', type: 'person', status: 'active', title: 'Wanted subject',
  description: 'Last seen downtown', subject_description: 'Tall, tattoo', vehicle_description: null,
  photo_url: null, priority: 'P1', issued_by: 5, issued_by_name: 'C. Zamora', expires_at: null, created_at: '2026-06-13',
};

describe('BoloCard', () => {
  it('renders title, number, priority, subject and fires resolve', () => {
    const onResolve = vi.fn();
    render(<BoloCard bolo={bolo} canDelete onResolve={onResolve} onDelete={() => {}} />);
    expect(screen.getByText('Wanted subject')).toBeInTheDocument();
    expect(screen.getByText('26-BOLO-00001')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText(/Tall, tattoo/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/resolve/i));
    expect(onResolve).toHaveBeenCalledWith(1);
  });

  it('hides delete when canDelete is false', () => {
    render(<BoloCard bolo={bolo} canDelete={false} onResolve={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(/cancel bolo/i)).not.toBeInTheDocument();
  });
});
