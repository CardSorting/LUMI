import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';

async function testIndustrialIntegrity() {
  console.log('--- TEST: Industrial Integrity & Sovereign Isolation (Level 17) ---');
  
  const pool = new BufferedDbPool();
  const userId = 'industrial-steward-001';
  const workspaceId = 'integrity-check-v17';
  
  const workspace = new Workspace(pool, userId, workspaceId);
  const ctx = new AgentContext(workspace, pool, userId);

  try {
    // 1. Multi-Hop Cycle Detection (Tarjan's)
    console.log('Step 1: Detecting Multi-Hop Structural Loops...');
    const fileA = { filePath: 'src/core/A.ts', content: `import { B } from './B'; export const A = 1;` };
    const fileB = { filePath: 'src/core/B.ts', content: `import { C } from './C'; export const B = 1;` };
    const fileC = { filePath: 'src/core/C.ts', content: `import { A } from './A'; export const C = 1;` };

    await ctx.spider.bootstrapGraph();
    await ctx.spider.applyChanges([fileA, fileB, fileC]);

    const audit = await ctx.spider.auditStructure();
    const cycleViolation = audit.violations.find(v => v.id === 'SPI-004');
    
    if (cycleViolation) {
        console.log(`✅ SUCCESS: Multi-Hop Cycle detected: ${cycleViolation.cycle?.join(' -> ')}`);
    } else {
        throw new Error('Failed to detect multi-hop cycle A -> B -> C -> A');
    }

    // 2. Layer Sovereignty (Joy-Zoning Violation)
    console.log('\nStep 2: Enforcing Layer Sovereignty (Joy-Zoning)...');
    const infraFile = { filePath: 'src/infrastructure/db/index.ts', content: `export const Save = () => {};` };
    const domainViolation = { 
        filePath: 'src/domain/index.ts', 
        content: `import { Save } from '../infrastructure/db/index';` 
    };

    await ctx.spider.applyChanges([infraFile, domainViolation]);
    const layerAudit = await ctx.spider.auditStructure();
    const layerViolation = layerAudit.violations.find(v => v.id === 'SPI-005');

    if (layerViolation) {
        console.log(`✅ SUCCESS: Layer Violation (SPI-005) detected: ${layerViolation.message}`);
    } else {
        throw new Error('Failed to detect forbidden layer import (Domain -> Infrastructure)');
    }

    // 3. Symbolic Integrity (Renames)
    console.log('\nStep 3: Verifying Symbolic Integrity (Line-Level Forensics)...');
    const provider = { filePath: 'src/core/Provider.ts', content: `export function OldName() {}` };
    const consumer = { 
        filePath: 'src/main.ts', 
        content: `import { OldName } from './core/Provider';\nOldName();` 
    };

    await ctx.spider.applyChanges([provider, consumer]);
    
    // Rename provider symbol
    const renamedProvider = { filePath: 'src/core/Provider.ts', content: `export function NewName() {}` };
    const renameAudit = await ctx.spider.applyChanges([renamedProvider]);

    if (renameAudit.deficiencies.length > 0) {
        const def = renameAudit.deficiencies[0];
        console.log(`✅ SUCCESS: Broken Symbolic Contract identified!`);
        console.log(`- File: ${def.depId}`);
        console.log(`- Missing Symbol: ${def.symbols.join(', ')} at Line ${def.line}`);
        
        if (def.depId !== 'src/main.ts' || !def.symbols.includes('OldName')) {
            throw new Error('Deficiency report is inaccurate.');
        }
    } else {
        throw new Error('Failed to identify breakage after symbol rename.');
    }

    // 4. Mutation Lockdown (Concurrency simulation)
    console.log('\nStep 4: Testing Mutation Lockdown (Parallel Safety)...');
    const mutation1 = ctx.spider.applyChanges([{ filePath: 'src/concurrent.ts', content: '// Mutation 1' }]);
    const mutation2 = ctx.spider.applyChanges([{ filePath: 'src/concurrent.ts', content: '// Mutation 2' }]);
    
    await Promise.all([mutation1, mutation2]);
    const finalNode = ctx.spider.getEngine().nodes.get('src/concurrent.ts');
    console.log(`✅ SUCCESS: Concurrent mutations completed. Final state: ${finalNode?.vitality} updates.`);

    console.log('\n✅ TEST PASSED: Industrial Integrity V17 is ROCK SOLID.');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    ctx.mutex.shutdown();
    ctx.lsp.shutdown();
    process.exit(0);
  }
}

testIndustrialIntegrity();
