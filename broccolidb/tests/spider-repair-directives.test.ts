import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SpiderEngine } from '../core/policy/SpiderEngine.js';
import { RepairDirectiveEngine } from '../core/policy/spider/RepairDirectiveEngine.js';
import type { SpiderFinding } from '../core/policy/spider/report-types.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-repair-'));
  const provider = 'src/provider.ts';
  const consumer = 'src/consumer.ts';
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, provider), 'export const SymbolA = 1;\n');
  fs.writeFileSync(path.join(root, consumer), 'import { SymbolA } from "./provider";\nconsole.log(SymbolA);\n');

  const engine = new SpiderEngine(root);
  engine.buildGraph([
    { filePath: provider, content: fs.readFileSync(path.join(root, provider), 'utf8') },
    { filePath: consumer, content: fs.readFileSync(path.join(root, consumer), 'utf8') },
  ]);

  const brokenProvider = 'export const SymbolB = 2;\n';
  engine.updateNode(provider, brokenProvider);

  const findings: SpiderFinding[] = [
    {
      diagnosticId: 'SPI-001',
      severity: 'ERROR',
      label: 'SPI-001',
      filePath: consumer,
      symbolName: 'SymbolA',
      evidence: [
        {
          diagnosticId: 'SPI-001',
          severity: 'ERROR',
          filePath: consumer,
          symbolName: 'SymbolA',
          evidenceKind: 'import-resolution',
          observed: 'missing SymbolA',
          expected: 'exported SymbolA',
          rationale: 'contract break',
        },
      ],
      message: 'missing export',
    },
  ];

  const repairEngine = new RepairDirectiveEngine();
  const directives = repairEngine.generateRepairDirectives(engine, findings, [], [], []);
  assert.ok(directives.length > 0);
  for (const directive of directives) {
    assert.ok(directive.directiveId);
    assert.ok(directive.verificationCommand);
    assert.ok(directive.rationale);
    assert.ok(directive.supportingEvidenceIds.length > 0);
    assert.ok(directive.preconditions.length > 0);
  }

  const validated = repairEngine.validateDirectives(directives, findings);
  assert.strictEqual(validated.length, directives.length);

  fs.rmSync(root, { recursive: true, force: true });
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('spider-repair-directives.test failed:', error);
    process.exit(1);
  });
