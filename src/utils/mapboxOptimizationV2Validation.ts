import { z } from 'zod';
import type { V2ProblemDocument } from './mapboxOptimizationV2';

const ids = z.array(z.number().int().positive()).min(1).max(999).refine(a => new Set(a).size === a.length, 'IDs must be unique');
const timestamp = z.iso.datetime({ offset: true });
const objective = z.enum(['min-schedule-completion-time', 'min-total-travel-duration']).optional();
const common = { objective, circular: z.boolean().optional() };
const windowSchema = z.object({ earliest: timestamp, latest: timestamp, type: z.enum(['strict', 'soft', 'soft_start', 'soft_end']).optional() })
  .refine(w => Date.parse(w.earliest) < Date.parse(w.latest), 'Window end must follow start');
const dimensions = z.record(z.string().min(1), z.number().nonnegative());
const strings = z.array(z.string().min(1).max(100)).max(50);
export const fleetProblemSchema = z.object({
  version: z.literal(1),
  locations: z.array(z.object({ name: z.string().min(1), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) })).min(1).max(1000),
  vehicles: z.array(z.object({
    name: z.string().min(1), routing_profile: z.enum(['mapbox/driving', 'mapbox/driving-traffic', 'mapbox/walking', 'mapbox/cycling']).optional(),
    start_location: z.string().optional(), end_location: z.string().optional(), earliest_start: timestamp.optional(), latest_end: timestamp.optional(),
    capabilities: strings.optional(), capacities: dimensions.optional(), loading_policy: z.enum(['any', 'fifo', 'lifo']).optional(),
    breaks: z.array(z.object({ earliest_start: timestamp, latest_end: timestamp, duration: z.number().int().positive() })).max(10).optional(),
  })).min(1).max(100),
  services: z.array(z.object({ name: z.string().min(1), location: z.string(), duration: z.number().int().nonnegative().optional(), requirements: strings.optional(), service_times: z.array(windowSchema).max(1).optional() })).max(1000).default([]),
  shipments: z.array(z.object({ name: z.string().min(1), from: z.string(), to: z.string(), size: dimensions.optional(), requirements: strings.optional(),
    pickup_duration: z.number().int().nonnegative().optional(), dropoff_duration: z.number().int().nonnegative().optional(),
    pickup_times: z.array(windowSchema).max(1).optional(), dropoff_times: z.array(windowSchema).max(1).optional(),
  })).max(1000).optional(),
  options: z.object({ objectives: z.array(z.enum(['min-schedule-completion-time', 'min-total-travel-duration'])).length(1).optional() }).optional(),
});
export const optimizationSubmitSchema = z.discriminatedUnion('job_type', [
  z.object({ job_type: z.literal('fleet_route'), problem: fleetProblemSchema }),
  z.object({ job_type: z.literal('serve_run'), serve_queue_ids: ids, officer_unit_id: z.number().int().positive().optional(),
    shift_start: timestamp, shift_end: timestamp, ref_id: z.number().int().positive().nullable().optional(),
    origin: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
    requirements: z.array(z.string().min(1).max(100)).max(50).optional(), ...common }),
  z.object({ job_type: z.literal('patrol_beat'), beat_ids: ids, unit_ids: ids, shift_start: timestamp, shift_end: timestamp, ...common }),
  z.object({ job_type: z.literal('multi_unit_dispatch'), call_ids: ids, unit_ids: ids, objective }),
]).refine(p => !('shift_start' in p) || Date.parse(p.shift_start) < Date.parse(p.shift_end), 'Shift end must follow shift start');

export function validateOptimizationProblem(problem: V2ProblemDocument): void {
  if (!(problem.services.length || problem.shipments?.length) || !problem.vehicles.length || problem.locations.length > 1000) throw new Error('Optimization requires services and vehicles, with at most 1000 locations');
  for (const collection of [problem.locations, problem.vehicles, problem.services, problem.shipments ?? []]) {
    if (new Set(collection.map(v => v.name)).size !== collection.length) throw new Error('Optimization names must be unique');
  }
  for (const location of problem.locations) {
    const [lng, lat] = location.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error('All locations require valid coordinates');
  }
  const locations = new Set(problem.locations.map(l => l.name));
  const references = [...problem.services.map(s => s.location), ...(problem.shipments ?? []).flatMap(s => [s.from, s.to]), ...problem.vehicles.flatMap(v => [v.start_location, v.end_location].filter((n): n is string => n !== undefined))];
  if (references.some(r => !locations.has(r))) throw new Error('Unknown location reference');
  for (const vehicle of problem.vehicles) {
    if (vehicle.earliest_start && vehicle.latest_end && Date.parse(vehicle.earliest_start) >= Date.parse(vehicle.latest_end)) throw new Error('Invalid vehicle shift');
    for (const b of vehicle.breaks ?? []) {
      if (Date.parse(b.latest_end) - Date.parse(b.earliest_start) < b.duration * 1000 ||
          (vehicle.earliest_start && Date.parse(b.earliest_start) < Date.parse(vehicle.earliest_start)) ||
          (vehicle.latest_end && Date.parse(b.latest_end) > Date.parse(vehicle.latest_end))) throw new Error('Break must fit inside vehicle shift');
    }
  }
  const datetimeRe = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(([+-]\d\d:\d\d)|Z)$/;
  for (const service of problem.services) {
    for (const window of service.service_times ?? []) {
      if (!datetimeRe.test(window.earliest) || !datetimeRe.test(window.latest)) throw new Error(`Invalid time window for ${service.name}: timestamps must be ISO 8601 with timezone`);
      if (!Number.isFinite(Date.parse(window.earliest)) || !Number.isFinite(Date.parse(window.latest)) || Date.parse(window.earliest) >= Date.parse(window.latest)) throw new Error(`Invalid time window for ${service.name}`);
    }
  }
}
