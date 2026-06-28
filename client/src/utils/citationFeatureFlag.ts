// ============================================================
// Citation feature flag — toggle Utah master form on/off
// ============================================================
// Workspace-wide flag controlled by localStorage during the PR 1
// rollout window. Default OFF — flipped per-user for testing, then
// flipped ON workspace-wide after PR 2's signature flow lands. Once
// PR 3 lands and the filing queue is verified, the old PS-209
// (`citation.ts`) form is removed and this flag becomes a no-op.
//
// Three control surfaces (in resolution priority order):
//   1. URL query param `?utahmaster=1|0` — wins, persists to LS
//   2. localStorage `rmpg_citation_use_utah_master` = 'true'|'false'
//   3. Default: false (PR 1), flipped to true after PR 2 lands

const STORAGE_KEY = 'rmpg_citation_use_utah_master';
const URL_PARAM = 'utahmaster';

/** Default value when neither URL nor LS is set. Flip to `true` after PR 2 lands. */
const DEFAULT_ENABLED = false;

export function isUtahMasterEnabled(): boolean {
  // SSR/Node fallback — no window/localStorage available
  if (typeof window === 'undefined') return DEFAULT_ENABLED;
  try {
    const params = new URLSearchParams(window.location.search);
    const urlVal = params.get(URL_PARAM);
    if (urlVal === '1' || urlVal === 'true') {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      return true;
    }
    if (urlVal === '0' || urlVal === 'false') {
      window.localStorage.setItem(STORAGE_KEY, 'false');
      return false;
    }
    const lsVal = window.localStorage.getItem(STORAGE_KEY);
    if (lsVal === 'true') return true;
    if (lsVal === 'false') return false;
  } catch {
    /* localStorage unavailable in private mode — fall through to default */
  }
  return DEFAULT_ENABLED;
}

export function setUtahMasterEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}
