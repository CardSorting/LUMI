import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentContext } from '../core/agent-context.js';
import { StorageIntegrityError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';
import { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { setDbPath } from '../infrastructure/db/Config.js';

async function runTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'broccolidb-storage-'));
  setDbPath(path.join(root, 'storage.db'));

  const pool = new BufferedDbPool();
  const workspace = new Workspace(pool, 'storage-user', 'storage-workspace');
  workspace.setPhysicalPath(root);
  const context = new AgentContext(workspace, pool, 'storage-user');

  await context.start();
  try {
    const { hash } = await context.storage.store({ content: 'trusted payload' });
    assert.strictEqual((await context.storage.hydrate({ hash })).content, 'trusted payload');

    const blobPath = path.join(root, '.broccolidb', 'storage', 'blobs', hash.slice(0, 2), hash);
    fs.writeFileSync(blobPath, 'compromised payload');

    await assert.rejects(() => context.storage.hydrate({ hash }), StorageIntegrityError);

    const corruptDir = path.join(root, '.broccolidb', 'storage', 'corrupt');
    const corruptFiles = fs.readdirSync(corruptDir).filter((name) => name.endsWith('.corrupt'));
    assert.strictEqual(corruptFiles.length, 1);

    const manifest = fs.readFileSync(path.join(corruptDir, 'manifest.jsonl'), 'utf8').trim();
    const entry = JSON.parse(manifest);
    assert.strictEqual(entry.expectedHash, hash);
    assert.strictEqual(entry.reason, 'sha256_mismatch');
  } finally {
    await context.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('storage_integrity.test failed:', error);
    process.exit(1);
  });
