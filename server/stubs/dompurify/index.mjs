// DOMPurify stub — jsPDF's .html() method is not used in RMPG Flex.
// This eliminates CVE-2026-0540 (GHSA-v2wj-7wpq-c8vv) from the dependency tree.
function sanitize(dirty) { return typeof dirty === 'string' ? dirty : ''; }
sanitize.sanitize = sanitize;
sanitize.addHook = function() {};
sanitize.removeHook = function() {};
sanitize.removeHooks = function() {};
sanitize.removeAllHooks = function() {};
sanitize.setConfig = function() {};
sanitize.clearConfig = function() {};
sanitize.isSupported = false;
sanitize.version = '99.0.0';
export default sanitize;
export { sanitize };
