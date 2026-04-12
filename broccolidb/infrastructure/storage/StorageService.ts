import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ServiceContext } from '../../core/agent-context/types.js';

/**
 * StorageService provides Content-Addressable Storage (CAS) for sovereign swarm memory scaling.
 * Files are stored as `shards/[h1][h2]/[hash]`, ensuring deduplication and sharded scaling.
 */
export class StorageService {
  private baseDir: string;

  constructor(private ctx: ServiceContext) {
    this.baseDir = join(this.ctx.workspace.workspacePath, '.broccolidb', 'storage');
  }

  /**
   * Writes content to CAS and returns the unique content hash (Blob ID).
   */
  async writeBlob(content: Buffer | string): Promise<string> {
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
    const shard = hash.slice(0, 2);
    const filePath = join(this.baseDir, 'blobs', shard, hash);
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  /**
   * Checks if a blob exists in CAS.
   */
  async exists(hash: string): Promise<boolean> {
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
    const shard = hash.slice(0, 2);
    const filePath = join(this.baseDir, 'blobs', shard, hash);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignored
    }
  }
}
