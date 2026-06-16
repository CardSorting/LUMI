// [LAYER: CORE]
export type AgentGitErrorCode =
  | 'INVALID_USER_ID'
  | 'INVALID_PROJECT_ID'
  | 'INVALID_WORKSPACE_ID'
  | 'REPO_EXISTS'
  | 'REPO_NOT_FOUND'
  | 'BRANCH_NOT_FOUND'
  | 'REF_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'TREE_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'FILE_CORRUPT'
  | 'IGNORED_PATH'
  | 'INVALID_PATH'
  | 'MERGE_CONFLICT'
  | 'EMPTY_BRANCH'
  | 'EMPTY_TREE'
  | 'PROTECTED_BRANCH'
  | 'STASH_NOT_FOUND'
  | 'BISECT_INVALID_RANGE'
  | 'NO_COMMON_ANCESTOR'
  | 'INVALID_SQUASH_COUNT'
  | 'NOT_ENOUGH_HISTORY'
  | 'TIMEOUT'
  | 'QUOTA_EXCEEDED'
  | 'CONNECTION_FAILED'
  | 'DB_NOT_READY'
  | 'LOCK_TIMEOUT'
  | 'FILE_LOCKED'
  | 'WATCHER_ALREADY_RUNNING'
  | 'INVALID_ARGUMENT'
  | 'BUDGET_EXCEEDED'
  | 'REASONING_CONFLICT'
  | 'BACKPRESSURE_REJECT'
  | 'FLUSH_TIMEOUT'
  | 'STORAGE_CORRUPT'
  | 'INVARIANT_VIOLATION'
  | 'RECOVERY_FAILED'
  | 'LIFECYCLE_STATE_ERROR'
  | 'DATABASE_LOCK_ERROR';

export class AgentGitError extends Error {
  constructor(
    message: string,
    public code: AgentGitErrorCode,
    public conflicts?: string[]
  ) {
    super(message);
    this.name = 'AgentGitError';
  }
}

export class BackpressureError extends AgentGitError {
  constructor(message: string) {
    super(message, 'BACKPRESSURE_REJECT');
    this.name = 'BackpressureError';
  }
}

export class FlushTimeoutError extends AgentGitError {
  constructor(message: string) {
    super(message, 'FLUSH_TIMEOUT');
    this.name = 'FlushTimeoutError';
  }
}

export class StorageIntegrityError extends AgentGitError {
  constructor(message: string) {
    super(message, 'STORAGE_CORRUPT');
    this.name = 'StorageIntegrityError';
  }
}

export class InvariantViolationError extends AgentGitError {
  constructor(message: string) {
    super(message, 'INVARIANT_VIOLATION');
    this.name = 'InvariantViolationError';
  }
}

export class RecoveryError extends AgentGitError {
  constructor(message: string) {
    super(message, 'RECOVERY_FAILED');
    this.name = 'RecoveryError';
  }
}

export class LifecycleStateError extends AgentGitError {
  constructor(message: string) {
    super(message, 'LIFECYCLE_STATE_ERROR');
    this.name = 'LifecycleStateError';
  }
}

export class DatabaseLockError extends AgentGitError {
  constructor(message: string) {
    super(message, 'DATABASE_LOCK_ERROR');
    this.name = 'DatabaseLockError';
  }
}

/**
 * PathSanitizer ensures all repository paths are valid, normalized, and safe from traversal.
 */
export class PathSanitizer {
  static normalize(path: string): string {
    if (!path) return '';
    // 1. Strip leading/trailing slashes
    // 2. Collapse double slashes
    // 3. Prevent ../ or ./ segments
    const clean = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/\/+/g, '/');
    if (clean === '.' || clean === '..') return '';
    return clean;
  }

  static validate(path: string): string {
    const normalized = PathSanitizer.normalize(path);
    if (!normalized) throw new AgentGitError('Invalid or empty path', 'INVALID_PATH');

    // Check for malicious segments
    const parts = normalized.split('/');
    if (parts.some((p) => p === '..' || p === '.')) {
      throw new AgentGitError(
        `Security breach attempt: path traversal detected in '${path}'`,
        'INVALID_PATH'
      );
    }

    return normalized;
  }
}
