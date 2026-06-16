// [LAYER: INFRASTRUCTURE]
// @classification MODERN
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ServiceContext } from '../../core/agent-context/types.js';
import { LifecycleStateError, StorageIntegrityError } from '../../core/errors.js';

/**
 * StorageService provides Content-Addressable Storage (CAS) for sovereign swarm memory scaling.
 * Files are stored as `shards/[h1][h2]/[hash]`, ensuring deduplication and sharded scaling.
 */
export class StorageService {
  private baseDir: string;
  private lifecycleState: 'new' | 'started' | 'stopped' = 'new';
  private corruptCount = 0;
  private migratedPasteCount = 0;

  constructor(private ctx: ServiceContext) {
    this.baseDir = join(this.ctx.workspace.workspacePath, '.broccolidb', 'storage');
  }

  async start(): Promise<void> {
    if (this.lifecycleState === 'started') return;
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError('StorageService cannot be restarted after stop().');
    }
    await fs.mkdir(join(this.baseDir, 'blobs'), { recursive: true });
    await fs.mkdir(join(this.baseDir, 'corrupt'), { recursive: true });
    this.migratedPasteCount += await this.migrateLegacyPastes();
    this.lifecycleState = 'started';
  }

  async stop(): Promise<void> {
    this.lifecycleState = 'stopped';
  }

  async flush(): Promise<void> {
    this.assertOperational('flush');
  }

  async health(): Promise<Record<string, unknown>> {
    return {
      component: 'StorageService',
      status: this.lifecycleState === 'started' ? 'healthy' : this.lifecycleState,
      baseDir: this.baseDir,
      corruptCount: this.corruptCount,
      migratedPasteCount: this.migratedPasteCount,
    };
  }

  private assertOperational(operation: string): void {
    if (this.lifecycleState === 'new') {
      throw new LifecycleStateError(`StorageService.${operation}() called before start().`);
    }
    if (this.lifecycleState === 'stopped') {
      throw new LifecycleStateError(`StorageService.${operation}() called after stop().`);
    }
  }

  /**
   * Writes content to CAS and returns the unique content hash (Blob ID).
   */
  async writeBlob(content: Buffer | string): Promise<string> {
    this.assertOperational('writeBlob');
    return this.writeBlobInternal(content);
  }

  private async writeBlobInternal(content: Buffer | string): Promise<string> {
    const hash = createHash('sha256').update(content).digest('hex');
    const shard = hash.slice(0, 2);
    const shardDir = join(this.baseDir, 'blobs', shard);
    const filePath = join(shardDir, hash);

    try {
      await fs.access(filePath);
      // Blob exists, deduplication hit.
      return hash;
    } catch {
      // New blob
    }

    await fs.mkdir(shardDir, { recursive: true });
    await fs.writeFile(filePath, content);
    console.log(`[Storage] 📦 CAS Write: ${hash.slice(0, 8)}... (shard: ${shard})`);
    return hash;
  }

  /**
   * Reads content from CAS via its Blob ID.
   */
  async readBlob(hash: string): Promise<Buffer | null> {
    this.assertOperational('readBlob');
    const shard = hash.slice(0, 2);
    const filePath = join(this.baseDir, 'blobs', shard, hash);
    try {
      const content = await fs.readFile(filePath);
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== hash) {
        await this.quarantineCorruptBlob({
          expectedHash: hash,
          actualHash,
          filePath,
          reason: 'sha256_mismatch',
        });
      }
      return content;
    } catch (error: any) {
      if (error instanceof StorageIntegrityError) throw error;
      if (error?.code !== 'ENOENT') throw error;
      return null;
    }
  }

  /**
   * Checks if a blob exists in CAS.
   */
  async exists(hash: string): Promise<boolean> {
    this.assertOperational('exists');
    const shard = hash.slice(0, 2);
    const filePath = join(this.baseDir, 'blobs', shard, hash);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes a blob from CAS.
   */
  async deleteBlob(hash: string): Promise<void> {
    this.assertOperational('deleteBlob');
    const shard = hash.slice(0, 2);
    const filePath = join(this.baseDir, 'blobs', shard, hash);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignored
    }
  }

  /**
   * Hashes content and stores it if it doesn't exist.
   * Returns the content hash (SHA-256).
   */
  async storeContent(content: string): Promise<string> {
    return this.writeBlob(content);
  }

  /**
   * Hydrates content from a hash reference.
   */
  async hydrateContent(hash: string): Promise<string | null> {
    const content = await this.readBlob(hash);
    return content ? content.toString('utf8') : null;
  }

  /**
   * Detaches content if it's large and returns a hash reference.
   */
  async handleScaling(content: string): Promise<{ content: string; isReference: boolean }> {
    // Scale if content > 1024 chars (threshold from Level 12 plan)
    if (content.length > 1024) {
      const hash = await this.storeContent(content);
      return { content: `CAS:${hash}`, isReference: true };
    }
    return { content, isReference: false };
  }

  private async quarantineCorruptBlob(params: {
    expectedHash: string;
    actualHash: string;
    filePath: string;
    reason: string;
  }): Promise<never> {
    const corruptDir = join(this.baseDir, 'corrupt');
    await fs.mkdir(corruptDir, { recursive: true });

    const quarantinedPath = join(
      corruptDir,
      `${params.expectedHash}.${Date.now()}.${basename(params.filePath)}.corrupt`
    );
    await fs.rename(params.filePath, quarantinedPath);

    const manifestEntry = {
      timestamp: new Date().toISOString(),
      reason: params.reason,
      expectedHash: params.expectedHash,
      actualHash: params.actualHash,
      originalPath: params.filePath,
      quarantinedPath,
    };
    await fs.appendFile(join(corruptDir, 'manifest.jsonl'), `${JSON.stringify(manifestEntry)}\n`);
    this.corruptCount++;

    throw new StorageIntegrityError(
      `CAS blob integrity check failed for ${params.expectedHash}; quarantined corrupt payload.`
    );
  }

  private async migrateLegacyPastes(): Promise<number> {
    const roots = [
      join(this.ctx.workspace.workspacePath, '.broccolidb', 'pastes'),
      join(this.ctx.workspace.workspacePath, 'pastes'),
    ];
    let migrated = 0;

    for (const root of roots) {
      migrated += await this.migratePasteDirectory(root);
    }

    return migrated;
  }

  private async migratePasteDirectory(root: string): Promise<number> {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      return 0;
    }

    let migrated = 0;
    for (const entry of entries) {
      const entryPath = join(root, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        migrated += await this.migratePasteDirectory(entryPath);
        continue;
      }

      const content = await fs.readFile(entryPath);
      await this.writeBlobInternal(content);
      await fs.unlink(entryPath);
      migrated++;
    }
    return migrated;
  }
}
