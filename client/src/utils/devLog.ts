// Gate console output behind development mode to reduce CPU overhead in production.
// console.error is always allowed (needed for debugging production issues).

const isDev = import.meta.env.DEV;

export const devLog = isDev
  ? (...args: unknown[]) => console.log(...args)
  : () => {};

export const devWarn = isDev
  ? (...args: unknown[]) => console.warn(...args)
  : () => {};
