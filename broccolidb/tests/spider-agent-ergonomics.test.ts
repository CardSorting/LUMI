import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import {
  buildAgentDigest,
  enrichSpiderReport,
  validateSpiderReport,
} from '../core/policy/spider/AgentDigest.js';
import { SpiderEngine } from '../core/policy/SpiderEngine.js';
import { ForensicSpider } from '../core/policy/spider/ForensicSpider.js';
import type { SpiderReport } from '../core/policy/spider/report-types.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

function minimalReport(overrides: Partial<SpiderReport> = {}): SpiderReport {
  return {
    reportId: 'test-report',
    generatedAt: new Date().toISOString(),
    scope: 'test',
    health: { pure: true, graphNodeCount: 1, compilerDelegatedToLsp: true },
    typeMirror: {
      compilerAvailable: false,
      diagnosticsComplete: false,
      degradedReason: 'test',
      diagnosticCount: 0,
      diagnostics: [],
    },
    footprints: [],
    diskParity: [],
    findings: [
      {
        diagnosticId: 'SPI-001',
        severity: 'ERROR',
        label: 'SPI-001',
        filePath: 'a.ts',
        evidence: [
          {
            diagnosticId: 'SPI-001',
            severity: 'ERROR',
            filePath: 'a.ts',
            evidenceKind: 'import-resolution',
            observed: 'missing',
            expected: 'present',
            rationale: 'contract',
          },
        ],
        message: 'missing export',
      },
    ],
    structuralViolations: [],
    layerViolations: [],
    cycles: [],
    repairDirectives: [],
    entropy: 0.1,
    degraded: true,
    degradedReasons: ['test'],
    ...overrides,
  };
}

async function runTest() {
  const report = minimalReport();
  validateSpiderReport(report);
  const enriched = enrichSpiderReport(report);
  assert.strictEqual(enriched.verdict, 'fail');
  assert.strictEqual(enriched.passed, false);
  assert.ok(enriched.agentDigest);
  assert.ok(enriched.agentDigest!.blockers.length === 1);
  assert.ok(enriched.findings[0].findingId);
  assert.ok(enriched.agentDigest!.agentNarrative.includes('Blockers'));

  const passDigest = buildAgentDigest(
    minimalReport({
      findings: [],
      degraded: false,
      typeMirror: {
        compilerAvailable: true,
        diagnosticsComplete: true,
        diagnosticCount: 0,
        diagnostics: [],
      },
    })
  );
  assert.strictEqual(passDigest.verdict, 'pass');
  assert.ok(passDigest.agentNarrative.includes('clean'));

  assert.throws(() => validateSpiderReport({ findings: [] }), /reportId/);
  assert.throws(
    () =>
      validateSpiderReport(
        minimalReport({
          findings: [{ diagnosticId: 'SPI-001', severity: 'ERROR', label: 'x', filePath: 'a', message: 'm', evidence: [] }],
        })
      ),
    /typed evidence/
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-ergo-'));
  setDbPath(path.join(root, 'ergo.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'ergo-user', 'ergo-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'ergo-user');
  await ctx.start();

  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  const provider = 'src/provider.ts';
  const consumer = 'src/consumer.ts';
  fs.writeFileSync(path.join(root, provider), 'export const V = 1;\n');
  fs.writeFileSync(path.join(root, consumer), 'import { V } from "./provider";\nexport const use = V;\n');
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] })
  );

  await ctx.graph.spider.applyChanges([
    { filePath: provider, content: fs.readFileSync(path.join(root, provider), 'utf8') },
    { filePath: consumer, content: fs.readFileSync(path.join(root, consumer), 'utf8') },
  ]);

  const preflight = await ctx.graph.spider.preflight(consumer);
  assert.ok(preflight.scope.includes(consumer));
  assert.ok(preflight.structuralImpact.summary.length > 0);
  assert.ok(preflight.studyPack.studyItems.length >= 0);
  assert.ok(preflight.audit.agentDigest);
  assert.ok(typeof preflight.audit.passed === 'boolean');

  const auditViaAuditCap = await ctx.audit.spider.audit({ scope: [consumer], includeTypes: false });
  assert.ok(auditViaAuditCap.agentDigest);

  const narrative = ctx.graph.spider.formatNarrative(auditViaAuditCap);
  assert.ok(narrative.includes('Spider Forensic Report'));

  const engine = new SpiderEngine(root);
  engine.buildGraph([
    { filePath: provider, content: fs.readFileSync(path.join(root, provider), 'utf8') },
    { filePath: consumer, content: fs.readFileSync(path.join(root, consumer), 'utf8') },
  ]);
  const spider = new ForensicSpider(engine, root);
  const scoped = await spider.audit({ scope: [consumer], neighborhoodDepth: 1, includeTypes: false });
  assert.ok(scoped.agentDigest);

  await ctx.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-agent-ergonomics.test failed:', error);
    process.exit(1);
  });
