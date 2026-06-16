import assert from 'node:assert';
import { RuntimeStateGraph } from '../core/orchestration/state/RuntimeStateGraph.js';
import type { SpiderReport } from '../core/policy/spider/report-types.js';

function audit(reportId: string): SpiderReport {
  return {
    reportId,
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
        filePath: 'src/a.ts',
        evidence: [
          {
            diagnosticId: 'SPI-001',
            severity: 'ERROR',
            filePath: 'src/a.ts',
            evidenceKind: 'import-resolution',
            observed: 'x',
            expected: 'y',
            rationale: 'test',
          },
        ],
        message: 'missing export',
      },
    ],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: [
      {
        directiveId: 'd-1',
        type: 'UPDATE_IMPORT_PATH',
        targetFile: 'src/a.ts',
        suggestedValue: 'src/b.ts',
        rationale: 'fix import',
        preconditions: [],
        verificationCommand: 'grep import',
        riskLevel: 'low',
        supportingEvidenceIds: ['SPI-001'],
      },
    ],
    diskParity: [],
    footprints: [],
    typeMirror: { compilerAvailable: false, diagnosticsComplete: false, diagnosticCount: 0, diagnostics: [] },
  };
}

async function runTest() {
  const graph = new RuntimeStateGraph();
  const sessionId = 'sess-graph-1';
  const sessionNodeId = graph.recordSession({
    sessionId,
    startedAt: Date.now(),
    taskId: 't-1',
    status: 'running',
  });

  graph.recordAudit(sessionId, sessionNodeId, audit('rpt-1'));
  const plan = {
    planId: 'plan-1',
    sessionId,
    createdAt: Date.now(),
    steps: [],
    estimatedRisk: 'low' as const,
    affectedFiles: ['src/a.ts'],
    rollbackStrategy: { kind: 'file-snapshot' as const, snapshotIds: [], description: '' },
    requiredVerificationCommands: [],
    requiredApprovals: [],
    expectedInvariantChanges: [],
    sourceReportId: 'rpt-1',
    directives: [],
  };
  graph.recordPlan(sessionId, sessionNodeId, plan, 'rpt-1');

  const execution = {
    executionId: 'ex-1',
    planId: 'plan-1',
    sessionId,
    startedAt: Date.now(),
    appliedSteps: [],
    skippedSteps: [],
    snapshotIds: [],
    status: 'completed' as const,
  };
  graph.recordExecution(sessionId, sessionNodeId, execution);

  const snapshot = graph.snapshot(sessionId);
  assert.ok(snapshot.nodes.some((n) => n.kind === 'Session'));
  assert.ok(snapshot.nodes.some((n) => n.kind === 'Audit'));
  assert.ok(snapshot.nodes.some((n) => n.kind === 'Finding'));
  assert.ok(snapshot.nodes.some((n) => n.kind === 'RepairDirective'));
  assert.ok(snapshot.nodes.some((n) => n.kind === 'MutationPlan'));
  assert.ok(snapshot.nodes.some((n) => n.kind === 'Execution'));

  const auditNode = snapshot.nodes.find((n) => n.kind === 'Audit')!;
  const planNode = snapshot.nodes.find((n) => n.kind === 'MutationPlan')!;
  assert.ok(snapshot.edges.some((e) => e.from === auditNode.id && e.to === planNode.id && e.kind === 'triggered'));

  const execNode = snapshot.nodes.find((n) => n.kind === 'Execution')!;
  assert.ok(snapshot.edges.some((e) => e.to === execNode.id && e.kind === 'executed_by'));
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('runtime-state-graph.test failed:', error);
    process.exit(1);
  });
