import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServiceContext } from './types.js';

/**
 * PasteStore provides content-addressable storage (CAS).
 * Absorbed from src/history.ts and src/utils/pasteStore.ts.
 * Efficiently scales knowledge persistence for large snippets.
 */
export class PasteStore {
  private _path: string;

  constructor(private ctx: ServiceContext) {
    this._path = join(process.cwd(), '.broccolidb', 'paste_store');
  }

  /**
   * Hashes content and stores it if it doesn't exist.
   * Returns the content hash (SHA-256).
   */
  async storeContent(content: string): Promise<string> {
    const hash = createHash('sha256').update(content).digest('hex');
    const shard = hash.substring(0, 2);
    const shardPath = join(this._path, shard);
    const filePath = join(shardPath, hash);

    try {
      await mkdir(shardPath, { recursive: true });
      
      // Atomic write: Write to .tmp first then rename
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, content, { encoding: 'utf8' });
      await import('node:fs/promises').then(fs => fs.rename(tmpPath, filePath));
      
      return hash;
    } catch (err) {
      console.error(`[PasteStore] ❌ Failed to write content hash ${hash}:`, err);
      throw err;
    }
  }

  /**
   * Hydrates content from a hash reference.
   */
  async hydrateContent(hash: string): Promise<string | null> {
    const shard = hash.substring(0, 2);
    const filePath = join(this._path, shard, hash);
    try {
      return await readFile(filePath, 'utf8');
    } catch (err) {
      // Log retry if missing and check for legacy flat path
      const legacyPath = join(this._path, hash);
      try {
          return await readFile(legacyPath, 'utf8');
      } catch {
          console.warn(`[PasteStore] ⚠️ Content hash ${hash} not found in CAS store:`, err);
          return null;
      }
    }
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
}
