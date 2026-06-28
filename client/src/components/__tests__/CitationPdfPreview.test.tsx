import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationPdfPreview } from '../CitationPdfPreview';

vi.mock('../../hooks/useCitationPreview', () => ({
  useCitationPreview: vi.fn(() => ({ blobUrl: 'blob:fake', refresh: vi.fn(), isRendering: false })),
}));

// Force desktop viewport for these tests
vi.mock('../../hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(() => false),
  default: vi.fn(() => false),
}));

describe('CitationPdfPreview', () => {
  it('renders nothing visible in modal mode until Preview button clicked', () => {
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={() => {}} />);
    expect(screen.queryByTitle(/Citation preview/i)).not.toBeInTheDocument();
  });

  it('Preview button opens modal iframe', () => {
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    expect(screen.getByTitle(/Citation preview/i)).toBeInTheDocument();
  });

  it('side mode renders iframe inline (always visible)', () => {
    render(<CitationPdfPreview form={{}} mode="side" onModeChange={() => {}} />);
    expect(screen.getByTitle(/Citation preview/i)).toBeInTheDocument();
  });

  it('mode toggle buttons call onModeChange', () => {
    const onModeChange = vi.fn();
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Side/i }));
    expect(onModeChange).toHaveBeenCalledWith('side');
  });
});
