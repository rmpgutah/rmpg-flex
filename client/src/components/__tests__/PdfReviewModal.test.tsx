import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PdfReviewModal } from '../PdfReviewModal';
import type { FormSchema } from '../../utils/pdf/v2/engine/types';

const schema: FormSchema<{ name: string }> = {
  meta: { formNumber: 'PS-TEST', title: 'TEST', revision: 'R1' },
  header: { kind: 'default', formId: 'test' },
  sections: [
    { kind: 'section', title: 'BASIC', fields: [
      { kind: 'labeled', label: 'Name', accessor: d => d.name, path: 'name' },
    ]},
  ],
};

describe('PdfReviewModal', () => {
  it('renders section title and editable input for labeled field', () => {
    render(
      <PdfReviewModal open schema={schema} initialData={{ name: 'Jones' }}
        onClose={() => {}} onCommit={() => {}} />
    );
    expect(screen.getByText('BASIC')).toBeInTheDocument();
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Jones');
  });

  it('does not render when open=false', () => {
    const { container } = render(
      <PdfReviewModal open={false} schema={schema} initialData={{ name: 'x' }}
        onClose={() => {}} onCommit={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <PdfReviewModal open schema={schema} initialData={{ name: 'Jones' }}
        onClose={onClose} onCommit={() => {}} />
    );
    await userEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onCommit with updated data after user types in a labeled field', async () => {
    const onCommit = vi.fn();
    render(
      <PdfReviewModal open schema={schema} initialData={{ name: 'Jones' }}
        onClose={() => {}} onCommit={onCommit} />
    );
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Smith');
    await userEvent.click(screen.getByText('Commit: Download'));
    expect(onCommit).toHaveBeenCalledWith({ name: 'Smith' }, 'download');
  });

  it('renders a live PDF iframe after the debounce window', async () => {
    // Stub URL.createObjectURL since jsdom doesn't implement it
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    try {
      render(
        <PdfReviewModal open schema={schema} initialData={{ name: 'Jones' }}
          onClose={() => {}} onCommit={() => {}} />
      );

      const iframe = await screen.findByTitle('pdf-preview', {}, { timeout: 2000 });
      expect(iframe).toBeInTheDocument();
      await waitFor(() => {
        expect(iframe.getAttribute('src')).toBe('blob:mock-url');
      });
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
