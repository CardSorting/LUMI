// [LAYER: UI]
import { bootstrapContext, parseFormat, printOutput } from '../lib/context.js';

export async function spiderGateCommand(args: string[]): Promise<void> {
  const format = parseFormat(args);
  const scope = args.includes('--all') ? 'all' : 'changed-files';
  const { ctx } = await bootstrapContext();
  try {
    const session = await ctx.runtime.beginSession({ taskId: 'cli-spider-gate' });
    const audit = await ctx.graph.spider.audit({ scope, includeRepairDirectives: true });
    ctx.runtime.recordAudit(session.sessionId, audit);
    const gate = await ctx.graph.spider.gate({ scope });
    ctx.runtime.recordGate(session.sessionId, gate.exitCode, audit.reportId);

    const payload = {
      sessionId: session.sessionId,
      reportId: audit.reportId,
      blocked: gate.blocked,
      exitCode: gate.exitCode,
      findingCount: audit.findings.length,
      directiveCount: audit.repairDirectives.length,
    };

    if (format === 'human') {
      printOutput(payload, format, [
        `Gate: ${gate.blocked ? 'BLOCKED' : 'PASSED'} (exit ${gate.exitCode})`,
        `Findings: ${audit.findings.length}`,
        `Directives: ${audit.repairDirectives.length}`,
        `Session: ${session.sessionId}`,
      ]);
    } else if (format === 'sarif') {
      const exported = ctx.runtime.export(session.sessionId, { format: 'sarif' });
      printOutput(exported, 'sarif');
    } else {
      printOutput(payload, format);
    }
    process.exitCode = gate.exitCode;
  } finally {
    await ctx.stop();
  }
}

export async function spiderCompactCommand(args: string[]): Promise<void> {
  const format = parseFormat(args);
  const { ctx } = await bootstrapContext();
  try {
    const result = await ctx.graph.spider.check({ phase: 'ci', scope: 'all', includeTypes: false });
    const digest = ctx.graph.spider.formatCheckDigest(result);
    if (format === 'json' || format === 'compact') {
      printOutput({ digest, exitCode: result.exitCode }, format);
    } else {
      console.log(digest);
    }
    process.exitCode = result.exitCode;
  } finally {
    await ctx.stop();
  }
}
