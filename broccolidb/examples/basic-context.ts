#!/usr/bin/env npx tsx
/** Golden path: AgentContext lifecycle + capability health. */
import { seedMinimalProject, withExampleContext, runExampleMain } from './_bootstrap.js';

async function main() {
  await withExampleContext(async (ctx, root) => {
    seedMinimalProject(root);
    const health = await ctx.health();
    console.log('lifecycle:', health.lifecycle);
    console.log('status:', health.status);
    console.log('capabilities:', Object.keys(health.capabilities).join(', '));
  });
}

runExampleMain(main);
