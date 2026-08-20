// Test-only stub for the "server-only" package. The real package throws if
// resolved under the "browser" import condition, which Vitest uses for
// jsdom/happy-dom test environments — see vitest.config.mts.
export {};
