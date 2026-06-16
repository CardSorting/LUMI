#!/usr/bin/env npx tsx
/** Demonstrates GuidedError on lifecycle misuse — see docs/errors.md */
import { GuidedError } from '../core/error-guidance.js';
import { AgentContext } from '../core/agent-context.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { runExampleMain } from './_bootstrap.js';

async function main() {
  const pool = new BufferedDbPool();
  const ws = new Workspace(pool, 'demo-user', 'demo-ws');
  const ctx = new AgentContext(ws, pool, 'demo-user');
  try {
    await ctx.query.search({ text: 'test' });
  } catch (e) {
    if (e instanceof GuidedError) {
      console.log('error code:', e.code);
      console.log(e.message.split('\n')[0]);
      return;
    }
    throw e;
  }
}

runExampleMain(main);
