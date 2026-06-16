import assert from 'node:assert';
import { MutationPlanner } from '../core/orchestration/MutationPlanner.js';
import type { SpiderReport } from '../core/policy/spider/report-types.js';

function minimalReport(directives: SpiderReport['repairDirectives']): SpiderReport {
  return {
    reportId: 'rpt-1',
    generatedAt: new Date().toISOString(),
    scope: 'changed-files',
    health: { pure: true, graphNodeCount: 0, compilerDelegatedToLsp: true },
    verdict: 'fail',
    passed: false,
    degraded: false,
    degradedReasons: [],
    entropy: 0,
    findings: [],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: directives,
    diskParity: [],
    footprints: [],
    typeMirror: {
      compilerAvailable: false,
      diagnosticsComplete: false,
      diagnosticCount: 0,
      diagnostics: [],
    },
  };
}

async function runTest() {
  const planner = new MutationPlanner();
  const report = minimalReport([
    {
      directiveId: 'd-1',
      type: 'UPDATE_IMPORT_PATH',
      targetFile: 'src/consumer.ts',
      suggestedValue: 'src/provider.ts',
      rationale: 'Fix ghost import',
      preconditions: ['provider exports symbol'],
      verificationCommand: 'grep import src/consumer.ts',
      riskLevel: 'low',
      supportingEvidenceIds: ['SPI-001'],
    },
    {
      directiveId: 'd-2',
      type: 'BREAK_CYCLE_BY_INTERFACE',
      targetFile: 'src/a.ts',
      suggestedValue: 'extract interface',
      rationale: 'Break cycle',
      preconditions: ['cycle confirmed'],
      verificationCommand: 'npx tsc --noEmit',
      riskLevel: 'high',
      supportingEvidenceIds: ['SPI-004'],
    },
  ]);

  const plan = planner.planFromAudit({
    audit: report,
    sessionId: 'sess-1',
    policy: 'autonomous_safe',
  });

  assert.strictEqual(plan.steps.length, 2);
  assert.strictEqual(plan.estimatedRisk, 'high');
  assert.ok(plan.affectedFiles.includes('src/consumer.ts'));
  assert.ok(plan.rollbackStrategy.kind === 'file-snapshot');
  assert.ok(plan.requiredVerificationCommands.some((c) => c.includes('gate')));
  assert.ok(plan.requiredApprovals.includes('human_approval_required'));

  const preview = planner.preview(plan, 'human_approval_required');
  assert.ok(preview.narrative.includes('UPDATE_IMPORT_PATH'));
  assert.strictEqual(preview.stepCount, 2);
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('mutation-planner.test failed:', error);
    process.exit(1);
  });
