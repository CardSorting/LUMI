/**
 * Shared worker constants.
 *
 * NOTE: Extracted into a leaf module so `queue.ts` and `worker.ts` can both
 * reference these constants without importing each other — breaking the
 * queue.ts ↔ worker.ts circular dependency. Pure values only; no imports.
 */

/** Seven days in milliseconds. Default retention window for synced/failed items. */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
