import { describe, it, expect } from 'vitest';
import { routeForEntity, hasDeepLink } from '../notificationRouting';

describe('notificationRouting', () => {
  describe('routeForEntity', () => {
    it('prefers entity_type+entity_id over type when both are present', () => {
      // A "watchlist_hit" notification with entity_type='person' should
      // land on /records?tab=persons&person_id=42, not /intel.
      expect(routeForEntity({ type: 'watchlist_hit', entity_type: 'person', entity_id: 42 }))
        .toBe('/records?tab=persons&person_id=42');
    });

    it('builds /dispatch?call_id= for call entity_type', () => {
      expect(routeForEntity({ type: 'dispatch', entity_type: 'call', entity_id: 7 }))
        .toBe('/dispatch?call_id=7');
    });

    it('builds /warrants?warrant_id= for warrant entity_type', () => {
      expect(routeForEntity({ type: 'warrant', entity_type: 'warrant', entity_id: 99 }))
        .toBe('/warrants?warrant_id=99');
    });

    it('builds /serve?job_id= for serve_job entity_type', () => {
      expect(routeForEntity({ type: 'serve_nudge', entity_type: 'serve_job', entity_id: 123 }))
        .toBe('/serve?job_id=123');
    });

    it('builds /communications?tab=bolos&bolo_id= for bolo entity_type', () => {
      expect(routeForEntity({ type: 'bolo', entity_type: 'bolo', entity_id: 5 }))
        .toBe('/communications?tab=bolos&bolo_id=5');
    });

    it('builds /arrest-records?arrest_id= for arrest_record entity_type', () => {
      // Page 43 audit added arrest-record deep-link routing so a
      // "booking processed" or "criminal-history hit" notification lands
      // on the actual booking detail panel instead of a generic page.
      expect(routeForEntity({ type: 'system', entity_type: 'arrest_record', entity_id: 250 }))
        .toBe('/arrest-records?arrest_id=250');
      // Short alias for any older server emitter that uses `arrest`.
      expect(routeForEntity({ type: 'system', entity_type: 'arrest', entity_id: 250 }))
        .toBe('/arrest-records?arrest_id=250');
    });

<<<<<<< HEAD
    it('builds /court-records?event_id= for court_event entity_type', () => {
      // Page 54 audit added court_event routing so a "hearing reminder",
      // "outcome recorded", or "continuance granted" notification lands
      // on the actual docket entry instead of a generic page.
      expect(routeForEntity({ type: 'system', entity_type: 'court_event', entity_id: 7 }))
        .toBe('/court-records?event_id=7');
      // Confirms the deep-link param matches what CourtRecordsPage's
      // useSearchParams hook reads (`event_id` / `court_event_id`); the
      // canonical emitter writes `court_event` so we always land on the
      // historical disposition view, and operators can pivot to /court
      // for upcoming-dates via the in-page "Tracker" button.
=======
    it('builds /web-research?research_id= for research_result entity_type', () => {
      // Page 61 audit added web-research deep-link routing so a future
      // "research result for monitored subject" notification lands on
      // the Saved Results tab with the matching row highlighted.
      expect(routeForEntity({ type: 'system', entity_type: 'research_result', entity_id: 17 }))
        .toBe('/web-research?research_id=17');
      // Short alias for any server emitter that uses `web_research`.
      expect(routeForEntity({ type: 'system', entity_type: 'web_research', entity_id: 17 }))
        .toBe('/web-research?research_id=17');
>>>>>>> origin/claude/page-61-web-research-improvements
    });

    it('falls back to type-default when entity_type is unknown', () => {
      expect(routeForEntity({ type: 'warrant', entity_type: 'something_new', entity_id: 1 }))
        .toBe('/warrants');
    });

    it('falls back to type-default when entity_id is missing', () => {
      expect(routeForEntity({ type: 'dispatch', entity_type: 'call', entity_id: null }))
        .toBe('/dispatch');
    });

    it('returns null for an unknown type with no entity', () => {
      expect(routeForEntity({ type: 'totally_made_up' })).toBeNull();
    });

    it('routes message → /communications?tab=messages', () => {
      expect(routeForEntity({ type: 'message' })).toBe('/communications?tab=messages');
    });

    it('routes credential_expiry → /personnel', () => {
      expect(routeForEntity({ type: 'credential_expiry' })).toBe('/personnel');
    });

    it('routes patrol_missed → /patrol', () => {
      expect(routeForEntity({ type: 'patrol_missed' })).toBe('/patrol');
    });

    it('builds /affairs?complaint_id= for ia_complaint entity_type', () => {
      // IA complaint deep-link contract added v1070. Notification routing
      // should land the supervisor directly on the complaint, not the IA
      // landing list.
      expect(routeForEntity({ type: 'system', entity_type: 'ia_complaint', entity_id: 17 }))
        .toBe('/affairs?complaint_id=17');
    });

    it('builds /affairs?investigation_id= for ia_investigation entity_type', () => {
      expect(routeForEntity({ type: 'system', entity_type: 'ia_investigation', entity_id: 8 }))
        .toBe('/affairs?investigation_id=8');
    });

    it('url-encodes the entity id (guards against an id like "1/2")', () => {
      // No realistic id will contain a slash, but the helper still has
      // to be safe against one because the id type is `string | number`
      // and a server with a string-id schema could legitimately produce
      // something like a UUID that ends up encoded.
      expect(routeForEntity({ type: 'warrant', entity_type: 'warrant', entity_id: 'abc/def' }))
        .toBe('/warrants?warrant_id=abc%2Fdef');
    });
  });

  describe('hasDeepLink', () => {
    it('returns true when an entity route is known', () => {
      expect(hasDeepLink({ type: 'warrant', entity_type: 'warrant', entity_id: 1 })).toBe(true);
    });
    it('returns true when only the type route is known', () => {
      expect(hasDeepLink({ type: 'dispatch' })).toBe(true);
    });
    it('returns false when nothing is known', () => {
      expect(hasDeepLink({ type: 'novel_event_type_no_one_routed_yet' })).toBe(false);
    });
  });
});
