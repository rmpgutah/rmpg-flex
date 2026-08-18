import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MapContext } from '../../MapContext';
import type { MapContextValue } from '../../MapContext';
import AssignmentArcLayer from '../AssignmentArcLayer';

const baseCtx: MapContextValue = { map: null, units: [], calls: [], beats: [] };

describe('AssignmentArcLayer', () => {
  it('renders without error when map is null', () => {
    expect(() =>
      render(
        <MapContext.Provider value={baseCtx}>
          <AssignmentArcLayer />
        </MapContext.Provider>
      )
    ).not.toThrow();
  });

  it('renders without error with units lacking assignments', () => {
    const units: MapContextValue['units'] = [{
      id: '1',
      call_sign: 'U1',
      officer_name: '',
      status: 'available',
      latitude: 40.7,
      longitude: -111.9,
      vehicle: '',
      current_call_id: null,
      call_number: null,
      current_call_type: null,
      current_call_location: null,
    }];
    expect(() =>
      render(
        <MapContext.Provider value={{ ...baseCtx, units }}>
          <AssignmentArcLayer />
        </MapContext.Provider>
      )
    ).not.toThrow();
  });
});
