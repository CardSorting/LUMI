// [LAYER: UI]
import { bootstrapContext, parseFormat, printOutput } from '../lib/context.js';

export async function runtimeCommand(sub: string, args: string[]): Promise<void> {
  const sessionId = args.find((a) => !a.startsWith('--') && a !== sub);
  if (!sessionId) {
    console.error('Usage: broccolidb runtime <state|replay|story|snapshot> <sessionId> [--format json]');
    process.exit(1);
  }
  const format = parseFormat(args);
  const { ctx } = await bootstrapContext();
  try {
    switch (sub) {
      case 'state': {
        const state = ctx.runtime.state(sessionId);
        printOutput(state, format, [
          `Session: ${state.sessionId}`,
          `Status: ${state.status}`,
          `Success: ${state.success}`,
          `Blockers: ${state.summary.openBlockerCount}`,
        ]);
        break;
      }
      case 'replay': {
        const replay = await ctx.runtime.replay(sessionId, { mode: 'forensic' });
        printOutput(replay, format, [`Replay session ${sessionId} (readonly)`]);
        break;
      }
      case 'story': {
        const story = ctx.runtime.story(sessionId);
        if (format === 'json' || format === 'compact') {
          printOutput(story, format);
        } else {
          console.log(story.narrative);
        }
        break;
      }
      case 'snapshot': {
        const snap = await ctx.runtime.snapshot(sessionId);
        printOutput(snap, format, [
          `Snapshot: ${snap.snapshotId}`,
          `Hash: ${snap.graphHash.slice(0, 12)}...`,
          `Nodes: ${snap.nodeCount} Edges: ${snap.edgeCount}`,
        ]);
        break;
      }
      default:
        console.error(`Unknown runtime subcommand: ${sub}`);
        process.exit(1);
    }
  } finally {
    await ctx.flush();
    await ctx.stop();
  }
}
