/**
 * Payload normalization for POST /api/process-server/routes.
 *
 * `serve_routes.optimized_order_json` / `.waypoints_json` are TEXT columns
 * holding a JSON array. Two caller spellings exist in the wild:
 *
 *   - `optimized_order_json` — an ALREADY-STRINGIFIED array. This is what the
 *     live client sends (ServeRoutePlanner's "Apply Route"), and it matches the
 *     column name, so it is the canonical spelling.
 *   - `optimized_order` — a raw array. Older/other callers.
 *
 * The route handler originally read only the bare spelling, so every route the
 * planner applied stored the literal "[]" and the Route tab had no stops to
 * render. Reading only the *_json spelling would break the other callers, and
 * blindly `JSON.stringify`-ing the *_json value would double-encode it into
 * `"\"[1,2]\""` — which parses back to a STRING, not an array, so the Route tab
 * would still find nothing iterable. Hence: pass strings through untouched,
 * encode objects/arrays once, and fall back to the bare key.
 */
export function routeJsonColumn(jsonForm: unknown, arrayForm: unknown): string {
  if (typeof jsonForm === 'string' && jsonForm.trim() !== '') return jsonForm;
  if (jsonForm != null && typeof jsonForm === 'object') return JSON.stringify(jsonForm);
  return JSON.stringify(arrayForm ?? []);
}
