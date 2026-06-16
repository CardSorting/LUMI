// [LAYER: UI]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentContext } from '../../core/agent-context.js';
import { Connection } from '../../core/connection.js';
import { Workspace } from '../../core/workspace.js';

export type OutputFormat = 'human' | 'compact' | 'json' | 'sarif';

export async function bootstrapContext(cwd = process.cwd()) {
  const dbPath = path.resolve(cwd, 'broccolidb.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run: npx broccolidb init`);
  }
  const conn = new Connection({ dbPath });
  const pool = conn.getPool();
  await pool.start();
  const userId = 'local-user';
  const workspaceId = 'local-workspace';
  const ws = new Workspace(pool, userId, workspaceId);
  ws.setPhysicalPath(cwd);
  await ws.init();
  const ctx = new AgentContext(ws, pool, userId);
  await ctx.start();
  return { ctx, pool, ws, dbPath };
}

export function parseFormat(args: string[]): OutputFormat {
  const idx = args.indexOf('--format');
  if (idx >= 0 && args[idx + 1]) {
    const f = args[idx + 1] as OutputFormat;
    if (['human', 'compact', 'json', 'sarif'].includes(f)) return f;
  }
  return 'human';
}

export function printOutput(data: unknown, format: OutputFormat, humanLines?: string[]): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (format === 'compact') {
    console.log(JSON.stringify(data));
    return;
  }
  if (format === 'sarif' && typeof data === 'object' && data && 'content' in data) {
    console.log((data as { content: string }).content);
    return;
  }
  for (const line of humanLines ?? []) {
    console.log(line);
  }
}
