// [LAYER: CORE]
// @classification PURE
/**
 * Temporary compatibility exceptions. Must be empty for a clean v23 purge.
 * Any non-empty entry requires a deletionDate; guardrail tests enforce this.
 */
export interface CompatibilityException {
  symbol: string;
  reason: string;
  deletionDate: string;
}

export const COMPATIBILITY_EXCEPTIONS: CompatibilityException[] = [];
