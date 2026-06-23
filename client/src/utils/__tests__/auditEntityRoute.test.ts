import { describe, it, expect } from 'vitest';
import { getAuditEntityRoute } from '../auditEntityRoute';

describe('getAuditEntityRoute', () => {
  it('returns null when entity_type is missing', () => {
    expect(getAuditEntityRoute(null, '47')).toBeNull();
    expect(getAuditEntityRoute(undefined, '47')).toBeNull();
    expect(getAuditEntityRoute('', '47')).toBeNull();
  });

  it('returns null when entity_id is missing', () => {
    expect(getAuditEntityRoute('warrant', null)).toBeNull();
    expect(getAuditEntityRoute('warrant', undefined)).toBeNull();
    expect(getAuditEntityRoute('warrant', '')).toBeNull();
    expect(getAuditEntityRoute('warrant', '   ')).toBeNull();
  });

  it('accepts numeric ids and string ids interchangeably', () => {
    const a = getAuditEntityRoute('warrant', 47);
    const b = getAuditEntityRoute('warrant', '47');
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it('treats entity_id="0" as routable (rare but legitimate)', () => {
    const r = getAuditEntityRoute('warrant', '0');
    expect(r).not.toBeNull();
    expect(r?.path).toContain('warrant_id=0');
  });

  it('maps a warrant to the Warrants deep-link', () => {
    const r = getAuditEntityRoute('warrant', 47);
    expect(r).toEqual({ label: 'Open warrant', path: '/warrants?warrant_id=47' });
  });

  it('is case-insensitive on entity_type', () => {
    expect(getAuditEntityRoute('WARRANT', 47)).toEqual(
      getAuditEntityRoute('warrant', 47),
    );
    expect(getAuditEntityRoute('Person', 12)?.path).toContain('records');
  });

  it('tolerates the plural form recorded by some routes', () => {
    // src/routes mixes "warrant"/"warrants" and "person"/"persons".
    expect(getAuditEntityRoute('warrants', 47)?.path).toContain('warrant_id=47');
    expect(getAuditEntityRoute('persons', 12)?.path).toContain('person_id=12');
  });

  it('routes Records tabs to the right ?tab= + ?<entity>_id= pair', () => {
    expect(getAuditEntityRoute('person', 1)?.path).toBe('/records?tab=persons&person_id=1');
    expect(getAuditEntityRoute('vehicle', 2)?.path).toBe('/records?tab=vehicles&vehicle_id=2');
    expect(getAuditEntityRoute('property', 3)?.path).toBe('/records?tab=properties&property_id=3');
    expect(getAuditEntityRoute('business', 4)?.path).toBe('/records?tab=businesses&business_id=4');
  });

  it('routes evidence to its dedicated page (not the Records tab)', () => {
    expect(getAuditEntityRoute('evidence', 5)?.path).toBe('/evidence?evidence_id=5');
    expect(getAuditEntityRoute('evidence_item', 5)?.path).toBe('/evidence?evidence_id=5');
  });

  it('routes a call to MDT', () => {
    expect(getAuditEntityRoute('call', 99)?.path).toBe('/mdt?call_id=99');
    expect(getAuditEntityRoute('calls_for_service', 99)?.path).toBe('/mdt?call_id=99');
    expect(getAuditEntityRoute('cfs', 99)?.path).toBe('/mdt?call_id=99');
  });

  it('routes incident / citation / case / dar / fi to their pages', () => {
    expect(getAuditEntityRoute('incident', 1)?.path).toBe('/incidents?incident_id=1');
    expect(getAuditEntityRoute('citation', 1)?.path).toBe('/citations?citation_id=1');
    expect(getAuditEntityRoute('case', 1)?.path).toBe('/cases?case_id=1');
    expect(getAuditEntityRoute('dar', 1)?.path).toBe('/dar?dar_id=1');
    expect(getAuditEntityRoute('fi', 1)?.path).toBe('/field-interviews?fi_id=1');
    expect(getAuditEntityRoute('field_interview', 1)?.path).toBe('/field-interviews?fi_id=1');
  });

  it('routes serve queue and trespass orders', () => {
    expect(getAuditEntityRoute('serve_queue', 11)?.path).toBe('/serve?job_id=11');
    expect(getAuditEntityRoute('process_serve', 11)?.path).toBe('/serve?job_id=11');
    expect(getAuditEntityRoute('trespass_order', 22)?.path).toBe('/trespass-orders?order_id=22');
  });

  it('routes dashcam and bodycam', () => {
    expect(getAuditEntityRoute('dashcam_video', 7)?.path).toBe('/dash-cameras?clip_id=7');
    expect(getAuditEntityRoute('mvr', 7)?.path).toBe('/dash-cameras?clip_id=7');
    expect(getAuditEntityRoute('bodycam_video', 8)?.path).toBe('/body-cameras?video_id=8');
    expect(getAuditEntityRoute('bwc', 8)?.path).toBe('/body-cameras?video_id=8');
  });

  it('routes inmate / jail booking to Jail', () => {
    expect(getAuditEntityRoute('inmate', 33)?.path).toBe('/jail?inmate_id=33');
    expect(getAuditEntityRoute('jail_booking', 33)?.path).toBe('/jail?inmate_id=33');
  });

  it('routes user to Personnel', () => {
    expect(getAuditEntityRoute('user', 5)?.path).toBe('/personnel?user_id=5');
  });

  it('routes task / task_assignment to the Tasks page', () => {
    expect(getAuditEntityRoute('task', 83)?.path).toBe('/tasks?task_id=83');
    expect(getAuditEntityRoute('task_assignment', 83)?.path).toBe('/tasks?task_id=83');
    expect(getAuditEntityRoute('tasks', 83)?.path).toBe('/tasks?task_id=83');
    expect(getAuditEntityRoute('TASK', 83)?.label).toBe('Open task');
  });

  it('returns null for non-routable system entity types', () => {
    expect(getAuditEntityRoute('system', '1')).toBeNull();
    expect(getAuditEntityRoute('config', '1')).toBeNull();
    expect(getAuditEntityRoute('audit', '1')).toBeNull();
    expect(getAuditEntityRoute('unit', '1')).toBeNull();
    expect(getAuditEntityRoute('alpr_capture', '1')).toBeNull();
    expect(getAuditEntityRoute('field_photo', '1')).toBeNull();
    expect(getAuditEntityRoute('fleet_vehicle', '1')).toBeNull();
  });

  it('returns null for unrecognized entity_type values', () => {
    expect(getAuditEntityRoute('mystery_widget', '1')).toBeNull();
  });

  it('url-encodes entity_id values containing special characters', () => {
    // entity_id is TEXT in the DB; some routes write composite ids like "AB-12/x".
    const r = getAuditEntityRoute('warrant', 'AB/12');
    expect(r?.path).toBe('/warrants?warrant_id=AB%2F12');
  });
});
