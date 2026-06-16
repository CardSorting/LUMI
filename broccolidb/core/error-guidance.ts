// [LAYER: CORE]
// @classification PURE
import type { AgentGitErrorCode } from './errors.js';
import { LifecycleStateError } from './errors.js';

export interface ErrorGuidance {
  code: AgentGitErrorCode;
  message: string;
  likelyCause: string;
  suggestedFix: string;
  command?: string;
  docsPath: string;
}

const DOCS_BASE = 'broccolidb/docs/errors.md';

export function lifecycleNotStartedError(operation: string): ErrorGuidance {
  return {
    code: 'LIFECYCLE_STATE_ERROR',
    message: `AgentContext has not been started. Call await ctx.start() before using ${operation}.`,
    likelyCause: 'Capabilities and runtime require an active lifecycle.',
    suggestedFix: 'Wrap usage in try/finally and call await ctx.start() first, await ctx.stop() in finally.',
    command: 'await ctx.start()',
    docsPath: DOCS_BASE,
  };
}

export function lifecycleStoppedError(operation: string): ErrorGuidance {
  return {
    code: 'LIFECYCLE_STATE_ERROR',
    message: `AgentContext is stopped. Cannot call ${operation} after stop().`,
    likelyCause: 'The context was already shut down.',
    suggestedFix: 'Create a new AgentContext instance for a new session of work.',
    docsPath: DOCS_BASE,
  };
}

export function lifecycleStoppingError(operation: string): ErrorGuidance {
  return {
    code: 'LIFECYCLE_STATE_ERROR',
    message: `AgentContext is stopping. Cannot call ${operation} during shutdown.`,
    likelyCause: 'Another caller invoked stop() while work was in flight.',
    suggestedFix: 'Await stop() to finish, then create a new context if needed.',
    docsPath: DOCS_BASE,
  };
}

export function budgetExceededGuidance(reason: string): ErrorGuidance {
  return {
    code: 'BUDGET_EXCEEDED',
    message: `Runtime execution budget exceeded: ${reason}.`,
    likelyCause: 'The session exceeded max duration, files, directives, or verification limits.',
    suggestedFix: 'Begin a new session with a larger budget or reduce plan scope.',
    command: 'await ctx.runtime.beginSession({ budget: { maxDirectives: 10 } })',
    docsPath: 'docs/api/execution-budgets.md',
  };
}

export function formatGuidance(g: ErrorGuidance): string {
  const lines = [
    g.message,
    `Cause: ${g.likelyCause}`,
    `Fix: ${g.suggestedFix}`,
    g.command ? `Try: ${g.command}` : '',
    `Docs: ${g.docsPath}`,
  ].filter(Boolean);
  return lines.join('\n');
}

export class GuidedError extends LifecycleStateError {
  readonly guidance: ErrorGuidance;

  constructor(guidance: ErrorGuidance) {
    super(formatGuidance(guidance));
    this.guidance = guidance;
    this.name = 'GuidedError';
  }
}

export function throwLifecycleNotStarted(operation: string): never {
  throw new GuidedError(lifecycleNotStartedError(operation));
}
