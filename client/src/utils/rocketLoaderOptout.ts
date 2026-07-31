// client/src/utils/rocketLoaderOptout.ts
// ============================================================
// Stamps Cloudflare's Rocket Loader opt-out onto every <script> in index.html.
// ------------------------------------------------------------
// Build-time only: imported by client/vite.config.ts, never by app code, so it
// is not part of the browser bundle. It lives under src/ so it is covered by the
// client tsconfig and the client vitest suite (see __tests__/).
//
// WHY THIS EXISTS — live outage 2026-07-31.
// Rocket Loader is enabled on the rmpgutah.us zone and rewrites the entry
// script's type attribute:
//
//   <script type="module" src="/assets/index-<hash>.js">
//   -> <script type="<cf-hash>-module" src="/assets/index-<hash>.js">
//
// A mangled type is not a module type, so the browser fetches the bundle
// (network shows a clean 200) but never EXECUTES it. React never mounts and the
// page sits on the #pre-splash "INITIALIZING" div. Reproduced on a fresh profile
// with no service worker and no caches; force-importing the same bundle by hand
// mounted the app instantly, which is what isolated "never ran" from "broken".
//
// It stayed invisible because sw.js's CACHE_NAME is stamped from the git SHA: a
// warm service worker kept serving the app until a deploy rotated the cache and
// pushed every client back through the rewritten HTML. So the root cause is a
// zone setting but the trigger is ANY deploy.
//
// `data-cfasync="false"` is Cloudflare's documented opt-out:
// https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/
// ============================================================

/**
 * Adds `data-cfasync="false"` to every `<script>` tag that lacks it.
 *
 * Deliberately stamps EVERY script, not just the module entry, for two reasons
 * straight out of Cloudflare's docs and this app's own boot sequence:
 *   - dependent scripts must carry the attribute too, and
 *   - the inline pre-paint theme resolver in index.html matters as much as the
 *     entry bundle — deferring it reintroduces exactly the theme FOUC that
 *     script exists to prevent.
 *
 * The attribute is inserted immediately after `<script`, which satisfies the
 * documented requirement that it appear BEFORE `src`.
 *
 * Idempotent: the negative lookahead skips tags already carrying the attribute,
 * so running the transform twice cannot double-stamp.
 */
export function stampCfAsync(html: string): string {
  return html.replace(/<script(?![^>]*\bdata-cfasync=)/g, '<script data-cfasync="false"');
}
