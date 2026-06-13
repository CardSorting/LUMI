/**
 * Checkpoint constants.
 *
 * NOTE: Extracted into a leaf module so CheckpointExclusions.ts and
 * CheckpointGitOperations.ts can share constants without importing each other —
 * breaking the CheckpointExclusions ↔ CheckpointGitOperations circular
 * dependency. Pure values only; no imports.
 */

/** Suffix appended to nested `.git` directories to temporarily disable them. */
export const GIT_DISABLED_SUFFIX = "_disabled"
