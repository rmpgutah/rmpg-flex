import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopStickyNote from './DesktopStickyNote';
import type { DesktopNote } from '../../hooks/useDesktopNotes';

const NOTE: DesktopNote = { id: 'n1', x: 20, y: 30, width: 180, height: 140, text: 'Check plate ABC123', color: 'amber' };

describe('DesktopStickyNote', () => {
  it('renders the note text in an editable textarea', () => {
    render(<DesktopStickyNote note={NOTE} onChange={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue('Check plate ABC123')).toBeInTheDocument();
  });

  it('typing in the textarea calls onChange with the new text', () => {
    const onChange = vi.fn();
    render(<DesktopStickyNote note={NOTE} onChange={onChange} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Check plate ABC123'), { target: { value: 'Updated note' } });
    expect(onChange).toHaveBeenCalledWith({ text: 'Updated note' });
  });

  it('clicking the close control calls onDelete', () => {
    const onDelete = vi.fn();
    render(<DesktopStickyNote note={NOTE} onChange={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText('Delete note'));
    expect(onDelete).toHaveBeenCalled();
  });
});
