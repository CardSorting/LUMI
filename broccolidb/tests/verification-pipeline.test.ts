import assert from 'node:assert';
import { VerificationPipeline } from '../core/orchestration/VerificationPipeline.js';
import { ExecutionTrace } from '../core/orchestration/ExecutionTrace.js';
import type { SpiderReport } from '../core/policy/spider/report-types.js';
import type { RepairExecution } from '../core/orchestration/types.js';

function baselineReport(): SpiderReport {
  return {
    reportId: 'base',
    generatedAt: new Date().toISOString(),
    scope: 'changed-files',
    health: { pure: true, graphNodeCount: 1, compilerDelegatedToLsp: true },
    verdict: 'fail',
    passed: false,
    degraded: false,
    degradedReasons: [],
    entropy: 0,
    findings: [
      {
        findingId: 'f-1',
        diagnosticId: 'SPI-001',
        severity: 'ERROR',
        label: 'SPI-001',
        filePath: 'src/ok.ts',
        evidence: [
          {
            diagnosticId: 'SPI-001',
            severity: 'ERROR',
            filePath: 'src/ok.ts',
            evidenceKind: 'import-resolution',
            observed: 'x',
            expected: 'y',
            rationale: 'test',
          },
        ],
        message: 'baseline blocker',
      },
    ],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: [],
    diskParity: [],
    footprints: [],
    typeMirror: { compilerAvailable: false, diagnosticsComplete: false, diagnosticCount: 0, diagnostics: [] },
  };
}

function execution(): RepairExecution {
  return {
    executionId: 'ex-1',
    planId: 'pl-1',
    sessionId: 'sess-1',
    startedAt: Date.now(),
    appliedSteps: ['st-1'],
    skippedSteps: [],
    snapshotIds: [],
    status: 'completed',
    finishedAt: Date.now(),
  };
}

async function runTest() {
  const failingSpider = {
    async audit() {
      return baselineReport();
    },
    async gate() {
      return {
        blocked: true,
        conclusion: 'failure' as const,
        reasons: ['blockers remain'],
        report: await failingSpider.audit(),
        policy: { blockOnErrors: true, blockOnWarnings: false, blockOnDegraded: false, blockOnDrift: true },
        exitCode: 1 as const,
      };
    },
    diffSinceLast() {
      return null;
    },
  };

  const passingSpider = {
    async audit() {
      return { ...baselineReport(), reportId: 'after', findings: [], passed: true, verdict: 'pass' as const };
    },
    async gate() {
      return {
        blocked: false,
        conclusion: 'success' as const,
        reasons: [],
        report: await passingSpider.audit(),
        policy: { blockOnErrors: true, blockOnWarnings: false, blockOnDegraded: false, blockOnDrift: true },
        exitCode: 0 as const,
      };
    },
    diffSinceLast() {
      return null;
    },
  };

  const invariants = { auditInvariants: async () => [] as string[] };

  const failPipeline = new VerificationPipeline(failingSpider, invariants, new ExecutionTrace());
  const failResult = await failPipeline.verify({
    execution: execution(),
    sessionId: 'sess-1',
    baselineReport: baselineReport(),
  });
  assert.strictEqual(failResult.passed, false);
  assert.strictEqual(failResult.gateStatus, 'fail');

  const passPipeline = new VerificationPipeline(passingSpider, invariants, new ExecutionTrace());
  const passResult = await passPipeline.verify({
    execution: execution(),
    sessionId: 'sess-1',
    baselineReport: baselineReport(),
  });
  assert.strictEqual(passResult.passed, true);
  assert.strictEqual(passResult.resolvedFindings.length, 1);
  assert.strictEqual(passResult.gateStatus, 'pass');
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('verification-pipeline.test failed:', error);
    process.exit(1);
  });
