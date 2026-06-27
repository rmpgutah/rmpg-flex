// ============================================================
// ALPR Integration Usage Guide
// ============================================================
// alprleaks has been integrated into RMPGFlex as a reusable
// utility module + HTTP API surface.
//
// NOTE: Most Motorola ALPRs were taken offline following media
// reports and Motorola's security remediation (January 2025).
// This integration is maintained for historical/research purposes.

// ─── Module API (src/utils/alprleaks/collector.ts) ─────────

import { ALPRCollector, type ALPRHit } from '@/utils/alprleaks/collector';

// Create a collector for a single ALPR system
const collector = new ALPRCollector('166.152.44.39', 5001);

// Connect and begin streaming hits; each hit is passed to the callback
await collector.connect(
  async (hit: ALPRHit) => {
    console.log('New ALPR hit:', {
      plate: hit.licensePlateNumber,
      vehicle: `${hit.make} ${hit.model} ${hit.color}`,
      system: hit.systemId,
      time: hit.timestamp,
    });
    
    // Persist to database (example)
    // await db.prepare(
    //   `INSERT INTO alpr_hits (...) VALUES (...)`
    // ).bind(...).run();
  },
  (err) => {
    console.error('Collector error:', err.message);
  }
);

// Clean up when done
// collector.disconnect();

// ─── HTTP API (src/routes/alpr.ts) ────────────────────────

/**
 * GET /api/alpr/summary
 * Returns aggregated statistics from collected hits.
 * 
 * Response:
 *   {
 *     total_hits: number,
 *     unique_plates: number,
 *     active_systems: number,
 *     vehicle_makes: number
 *   }
 */

/**
 * GET /api/alpr/hits?limit=50&offset=0&plate=ABC&system=166.152.44.39
 * Returns paginated ALPR records.
 * 
 * Query params:
 *   - limit: max 500 (default 50)
 *   - offset: pagination cursor (default 0)
 *   - plate: optional license plate filter (substring match)
 *   - system: optional system ID filter (exact match)
 * 
 * Response:
 *   {
 *     hits: [
 *       {
 *         id: number,
 *         uuid: string,
 *         system_id: string,
 *         timestamp: string,
 *         make: string,
 *         model: string,
 *         color: string,
 *         license_plate: string
 *       },
 *       ...
 *     ],
 *     count: number
 *   }
 */

/**
 * GET /api/alpr/systems
 * Returns list of monitored ALPR systems and their activity.
 * 
 * Response:
 *   [
 *     {
 *       system_id: string,
 *       hit_count: number,
 *       last_hit: string (ISO 8601)
 *     },
 *     ...
 *   ]
 */

/**
 * GET /api/alpr/hits/:uuid/image
 * Returns the JPEG image for a specific ALPR hit.
 * 
 * Response: image/jpeg binary data (HTTP 200)
 *           or { error: 'Image not found' } (HTTP 404)
 */

/**
 * POST /api/alpr/hits
 * Admin endpoint: Record a new ALPR hit manually or via external collector.
 * Requires admin authentication (enforced by router registration).
 * 
 * Request body:
 *   {
 *     uuid: string (unique identifier),
 *     system_id: string,
 *     make: string,
 *     model: string,
 *     color: string,
 *     license_plate: string (required),
 *     jpeg_data?: Buffer (optional)
 *   }
 * 
 * Response:
 *   { success: true, id: number }
 *   or { error: string } (HTTP 400/409/500)
 */

// ─── Integration Notes ─────────────────────────────────────

/**
 * 1. Database
 *    The migration 0161_alpr_hits.mjs creates the alpr_hits table
 *    with:
 *      - uuid (unique, primary key)
 *      - system_id, timestamp, make, model, color, license_plate
 *      - jpeg_data (BLOB for image storage)
 *      - created_at (auto-populated)
 *    Indexes on system_id, license_plate, and timestamp for fast queries.
 *
 * 2. Monitoring Systems
 *    The default motorola-ip-addresses.json list contains 150+ known
 *    Motorola ALPR IP addresses exposed via Shodan. Most are now offline
 *    (January 2025 remediation). To add new systems:
 *    - Pass systemId (IP address) to ALPRCollector constructor
 *    - Default port is 5001 (DATA_PORT); can be overridden
 *
 * 3. Admin Usage
 *    - Admin dashboard: create a new page component viewing
 *      GET /api/alpr/hits + GET /api/alpr/systems
 *    - Summary tile: display /api/alpr/summary stats
 *    - Image gallery: loop hits and show GET /api/alpr/hits/:uuid/image
 *
 * 4. Intelligence Integration
 *    Consider linking collected plates to:
 *    - Existing intelligence records (persons_vehicles, stolen plates)
 *    - Dispatch call history (nearby time/location)
 *    - NIBRS reports for correlation
 */
