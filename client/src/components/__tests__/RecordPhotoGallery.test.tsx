import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordPhotoGallery } from '../RecordPhotoGallery';

const mockApiFetch = vi.fn();
const mockApiPostForm = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiPostForm: (...args: unknown[]) => mockApiPostForm(...args),
  authedImageUrl: (u: string) => u,
}));

describe('RecordPhotoGallery', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockApiPostForm.mockReset(); });

  it('prompts to save the record first when there is no recordId', () => {
    render(<RecordPhotoGallery recordType="property" recordId={undefined} />);
    expect(screen.getByText(/Save the record before adding photos/i)).toBeInTheDocument();
  });

  it('renders photo and layout thumbnails separately once loaded', async () => {
    mockApiFetch.mockResolvedValue([
      { id: 1, url: '/api/property-photos/file/a.jpg', caption: null, category: 'exterior', kind: 'photo', uploaded_by: null, uploaded_at: '2026-01-01' },
      { id: 2, url: '/api/property-photos/file/b.jpg', caption: null, category: null, kind: 'layout', uploaded_by: null, uploaded_at: '2026-01-01' },
    ]);
    render(<RecordPhotoGallery recordType="property" recordId={9} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(screen.getByText('layout')).toBeInTheDocument();
  });

  it('uploads a layout image via the Upload Layout button', async () => {
    mockApiFetch.mockResolvedValue([]);
    mockApiPostForm.mockResolvedValue({ id: 3 });
    const user = userEvent.setup();
    render(<RecordPhotoGallery recordType="business" recordId={4} />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/business-photos/4'));

    const file = new File([new Uint8Array([1])], 'plan.png', { type: 'image/png' });
    // The hidden file inputs have no accessible label; select by DOM order.
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(2);
    await user.upload(fileInputs[1] as HTMLInputElement, file);
    await waitFor(() => expect(mockApiPostForm).toHaveBeenCalled());
    const form = mockApiPostForm.mock.calls[0][1] as FormData;
    expect(form.get('kind')).toBe('layout');
  });
});
