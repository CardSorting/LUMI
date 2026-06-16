import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function runTest() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const forensicSource = fs.readFileSync(
    path.join(packageRoot, 'core/policy/spider/ForensicSpider.ts'),
    'utf8'
  );
  assert.ok(!forensicSource.includes('writeFileSync'), 'ForensicSpider must not write files');

  const spiderServiceSource = fs.readFileSync(
    path.join(packageRoot, 'core/agent-context/SpiderService.ts'),
    'utf8'
  );
  assert.ok(!spiderServiceSource.includes('RepairExecutor'), 'SpiderService must not import RepairExecutor');

  const orchestrationFiles = [
    'OrchestrationRuntime.ts',
    'RepairExecutor.ts',
    'MutationPlanner.ts',
    'VerificationPipeline.ts',
    'RollbackCoordinator.ts',
    'ApprovalPolicyEngine.ts',
  ];
  for (const file of orchestrationFiles) {
    const src = fs.readFileSync(path.join(packageRoot, 'core/orchestration', file), 'utf8');
    assert.ok(!src.includes('setInterval'), `${file} must not use setInterval`);
    assert.ok(!src.includes('setTimeout'), `${file} must not use setTimeout`);
    assert.ok(!/constructor\([^)]*\)\s*\{[^}]*start\(/s.test(src), `${file} must not start in constructor`);
  }

  const repairExecutorSource = fs.readFileSync(
    path.join(packageRoot, 'core/orchestration/RepairExecutor.ts'),
    'utf8'
  );
  assert.ok(repairExecutorSource.includes('sole authorized file mutation path'));

  const agentContextSource = fs.readFileSync(path.join(packageRoot, 'core/agent-context.ts'), 'utf8');
  assert.ok(agentContextSource.includes('orchestration'), 'AgentContext must register orchestration runtime');
  assert.ok(agentContextSource.includes('get runtime'), 'AgentContext must expose runtime getter');

  const lifecycleSource = fs.readFileSync(
    path.join(packageRoot, 'core/agent-context/LifecycleRegistry.ts'),
    'utf8'
  );
  assert.ok(lifecycleSource.includes("'orchestration'"), 'LifecycleRegistry must include orchestration');
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('orchestration-guardrails.test failed:', error);
    process.exit(1);
  });
