import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentContext, type ToolDef } from '../core/agent-context.js';
import { QueryLoop } from '../core/agent-context/QueryLoop.ts';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  console.info('--- TEST: QueryLoop Tool Execution Ergonomics ---');

  const pool = new BufferedDbPool();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-query-loop-'));
  const workspace = new Workspace(pool, 'query-tool-user', 'query-tool-workspace');
  workspace.setPhysicalPath(workspaceRoot);
  const ctx = new AgentContext(workspace, pool, 'query-tool-user');
  await ctx.start();
  const serviceCtx = (ctx as any)._serviceContext;

  try {
    let completionCalls = 0;
    const prompts: string[] = [];
    serviceCtx.aiService = {
      isAvailable: () => true,
      getGraphForSession: async () => null,
      auditCodeAgainstRule: async () => null,
      completeOneOff: async (prompt: string) => {
        completionCalls++;
        prompts.push(prompt);
        if (completionCalls === 1) {
          return {
            text:
              'I need to inspect the file.\n```json\n{"tool_calls":[{"id":"read-1","function":{"name":"read_file","arguments":"{\\"path\\":\\"src/index.ts\\"}"}}]}\n```',
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        }
        return {
          text: prompt.includes('<tool_results>') ? 'Done after reading the file.' : 'Missing tool results.',
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
      evaluateLogicRelationship: async () => 'neutral',
      explainReasoningChain: async () => '',
    };

    const tools: ToolDef[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
        isSearchOrReadCommand: true,
        execute: async (args) => `contents:${args.path}`,
      },
    ];

    const loop = new QueryLoop(
      serviceCtx,
      [{ role: 'user', content: 'Read src/index.ts and summarize it.', timestamp: Date.now() }],
      {
        tools,
        toolExecutorOptions: {
          mirrorFileChanges: false,
          recordAuditEvents: false,
        },
        maxToolRounds: 2,
      }
    );

    const events: string[] = [];
    for await (const event of loop.run(5)) {
      events.push(event);
    }

    const state = loop.getState();
    assert.strictEqual(state.status, 'completed');
    assert.strictEqual(state.toolRounds, 1);
    assert.strictEqual(completionCalls, 2);
    assert.ok(events.some((event) => event.includes('Executing 1 tool call')));
    assert.ok(events.some((event) => event.includes('[Tool:read_file] ok')));
    assert.ok(prompts[1]?.includes('<tool_results>'));
    assert.ok(state.lastToolResults?.[0]?.content.includes('contents:src/index.ts'));

    console.info('QueryLoop tool execution ergonomics checks passed.');
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
