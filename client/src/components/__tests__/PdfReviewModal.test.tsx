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

const richSchema: FormSchema<{
  name: string;
  active: boolean;
  notes: string;
  items: Array<{ label: string; qty: string }>;
  sig?: any;
}> = {
  meta: { formNumber: 'PS-TEST', title: 'TEST', revision: 'R1' },
  header: { kind: 'default', formId: 'test' },
  sections: [
    { kind: 'section', title: 'BASIC', fields: [
      { kind: 'labeled',   label: 'Name',   accessor: d => d.name,   path: 'name' },
      { kind: 'checkbox',  label: 'Active', accessor: d => d.active, path: 'active' },
      { kind: 'narrative', label: 'Notes',  accessor: d => d.notes,  path: 'notes' },
      { kind: 'table',     label: 'Items',
        columns: [
          { key: 'label', header: 'Label', width: 'half' },
          { key: 'qty',   header: 'Qty',   width: 'half' },
        ],
        accessor: d => d.items, path: 'items',
      },
      { kind: 'signature', label: 'Officer', accessor: d => d.sig, path: 'sig' },
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

  it('renders checkbox, narrative, and table editors for their field kinds', () => {
    render(
      <PdfReviewModal
        open schema={richSchema}
        initialData={{ name: 'Jones', active: true, notes: 'Hello', items: [{ label: 'A', qty: '1' }] }}
        onClose={() => {}} onCommit={() => {}}
      />
    );
    // checkbox input with matching label
    const activeCheckbox = screen.getByLabelText('Active') as HTMLInputElement;
    expect(activeCheckbox.type).toBe('checkbox');
    expect(activeCheckbox.checked).toBe(true);

    // narrative textarea
    const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    expect(notes.tagName).toBe('TEXTAREA');
    expect(notes.value).toBe('Hello');

    // table header + one row
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Qty')).toBeInTheDocument();
    expect(screen.getByLabelText('Items row 1 Label')).toBeInTheDocument();
  });

  it('toggling a checkbox propagates to onCommit', async () => {
    const onCommit = vi.fn();
    render(
      <PdfReviewModal
        open schema={richSchema}
        initialData={{ name: 'Jones', active: false, notes: '', items: [] }}
        onClose={() => {}} onCommit={onCommit}
      />
    );
    await userEvent.click(screen.getByLabelText('Active'));
    await userEvent.click(screen.getByText('Commit: Download'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ active: true }),
      'download',
    );
  });

  it('adding a table row and editing it propagates on commit', async () => {
    const onCommit = vi.fn();
    render(
      <PdfReviewModal
        open schema={richSchema}
        initialData={{ name: 'Jones', active: false, notes: '', items: [] }}
        onClose={() => {}} onCommit={onCommit}
      />
    );
    await userEvent.click(screen.getByLabelText('Add row to Items'));
    const labelCell = screen.getByLabelText('Items row 1 Label') as HTMLInputElement;
    await userEvent.type(labelCell, 'widget');
    await userEvent.click(screen.getByText('Commit: Download'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ label: 'widget', qty: '' }],
      }),
      'download',
    );
  });

  it('signature field renders a placeholder', () => {
    render(
      <PdfReviewModal
        open schema={richSchema}
        initialData={{ name: 'Jones', active: false, notes: '', items: [] }}
        onClose={() => {}} onCommit={() => {}}
      />
    );
    expect(screen.getByText('Signature editor coming soon')).toBeInTheDocument();
  });
});
