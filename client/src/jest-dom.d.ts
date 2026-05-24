// Type-side import so jest-dom matchers (toBeInTheDocument, toBeDisabled, etc.)
// extend Vitest's Assertion interface for `tsc --noEmit` over src/__tests__.
// Runtime import lives in tests/setup.ts.
import '@testing-library/jest-dom/vitest';
