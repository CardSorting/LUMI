#!/usr/bin/env npx tsx
/** Golden path: snapshot → stop → restart → replay → story. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';
import { seedMinimalProject, runExampleMain } from './_bootstrap.js';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-example-'));
  setDbPath(path.join(root, 'replay.db'));
  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'replay-user', 'replay-ws');
  workspace.setPhysicalPath(root);
  seedMinimalProject(root);

  let sessionId = '';
  const ctx1 = new AgentContext(workspace, pool, 'replay-user');
  await ctx1.start();
  try {
    const session = await ctx1.runtime.beginSession({ taskId: 'replay-example' });
    sessionId = session.sessionId;
    const audit = await ctx1.graph.spider.audit({ scope: 'all' });
    ctx1.runtime.recordAudit(sessionId, audit);
    const snap = await ctx1.runtime.snapshot(sessionId);
    console.log('snapshot:', snap.snapshotId);
    await ctx1.flush();
  } finally {
    await ctx1.stop();
  }

  const pool2 = new BufferedDbPool();
  await pool2.start();
  const workspace2 = new Workspace(pool2, 'replay-user', 'replay-ws');
  workspace2.setPhysicalPath(root);
  await workspace2.init();
  const ctx2 = new AgentContext(workspace2, pool2, 'replay-user');
  await ctx2.start();
  try {
    const replay = await ctx2.runtime.replay(sessionId, { mode: 'forensic' });
    const story = ctx2.runtime.story(sessionId);
    console.log('replay session:', replay.sessionId);
    console.log('story narrative length:', story.narrative.length);
    console.log('what happened events:', story.whatHappened.length);
  } finally {
    await ctx2.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runExampleMain(main);
