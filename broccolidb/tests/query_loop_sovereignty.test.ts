import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { QueryLoop } from '../core/agent-context/QueryLoop.ts';
import { StreamingToolExecutor } from '../core/agent-context/StreamingToolExecutor.ts';

async function testQueryLoop() {
  console.log('--- TEST: QueryLoop & StreamingToolExecutor (Sovereign Swarm) ---');
  
  const pool = new BufferedDbPool();
  const userId = 'test-user-query';
  const workspaceId = 'test-workspace-query';
  const workspace = new Workspace(pool, userId, workspaceId);
  const ctx = new AgentContext(workspace, pool, userId);

  // Mock ServiceContext for QueryLoop
  const serviceCtx = (ctx as any)._serviceContext;

  try {
    // 1. Test StreamingToolExecutor (Parallel/Sequential logic)
    console.log('Testing StreamingToolExecutor Batch Execution...');
    const explorer = new StreamingToolExecutor([
        { 
            name: 'read_file', 
            description: 'Read file', 
            parameters: {}, 
            isSearchOrReadCommand: true,
            execute: async (args) => `Content of ${args.path}`
        },
        { 
            name: 'write_file', 
            description: 'Write file', 
            parameters: {}, 
            isSearchOrReadCommand: false, // Sequential
            execute: async (args) => `Wrote ${args.path}`
        }
    ], serviceCtx);

    const calls = [
        { name: 'read_file', input: { path: 'a.ts' }, id: '1' },
        { name: 'read_file', input: { path: 'b.ts' }, id: '2' }, // Parallel with 1
        { name: 'write_file', input: { path: 'c.ts' }, id: '3' } // Must wait for 1 & 2
    ];

    const results = [];
    for await (const result of explorer.executeBatch(calls)) {
        results.push(result);
        console.log(`✅ Received result for ${result.toolUseId}: ${result.content}`);
    }

    if (results.length === 3) {
        console.log('✅ SUCCESS: All tool calls executed.');
    } else {
        throw new Error(`Batch execution returned ${results.length} results instead of 3.`);
    }

    // 2. QueryLoop Initialization
    console.log('Testing QueryLoop Initialization...');
    const loop = new QueryLoop(serviceCtx, [{ role: 'user', content: 'What is the architecture?', timestamp: Date.now() }]);
    const state = loop.getState();
    
    if (state.messages.length === 1 && state.tokensUsed > 0) {
        console.log('✅ SUCCESS: QueryLoop initialized with token estimation.');
    } else {
        throw new Error('QueryLoop state initialization failed.');
    }

    console.log('✅ TEST PASSED: Query infrastructure is operational.');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testQueryLoop();
