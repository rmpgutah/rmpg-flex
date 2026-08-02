import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OsmFeatureEditor from '../OsmFeatureEditor';
import type { OsmOverride } from '../../hooks/useOsmOverrides';

const override = (p: Partial<OsmOverride> = {}): OsmOverride => ({
  osm_id: 'n83099358', group: 'safety', cat: 'hydrant', note: null, fields: {},
  hidden: false, verified: false, verified_at: null, updated_at: '2026-08-02 00:00:00', ...p,
});

const setup = (props: Partial<React.ComponentProps<typeof OsmFeatureEditor>> = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onClear = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <OsmFeatureEditor
      osmId="n83099358"
      group="safety"
      cat="hydrant"
      categoryLabel="Fire hydrants"
      osmTags={{ colour: 'yellow', operator: 'SLC Water' }}
      onSave={onSave}
      onClear={onClear}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSave, onClear, onClose };
};

beforeEach(() => vi.clearAllMocks());

describe('OsmFeatureEditor', () => {
  it('states plainly that it does not change OpenStreetMap', () => {
    setup();
    expect(screen.getByText(/does not change OpenStreetMap/i)).toBeInTheDocument();
  });

  it('only offers tags the feature actually has', () => {
    // A hydrant has no camera bearing; offering one invites nonsense data.
    setup();
    expect(screen.getByLabelText(/Colour/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Facing/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Camera covers/i)).not.toBeInTheDocument();
  });

  it('shows the current OSM value beside each correctable field', () => {
    setup();
    expect(screen.getByText(/OSM: yellow/)).toBeInTheDocument();
  });

  it('sends only fields that DIFFER from the OSM value', async () => {
    // Persisting an unchanged value would mark the field "Corrected by RMPG"
    // in the popup and misattribute OSM's own data to us.
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText(/Colour/i), { target: { value: 'yellow' } });
    fireEvent.change(screen.getByLabelText(/Operator/i), { target: { value: 'RMPG' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].fields).toEqual({ operator: 'RMPG' });
  });

  it('sends an empty note as null rather than an empty string', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].note).toBeNull();
  });

  it('saves the note, verified and hidden flags', async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText(/Operational note/i), {
      target: { value: 'Capped — out of service' },
    });
    fireEvent.click(screen.getByLabelText(/Verified on the ground/i));
    fireEvent.click(screen.getByLabelText(/Hide from the map/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls[0][0];
    expect(patch.note).toBe('Capped — out of service');
    expect(patch.verified).toBe(true);
    expect(patch.hidden).toBe(true);
    expect(patch.group).toBe('safety');
  });

  it('warns that hiding affects every user and does not delete the OSM record', () => {
    setup();
    fireEvent.click(screen.getByLabelText(/Hide from the map/i));
    expect(screen.getByText(/not deleted/i)).toBeInTheDocument();
  });

  it('seeds from an existing override', () => {
    setup({ existing: override({ note: 'Prior note', fields: { colour: 'red' }, verified: true }) });
    expect(screen.getByLabelText(/Operational note/i)).toHaveValue('Prior note');
    expect(screen.getByLabelText(/Colour/i)).toHaveValue('red');
    expect(screen.getByLabelText(/Verified on the ground/i)).toBeChecked();
  });

  it('offers Remove override only when one exists', () => {
    setup();
    expect(screen.queryByRole('button', { name: /remove override/i })).not.toBeInTheDocument();
    setup({ existing: override({ note: 'x' }) });
    expect(screen.getByRole('button', { name: /remove override/i })).toBeInTheDocument();
  });

  it('surfaces a save failure instead of closing as if it worked', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('D1 unavailable'));
    const onClose = vi.fn();
    render(
      <OsmFeatureEditor
        osmId="n1" group="safety" osmTags={{}}
        onSave={onSave} onClear={vi.fn()} onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('D1 unavailable'));
    expect(onClose, 'must not close on failure').not.toHaveBeenCalled();
  });

  it('links to the canonical OSM record with the right element type', () => {
    setup();
    expect(screen.getByRole('link', { name: /n83099358/ }))
      .toHaveAttribute('href', 'https://www.openstreetmap.org/node/83099358');
  });

  it('re-seeds when pointed at a different feature', () => {
    const { rerender } = render(
      <OsmFeatureEditor osmId="n1" group="safety" osmTags={{}}
        existing={override({ osm_id: 'n1', note: 'first' })}
        onSave={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Operational note/i)).toHaveValue('first');
    rerender(
      <OsmFeatureEditor osmId="n2" group="safety" osmTags={{}}
        existing={override({ osm_id: 'n2', note: 'second' })}
        onSave={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} />,
    );
    // Without a re-seed the previous feature's edits bleed into the next one.
    expect(screen.getByLabelText(/Operational note/i)).toHaveValue('second');
  });
});
