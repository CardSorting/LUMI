// [LAYER: CORE]
import { AgentGitError } from '../../../core/errors.js';

export class SpiderAuditError extends AgentGitError {
  constructor(message: string, code: 'INVALID_ARGUMENT' | 'INVARIANT_VIOLATION' = 'INVARIANT_VIOLATION') {
    super(message, code);
    this.name = 'SpiderAuditError';
  }
}

export class SpiderCompilerUnavailableError extends SpiderAuditError {
  constructor(message: string, public readonly tsconfigPath?: string) {
    super(message, 'INVARIANT_VIOLATION');
    this.name = 'SpiderCompilerUnavailableError';
  }
}

export class SpiderDiskParityError extends SpiderAuditError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly graphHash: string,
    public readonly diskHash: string
  ) {
    super(message, 'INVARIANT_VIOLATION');
    this.name = 'SpiderDiskParityError';
  }
}
