#!/usr/bin/env npx tsx
/** Golden path: ctx.health() deep check + runtime memory health. */
import { seedMinimalProject, withExampleContext, runExampleMain } from './_bootstrap.js';

async function main() {
  await withExampleContext(async (ctx, root) => {
    seedMinimalProject(root);
    const health = await ctx.health({ deep: true });
    const memory = ctx.runtime.getMemoryHealth();
    console.log('broccolidb status:', health.status);
    console.log('lifecycle:', health.lifecycle);
    console.log('graph integrity:', memory.graphIntegrity);
    console.log('snapshots:', memory.snapshotCount);
    for (const [name, cap] of Object.entries(health.capabilities)) {
      console.log(`  ${name}: ${cap.status}`);
    }
  });
}

runExampleMain(main);
