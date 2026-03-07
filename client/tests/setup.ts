import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Clear localStorage before each test to prevent state leakage
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not support localStorage.clear in all versions
  }
});
