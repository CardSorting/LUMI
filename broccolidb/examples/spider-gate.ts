#!/usr/bin/env npx tsx
/** Golden path: Spider gate via ctx.graph.spider (never raw SpiderService). */
import { seedMinimalProject, withExampleContext, runExampleMain } from './_bootstrap.js';

async function main() {
  await withExampleContext(async (ctx, root) => {
    seedMinimalProject(root);
    const session = await ctx.runtime.beginSession({ taskId: 'spider-gate-example' });
    const audit = await ctx.graph.spider.audit({ scope: 'all', includeRepairDirectives: true });
    ctx.runtime.recordAudit(session.sessionId, audit);
    const gate = await ctx.graph.spider.gate({ scope: 'all' });
    ctx.runtime.recordGate(session.sessionId, gate.exitCode, audit.reportId);
    console.log('sessionId:', session.sessionId);
    console.log('gate blocked:', gate.blocked);
    console.log('exit code:', gate.exitCode);
    console.log('findings:', audit.findings.length);
  });
}

runExampleMain(main);
