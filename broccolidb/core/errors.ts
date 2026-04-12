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
  | 'REASONING_CONFLICT';

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
