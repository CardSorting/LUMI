import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicApiPath = path.join(__dirname, '../core/public-api.ts');
const source = fs.readFileSync(publicApiPath, 'utf8');

const exportNames = new Set<string>();
for (const match of source.matchAll(/^export \{([^}]+)\}/gm)) {
  for (const part of match[1]!.split(',')) {
    const cleaned = part.trim().replace(/^type\s+/, '');
    const name = cleaned.split(/\s+as\s+/).pop()!.trim();
    if (name) exportNames.add(name);
  }
}
for (const match of source.matchAll(/^export type \* from/gm)) {
  exportNames.add('capability-types');
  exportNames.add('intent-types');
}
for (const match of source.matchAll(/^export type \{([^}]+)\}/gm)) {
  for (const part of match[1]!.split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()!.trim();
    if (name) exportNames.add(name);
  }
}

const APPROVED = [
  'AgentContext',
  'AgentGitError',
  'LifecycleStateError',
  'InvariantViolationError',
  'RecoveryError',
  'StorageIntegrityError',
  'BackpressureError',
  'DatabaseLockError',
  'GuidedError',
  'formatGuidance',
  'IntentTracer',
  'OrchestrationRuntime',
  'PolicyBlockedError',
  'RuntimePolicyViolationError',
  'RuntimeBudgetExceededError',
  'Workspace',
  'Connection',
  'capability-types',
  'intent-types',
  'CapabilityHealth',
  'BroccoliDbHealth',
  'BroccoliDbCacheStats',
  'AgentProfile',
  'ErrorGuidance',
  'ExecutionSession',
  'ExecutionSessionStatus',
  'MutationPlan',
  'MutationStep',
  'RepairExecution',
  'VerificationResult',
  'RuntimeHealth',
  'ApprovalPolicy',
  'ExecutionBudget',
  'BeginSessionInput',
  'ExecutePlanInput',
  'VerifyExecutionInput',
  'RuntimeSessionState',
  'RuntimeBlocker',
  'RuntimeNextAction',
  'RuntimeExportOptions',
  'RuntimeExportResult',
  'RuntimeSnapshot',
  'RuntimeStory',
  'RuntimeMemoryHealth',
  'ReplayMode',
  'ReplayOptions',
  'ReplayHydrationResult',
  'RuntimeMode',
  'AgentGitErrorCode',
];

const missing = APPROVED.filter((n) => !exportNames.has(n) && !['capability-types', 'intent-types'].includes(n));
const extra = [...exportNames].filter((n) => !APPROVED.includes(n));

assert.strictEqual(missing.length, 0, `Missing approved exports: ${missing.join(', ')}`);
assert.strictEqual(extra.length, 0, `Unexpected public exports: ${extra.join(', ')}`);
console.log('public-api-snapshot: OK', exportNames.size, 'export groups');
