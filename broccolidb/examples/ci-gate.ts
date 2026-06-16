#!/usr/bin/env npx tsx
/** Golden path: CI gate digest for pipelines. */
import { seedMinimalProject, withExampleContext, runExampleMain } from './_bootstrap.js';

async function main() {
  await withExampleContext(async (ctx, root) => {
    seedMinimalProject(root);
    const check = await ctx.graph.spider.check({ phase: 'ci', scope: 'all', includeTypes: false });
    const digest = ctx.graph.spider.formatCheckDigest(check);
    console.log('exit code:', check.exitCode);
    console.log('--- digest ---');
    console.log(digest);
    process.exitCode = check.exitCode;
  });
}

runExampleMain(main);
