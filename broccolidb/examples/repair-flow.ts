#!/usr/bin/env npx tsx
/** Golden path: audit → plan → preview (repair flow without autonomous mutation). */
import { seedMinimalProject, withExampleContext, runExampleMain } from './_bootstrap.js';

async function main() {
  await withExampleContext(async (ctx, root) => {
    seedMinimalProject(root);
    const session = await ctx.runtime.beginSession({ taskId: 'repair-flow-example' });
    const audit = await ctx.graph.spider.audit({ scope: 'all', includeRepairDirectives: true });
    ctx.runtime.recordAudit(session.sessionId, audit);
    const gate = await ctx.graph.spider.gate({ scope: 'all' });
    if (gate.blocked && audit.repairDirectives.length > 0) {
      const plan = ctx.runtime.planRepairs({
        audit,
        sessionId: session.sessionId,
        policy: 'human_approval_required',
      });
      const preview = ctx.runtime.preview(plan, 'human_approval_required');
      console.log('plan steps:', plan.steps.length);
      console.log('preview allowed:', preview.policyDecision.allowed);
      console.log('narrative lines:', preview.narrative.length);
    } else {
      console.log('no repair needed — gate passed');
    }
    const state = ctx.runtime.state(session.sessionId);
    console.log('session status:', state.status);
  });
}

runExampleMain(main);
