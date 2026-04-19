import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';

async function testSovereignProofV18() {
  console.log('--- TEST: Sovereign Proof & Symbolic Displacement (Level 18) ---');
  
  const pool = new BufferedDbPool();
  const userId = 'sovereign-audit-18';
  const workspaceId = 'proof-v18';
  
  const workspace = new Workspace(pool, userId, workspaceId);
  const ctx = new AgentContext(workspace, pool, userId);

  try {
    console.log('Step 1: Establishing Starting Reality...');
    const fileA = { filePath: 'src/main.ts', content: `import { Target } from './legacy';\nTarget();` };
    const fileB = { filePath: 'src/legacy.ts', content: `export function Target() { console.log("Legacy"); }` };

    await ctx.spider.bootstrapGraph();
    await ctx.spider.applyChanges([fileA, fileB]);

    // Verify initial state
    const impact = ctx.getStructuralImpact('src/legacy.ts');
    console.log(`- Initial Blast Radius: ${impact.blastRadius.affectedNodes.length} nodes`);

    console.log('\nStep 2: Simulating Symbolic Displacement (Refactoring)...');
    // We move 'Target' from src/legacy.ts to src/new_home.ts
    const newHome = { filePath: 'src/new_home.ts', content: `export function Target() { console.log("Modern"); }` };
    const emptyLegacy = { filePath: 'src/legacy.ts', content: `// Symbol removed` };

    // Apply BOTH changes in one atomic transaction
    const result = await ctx.spider.applyChanges([newHome, emptyLegacy]);

    if (result.deficiencies.length > 0) {
        const def = result.deficiencies[0];
        console.log(`✅ SUCCESS: Displacement Detected!`);
        
        if (def.displacements.length > 0) {
            const disp = def.displacements[0];
            console.log(`- Found Symbol Identity: '${disp.symbol}' moved to '${disp.newPath}'`);
            
            if (disp.symbol === 'Target' && disp.newPath === 'src/new_home.ts') {
                console.log(`- Intelligence Check: AI can now auto-fix the import path.`);
            } else {
                throw new Error('Displacement data is incorrect.');
            }
        } else {
            throw new Error('Failed to find the displacement metadata.');
        }
    } else {
        throw new Error('No deficiency reported for the broken link.');
    }

    console.log('\n✅ TEST PASSED: Level 18 Sovereign Proof achieved.');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    ctx.mutex.shutdown();
    ctx.lsp.shutdown();
    process.exit(0);
  }
}

testSovereignProofV18();
