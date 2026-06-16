import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentContext, StreamingToolExecutor, type ToolDef } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  console.info('--- TEST: Tool Executor Ergonomics & Hardening ---');

  const pool = new BufferedDbPool();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-tool-executor-'));
  const workspace = new Workspace(pool, 'tool-user', 'tool-workspace');
  workspace.setPhysicalPath(workspaceRoot);
  const ctx = new AgentContext(workspace, pool, 'tool-user');
  await ctx.start();

  try {
    let strictToolRan = false;
    const strictTool: ToolDef = {
      name: 'strict_write',
      description: 'Strict write tool',
      parameters: {
        type: 'object',
        required: ['path', 'mode'],
        additionalProperties: false,
        properties: {
          path: { type: 'string', minLength: 1 },
          mode: { enum: ['write'] },
        },
      },
      isSearchOrReadCommand: false,
      execute: async () => {
        strictToolRan = true;
        return 'ran';
      },
    };

    const parsedJsonCalls = StreamingToolExecutor.parseToolCallsFromText(
      '```json\n{"tool_calls":[{"id":"call-1","function":{"name":"strict_write","arguments":"{\\"path\\":\\"a.ts\\",\\"mode\\":\\"write\\"}"}}]}\n```',
      [strictTool]
    );
    assert.strictEqual(parsedJsonCalls.length, 1);
    assert.strictEqual(parsedJsonCalls[0]?.id, 'call-1');
    assert.strictEqual(parsedJsonCalls[0]?.name, 'strict_write');
    assert.deepStrictEqual(parsedJsonCalls[0]?.input, { path: 'a.ts', mode: 'write' });

    const parsedXmlCalls = StreamingToolExecutor.parseToolCallsFromText(
      '<strict_write id="xml-1">{"path":"b.ts","mode":"write"}</strict_write>',
      [strictTool]
    );
    assert.strictEqual(parsedXmlCalls.length, 1);
    assert.strictEqual(parsedXmlCalls[0]?.id, 'xml-1');
    assert.deepStrictEqual(parsedXmlCalls[0]?.input, { path: 'b.ts', mode: 'write' });

    const ignoredUnknownCalls = StreamingToolExecutor.parseToolCallsFromText(
      '{"tool_calls":[{"name":"unknown_tool","input":{}}]}',
      [strictTool]
    );
    assert.strictEqual(ignoredUnknownCalls.length, 0);

    const ignoredPlainJson = StreamingToolExecutor.parseToolCallsFromText(
      '{"name":"strict_write","description":"documentation, not a tool call"}',
      [strictTool]
    );
    assert.strictEqual(ignoredPlainJson.length, 0);

    const strictExecutor = ctx.query.createToolExecutor([strictTool], {
      mirrorFileChanges: false,
      recordAuditEvents: false,
    });

    const invalid = await strictExecutor.execute('strict_write', { path: 'a.ts', mode: 'read' }, 'invalid');
    assert.strictEqual(invalid.isError, true);
    assert.match(invalid.content, /input\.mode must be one of/);
    assert.strictEqual(strictToolRan, false, 'Invalid tool input should not execute the tool');

    const escape = await strictExecutor.execute(
      'strict_write',
      { path: '../outside.ts', mode: 'write' },
      'escape'
    );
    assert.strictEqual(escape.isError, true);
    assert.match(escape.content, /escapes workspace/);
    assert.strictEqual(strictToolRan, false, 'Unsafe mutation paths should fail closed');

    const permissive = await ctx
      .createToolExecutor([strictTool], {
        failOnUnsafeMutationPath: false,
        mirrorFileChanges: false,
        recordAuditEvents: false,
      })
      .execute('strict_write', { path: '../outside.ts', mode: 'write' }, 'permissive');
    assert.strictEqual(permissive.isError, false);
    assert.strictEqual(strictToolRan, true, 'Explicit unsafe-path opt-out should execute the tool');
    assert.ok(permissive.metadata?.warnings.includes('unsafe_mutation_path'));

    let sawAbortSignal = false;
    const slowTool: ToolDef = {
      name: 'slow_tool',
      description: 'Slow tool',
      parameters: { type: 'object' },
      timeoutMs: 25,
      execute: async (_args, serviceCtx) => {
        await sleep(80);
        sawAbortSignal = serviceCtx.toolUseContext?.signal?.aborted ?? false;
        return 'late';
      },
    };

    const timeoutExecutor = ctx.query.createToolExecutor([slowTool], {
      mirrorFileChanges: false,
      recordAuditEvents: false,
    });
    const timedOut = await timeoutExecutor.execute('slow_tool', {}, 'timeout');
    assert.strictEqual(timedOut.isError, true);
    assert.match(timedOut.content, /exceeded timeout/);
    await sleep(90);
    assert.strictEqual(sawAbortSignal, true, 'Timeout should abort the per-tool signal');

    const redactionTool: ToolDef = {
      name: 'redaction_tool',
      description: 'Returns sensitive text',
      parameters: {},
      maxResultSizeChars: 64,
      execute: async () => 'token=supersecret password=hunter2 Bearer abc.def.ghi visible-tail',
    };
    const redacted = await ctx
      .createToolExecutor([redactionTool], {
        mirrorFileChanges: false,
        recordAuditEvents: false,
      })
      .execute('redaction_tool', {}, 'redact');
    assert.strictEqual(redacted.isError, false);
    assert.ok(!redacted.content.includes('supersecret'));
    assert.ok(!redacted.content.includes('hunter2'));
    assert.ok(!redacted.content.includes('abc.def.ghi'));

    let activeReads = 0;
    let maxActiveReads = 0;
    const readTool: ToolDef = {
      name: 'read_file',
      description: 'Read file',
      parameters: { type: 'object' },
      isSearchOrReadCommand: true,
      execute: async () => {
        activeReads++;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await sleep(20);
        activeReads--;
        return 'read';
      },
    };

    const batchResults = await ctx.query.executeTools(
      Array.from({ length: 5 }, (_, index) => ({ name: 'read_file', input: {}, id: `read-${index}` })),
      [readTool],
      {
        maxParallelReads: 2,
        mirrorFileChanges: false,
        recordAuditEvents: false,
      }
    );
    assert.strictEqual(batchResults.length, 5);
    assert.ok(maxActiveReads <= 2, `Expected max 2 concurrent reads, saw ${maxActiveReads}`);

    const snapshot = ctx.query.getErgonomicsSnapshot();
    assert.strictEqual(snapshot.toolExecutionDefaults.failOnUnsafeMutationPath, true);
    assert.strictEqual(snapshot.services.spider, true);

    console.info('All tool executor ergonomics and hardening checks passed.');
  } finally {
    await Promise.race([ctx.stop(), sleep(1000)]);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('TEST FAILED:', err);
    process.exit(1);
  });
