/**
 * Shared bootstrap for golden-path examples.
 * Expected: creates temp workspace, starts AgentContext, returns cleanup.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

export async function withExampleContext<T>(
  fn: (ctx: AgentContext, root: string) => Promise<T>
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccoli-example-'));
  setDbPath(path.join(root, 'example.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'example-user', 'example-ws');
  workspace.setPhysicalPath(root);
  const ctx = new AgentContext(workspace, pool, 'example-user');
  await ctx.start();
  try {
    return await fn(ctx, root);
  } finally {
    await ctx.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export function runExampleMain(main: () => Promise<void>): void {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export function seedMinimalProject(root: string): void {
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'index.ts'), 'export const value = 1;\n');
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] })
  );
}
