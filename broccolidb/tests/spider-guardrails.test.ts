import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../core/agent-context.js';
import { ForensicSpider } from '../core/policy/spider/ForensicSpider.js';
import { SPIDER_AGENT_ERGONOMICS_METHODS } from '../core/policy/spider/spider-agent-methods.js';
import { SPIDER_MCP_TOOL_NAMES } from '../core/policy/spider/spider-mcp-tools.js';
import { SpiderEngine } from '../core/policy/SpiderEngine.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

function assertFindingShape(finding: {
  diagnosticId: string;
  evidence: Array<{ observed: string; expected: string; rationale: string }>;
}) {
  assert.ok(finding.diagnosticId.startsWith('SPI-'));
  assert.ok(finding.evidence.length > 0);
  for (const ev of finding.evidence) {
    assert.ok(ev.observed);
    assert.ok(ev.expected);
    assert.ok(ev.rationale);
  }
}

async function runTest() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const agentContextSource = fs.readFileSync(path.join(packageRoot, 'core/agent-context.ts'), 'utf8');
  assert.ok(!agentContextSource.includes('get spider('), 'AgentContext must not expose spider getter');

  const graphCapabilitySource = fs.readFileSync(
    path.join(packageRoot, 'core/agent-context/capabilities/GraphCapability.ts'),
    'utf8'
  );
  assert.ok(!graphCapabilitySource.includes('getEngine:'), 'GraphCapability must not expose spider.getEngine');
  assert.ok(!graphCapabilitySource.includes('getDiscovery:'), 'GraphCapability must not expose spider.getDiscovery');

  const requiredSpiderMethods = SPIDER_AGENT_ERGONOMICS_METHODS;

  const forensicSpiderSource = fs.readFileSync(
    path.join(packageRoot, 'core/policy/spider/ForensicSpider.ts'),
    'utf8'
  );
  assert.ok(!forensicSpiderSource.includes('ensureServer('));
  assert.ok(!forensicSpiderSource.includes('spawn('));
  assert.ok(!/constructor\([^)]*\)\s*\{[^}]*ensureServer/s.test(forensicSpiderSource));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-guardrails-'));
  setDbPath(path.join(root, 'guardrails.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'spider-user', 'spider-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'spider-user');
  await context.start();

  for (const method of requiredSpiderMethods) {
    assert.strictEqual(
      typeof (context.graph.spider as Record<string, unknown>)[method],
      'function',
      `GraphCapability.spider.${method} must be exposed`
    );
  }

  const mcpSource = fs.readFileSync(path.join(packageRoot, 'core/mcp.ts'), 'utf8');
  for (const toolName of SPIDER_MCP_TOOL_NAMES) {
    assert.ok(mcpSource.includes(`'${toolName}'`), `MCP must register ${toolName}`);
  }

  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const provider = path.join(srcDir, 'provider.ts');
  const consumer = path.join(srcDir, 'consumer.ts');
  fs.writeFileSync(provider, 'export const Anchor = 1;\n');
  fs.writeFileSync(consumer, 'import { Anchor } from "./provider";\nexport const v = Anchor;\n');
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] })
  );

  const beforeProvider = fs.readFileSync(provider, 'utf8');
  const report = await context.graph.spider.audit({
    scope: 'all',
    includeTypes: true,
    includeRepairDirectives: true,
  });

  assert.ok(report.reportId);
  assert.ok(report.findings.length >= 0);
  for (const finding of report.findings) {
    assertFindingShape(finding);
  }
  for (const directive of report.repairDirectives) {
    assert.ok(directive.verificationCommand);
    assert.ok(directive.supportingEvidenceIds.length > 0);
  }

  assert.strictEqual(fs.readFileSync(provider, 'utf8'), beforeProvider, 'audit must not mutate disk files');

  if (!report.typeMirror.compilerAvailable) {
    assert.ok(report.degraded);
    assert.ok(report.findings.some((f) => f.diagnosticId === 'SPI-009'));
  }

  const noTsconfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-no-compiler-'));
  const bareEngine = new SpiderEngine(noTsconfigRoot);
  const bareSpider = new ForensicSpider(bareEngine, noTsconfigRoot);
  const degradedReport = await bareSpider.audit({ includeTypes: true });
  assert.ok(degradedReport.degraded);
  assert.ok(degradedReport.typeMirror.compilerAvailable === false || !degradedReport.typeMirror.diagnosticsComplete);

  await context.stop();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(noTsconfigRoot, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-guardrails.test failed:', error);
    process.exit(1);
  });
