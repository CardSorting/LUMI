import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { enrichSpiderReport } from '../core/policy/spider/AgentDigest.js';
import {
  diffReports,
  evaluateGate,
  explainFinding,
  formatDiffNarrative,
  toAgentCompact,
  toCompactLines,
  toDiagnosticJson,
  toGithubAnnotations,
  toCodeActions,
  toLspDiagnostics,
  toSarifLog,
} from '../core/policy/spider/AgentFormats.js';
import type { SpiderReport } from '../core/policy/spider/report-types.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

function sampleReport(): SpiderReport {
  return enrichSpiderReport({
    reportId: 'r1',
    generatedAt: new Date().toISOString(),
    scope: 'test',
    health: { pure: true, graphNodeCount: 1, compilerDelegatedToLsp: true },
    typeMirror: {
      compilerAvailable: false,
      diagnosticsComplete: false,
      degradedReason: 'skipped',
      diagnosticCount: 0,
      diagnostics: [],
    },
    footprints: [],
    diskParity: [{ filePath: 'a.ts', graphHash: 'g', diskHash: 'd', driftStatus: 'drifted', lastIndexedAt: 0, lastModifiedAt: 1 }],
    findings: [
      {
        diagnosticId: 'SPI-001',
        severity: 'ERROR',
        label: 'SPI-001',
        filePath: 'a.ts',
        sourceRange: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 5 },
        evidence: [
          {
            diagnosticId: 'SPI-001',
            severity: 'ERROR',
            filePath: 'a.ts',
            evidenceKind: 'import-resolution',
            observed: 'x',
            expected: 'y',
            rationale: 'z',
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
        directiveId: 'dir-1',
        type: 'ADD_MISSING_EXPORT',
        targetFile: 'a.ts',
        suggestedValue: 'export Foo',
        rationale: 'restore export',
        preconditions: ['symbol exists'],
        verificationCommand: 'npx tsc --noEmit',
        riskLevel: 'low',
        supportingEvidenceIds: ['SPI-001'],
      },
    ],
    entropy: 0.2,
    degraded: true,
    degradedReasons: ['drift'],
  });
}

async function runTest() {
  const report = sampleReport();
  assert.ok(report.agentDigest?.playbook.length > 0);
  assert.ok(report.agentDigest?.blockers[0].location === 'a.ts:10:1');

  const lines = toCompactLines(report);
  assert.ok(lines[0].includes('a.ts:10:1'));
  assert.ok(lines[0].includes('SPI-001'));

  const sarif = toSarifLog(report, '/workspace');
  assert.strictEqual(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results[0].fingerprints?.primaryLocationLineHash);

  const lsp = toLspDiagnostics(report, '/workspace');
  const uris = Object.keys(lsp);
  assert.ok(uris.length > 0);
  assert.strictEqual(lsp[uris[0]][0].source, 'spider');

  const gate = evaluateGate(report);
  assert.strictEqual(gate.blocked, true);
  assert.strictEqual(gate.conclusion, 'failure');
  assert.strictEqual(gate.exitCode, 1);

  const passGate = evaluateGate(
    enrichSpiderReport({
      ...report,
      findings: [],
      diskParity: [],
      degraded: false,
      degradedReasons: [],
      repairDirectives: [],
    })
  );
  assert.strictEqual(passGate.conclusion, 'success');

  const after = enrichSpiderReport({ ...report, findings: [], repairDirectives: [] });
  const diff = diffReports(report, after);
  assert.ok(diff.resolved.length === 1);
  assert.strictEqual(diff.introduced.length, 0);

  const explained = explainFinding(report, report.findings[0].findingId!);
  assert.ok(explained);
  assert.ok(explained!.directives.length > 0);

  const compact = toAgentCompact(report);
  assert.strictEqual(compact.gate.exitCode, 1);
  assert.ok(compact.lines.length > 0);

  const json = toDiagnosticJson(report);
  assert.strictEqual(json[0].code, 'SPI-001');
  assert.ok(json[0].fix?.verificationCommand);

  const annotations = toGithubAnnotations(report);
  assert.ok(annotations[0].startsWith('::error file=a.ts'));

  const codeActions = toCodeActions(report);
  assert.strictEqual(codeActions[0].directiveId, 'dir-1');

  const deltaText = formatDiffNarrative(diff);
  assert.ok(deltaText.includes('Resolved: 1'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-fmt-'));
  setDbPath(path.join(root, 'fmt.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'fmt-user', 'fmt-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'fmt-user');
  await ctx.start();

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/x.ts'), 'export const X = 1;\n');

  const gateResult = await ctx.graph.spider.gate({ scope: ['src/x.ts'], includeTypes: false });
  assert.ok('conclusion' in gateResult);

  const gateBundle = await ctx.graph.spider.gateBundle({ scope: ['src/x.ts'], includeTypes: false });
  assert.ok(gateBundle.bundle.brief.includes('[spider:'));
  assert.ok(Array.isArray(gateBundle.bundle.formats.json));

  const audit = await ctx.graph.spider.audit({ scope: ['src/x.ts'], includeTypes: false });
  const sarif2 = ctx.graph.spider.toSarif(audit);
  assert.strictEqual(sarif2.version, '2.1.0');

  const compact2 = ctx.graph.spider.compact(audit);
  assert.ok(compact2.summary.length >= 0);

  await ctx.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-agent-formats.test failed:', error);
    process.exit(1);
  });
