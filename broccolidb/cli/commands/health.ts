// [LAYER: UI]
import { bootstrapContext, parseFormat, printOutput } from '../lib/context.js';

export async function healthCommand(args: string[]): Promise<void> {
  const format = parseFormat(args);
  const { ctx } = await bootstrapContext();
  try {
    const health = await ctx.health({ deep: args.includes('--deep') });
    const runtime = ctx.runtime.getMemoryHealth();

    if (format === 'human' || format === 'compact') {
      printOutput(
        { health, runtime },
        format,
        [
          `Status: ${health.status}`,
          `Lifecycle: ${health.lifecycle}`,
          `Runtime mode: ${ctx.runtime.getMode()}`,
          `Graph integrity: ${runtime.graphIntegrity}`,
          `Snapshots: ${runtime.snapshotCount}`,
          `Capabilities: ${Object.keys(health.capabilities).length} registered`,
        ]
      );
    } else {
      printOutput({ health, runtime }, format);
    }
  } finally {
    await ctx.stop();
  }
}
