import { describe, it, expect, vi, beforeEach } from 'vitest';
import adasis from '../src/routes/adasis';

describe('ADASIS v3 Electronic Horizon Routes', () => {
  let mockDb: any;
  let env: any;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      all: vi.fn(),
      run: vi.fn(),
    };
    env = { DB: mockDb };
  });

  describe('GET /provider/segment/:segmentId', () => {
    it('returns 404 when segment is not found', async () => {
      mockDb.first.mockResolvedValueOnce(null);
      const res = await adasis.request('/provider/segment/seg_unknown', {}, env);
      expect(res.status).toBe(404);
      const data = await res.json() as any;
      expect(data.error).toBe('Segment not found');
    });

    it('returns parsed segment attributes when found', async () => {
      mockDb.first.mockResolvedValueOnce({
        segment_id: 'seg_123',
        road_name: 'State St',
        road_class: 'primary',
        speed_limit_kmh: 65,
        num_lanes: 4,
        curvature_data: '[{"offset":0,"curvature":0.001}]',
        gradient_data: '[{"offset":0,"gradient":1.5}]',
        has_tunnel: 0,
        has_bridge: 1,
        jurisdiction: 'Salt Lake City',
      });

      const res = await adasis.request('/provider/segment/seg_123', {}, env);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.segment_id).toBe('seg_123');
      expect(data.road_name).toBe('State St');
      expect(data.speed_limit_kmh).toBe(65);
      expect(data.curvature_data).toEqual([{ offset: 0, curvature: 0.001 }]);
      expect(data.has_bridge).toBe(true);
    });
  });

  describe('POST /consumer/position', () => {
    it('requires position coordinates and unit/vehicle IDs', async () => {
      const res = await adasis.request('/consumer/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: 1 }),
      }, env);
      expect(res.status).toBe(400);
    });

    it('upserts vehicle horizon state', async () => {
      mockDb.run.mockResolvedValueOnce({ success: true });
      const res = await adasis.request('/consumer/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_id: 10,
          unit_id: 101,
          position_lat: 40.7608,
          position_lng: -111.8910,
          speed_kmh: 55,
          current_segment_id: 'seg_123',
          next_speed_limit: 65,
        }),
      }, env);

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.vehicle_id).toBe(10);
    });
  });

  describe('POST /consumer/alert', () => {
    it('validates alert parameters', async () => {
      const res = await adasis.request('/consumer/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: 1 }),
      }, env);
      expect(res.status).toBe(400);
    });

    it('logs safety alert and confirms receipt', async () => {
      const res = await adasis.request('/consumer/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: 101,
          alert_type: 'sharp_curve',
          message: 'Sharp right curve in 200m',
          distance_m: 200,
        }),
      }, env);

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.received_at).toBeDefined();
    });
  });

  describe('GET /horizon/vehicle/:unitId', () => {
    it('returns 404 if no horizon state exists', async () => {
      mockDb.first.mockResolvedValueOnce(null);
      const res = await adasis.request('/horizon/vehicle/999', {}, env);
      expect(res.status).toBe(404);
    });

    it('returns latest horizon context for unit', async () => {
      mockDb.first.mockResolvedValueOnce({
        unit_id: 101,
        position_lat: 40.7608,
        position_lng: -111.8910,
        current_segment_id: 'seg_123',
        distance_to_next_curve_m: 250,
      });

      const res = await adasis.request('/horizon/vehicle/101', {}, env);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.horizon.unit_id).toBe(101);
      expect(data.horizon.distance_to_next_curve_m).toBe(250);
    });
  });
});
