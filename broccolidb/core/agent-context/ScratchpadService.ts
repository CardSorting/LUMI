import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ServiceContext } from './types.js';
import { StorageService } from '../../infrastructure/storage/StorageService.js';

/**
 * ScratchpadService provides a durable, cross-worker file-based scratchpad.
 * Hardened with CAS-based writes for memory scaling and deduplication.
 */
export class ScratchpadService {
  private scratchDir: string;
  private lockDir: string;
  private storage: StorageService;

  constructor(private ctx: ServiceContext) {
    this.scratchDir = join(this.ctx.workspace.workspacePath, '.broccolidb', 'scratchpad');
    this.lockDir = join(this.ctx.workspace.workspacePath, '.broccolidb', 'locks');
    this.storage = new StorageService(this.ctx);
  }

  /**
   * Initializes directories.
   */
  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.scratchDir, { recursive: true });
    await fs.mkdir(this.lockDir, { recursive: true });
  }

  /**
   * Acquires a file-based lock.
   */
  private async acquireLock(filename: string): Promise<void> {
    const lockPath = join(this.lockDir, `${filename}.lock`);
    let retries = 0;
    while (retries < 100) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.close();
        return;
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          retries++;
          await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`[Scratchpad] 🔒 Timeout acquiring lock for ${filename}`);
  }

  /**
   * Releases a file-based lock.
   */
  private async releaseLock(filename: string): Promise<void> {
    const lockPath = join(this.lockDir, `${filename}.lock`);
    try {
      await fs.unlink(lockPath);
    } catch {
      // Ignore
    }
  }

  /**
   * Writes a durable finding to the scratchpad using CAS.
   */
  async write(filename: string, content: string): Promise<string> {
    await this.ensureDirs();
    await this.acquireLock(filename);
    try {
      // 1. Write content to CAS (Deduplication)
      const blobHash = await this.storage.writeBlob(content);

      // 2. Update scratchpad pointer (Atomicity)
      const filePath = join(this.scratchDir, filename);
      await fs.writeFile(filePath, blobHash, 'utf8');

      console.log(`[Scratchpad] ✍️  Written CAS link ${blobHash.slice(0, 8)}... to ${filename}`);
      return filePath;
    } finally {
      await this.releaseLock(filename);
    }
  }

  /**
   * Reads a durable finding from the scratchpad via CAS link.
   */
  async read(filename: string): Promise<string | null> {
    try {
      const filePath = join(this.scratchDir, filename);
      const blobHash = await fs.readFile(filePath, 'utf8');
      
      const content = await this.storage.readBlob(blobHash);
      return content?.toString('utf8') || null;
    } catch {
      return null;
    }
  }

  /**
   * Lists all files currently in the scratchpad.
   */
  async list(): Promise<string[]> {
    try {
      await this.ensureDirs();
      const files = await fs.readdir(this.scratchDir);
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Clears the entire scratchpad (removes links).
   */
  async clear(): Promise<void> {
    try {
      const files = await this.list();
      for (const file of files) {
        await fs.unlink(join(this.scratchDir, file));
      }
      console.log(`[Scratchpad] 🧹 Scratchpad links cleared.`);
    } catch {
      // Ignored
    }
  }
}
