import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function testGC() {
  console.log('--- TEST: GC Sovereignty (Pass 2) ---');
  
  const pool = new BufferedDbPool();
  const userId = 'test-user-gc';
  const workspaceId = 'test-workspace-gc';
  const workspace = new Workspace(pool, userId, workspaceId);
  const ctx = new AgentContext(workspace, pool, userId);

  try {
    // 1. Test Task Output Pruning
    console.log('Testing Task Output Pruning...');
    const taskDir = path.resolve(process.cwd(), '.broccolidb', 'tasks');
    if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
    
    const oldFile = path.join(taskDir, 'old-task.output');
    fs.writeFileSync(oldFile, 'old content');
    // Manually backdate the file to 10 days ago
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    const result = await ctx.cleanup.performGarbageCollection();
    console.log(`Pruned tasks count: ${result.prunedTaskOutputs}`);
    
    if (!fs.existsSync(oldFile)) {
        console.log('✅ SUCCESS: Old task output pruned.');
    } else {
        throw new Error('Old task output still exists!');
    }

    // 2. Test Epistemic Sunsetting
    console.log('Testing Epistemic Sunsetting...');
    await ctx.graph.addKnowledge('low-conf-node', 'fact', 'stale info', { confidence: 0.1 });
    await ctx.graph.addKnowledge('high-conf-node', 'fact', 'fresh info', { confidence: 0.9 });
    
    const initialCount = (await pool.selectWhere('knowledge', [{ column: 'userId', value: userId }])).length;
    console.log(`Initial node count: ${initialCount}`);
    
    const prunedCount = await ctx.cleanup.performEpistemicSunsetting(0.2);
    console.log(`Pruned nodes count: ${prunedCount}`);
    
    const finalNodes = await pool.selectWhere('knowledge', [{ column: 'userId', value: userId }]);
    const hasLowConf = finalNodes.some(n => n.id === 'low-conf-node');
    const hasHighConf = finalNodes.some(n => n.id === 'high-conf-node');
    
    if (!hasLowConf && hasHighConf) {
        console.log('✅ SUCCESS: Epistemic sunsetting performed correctly.');
    } else {
        throw new Error(`Sunsetting logic failed. LowConf: ${hasLowConf}, HighConf: ${hasHighConf}`);
    }

    console.log('✅ ALL GC TESTS PASSED.');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testGC();
