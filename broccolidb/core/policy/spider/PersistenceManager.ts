import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '../../../shared/services/Logger.js';
import type { SpiderNode } from '../SpiderEngine.js';

/**
 * PersistenceManager: Handles atomic binary-lite serialization for the structural graph.
 * Prevents corruption during high-concurrency write cycles.
 */
export class PersistenceManager {
  private spiderbinPath: string;

  constructor(private cwd: string) {
    this.spiderbinPath = path.join(cwd, '.spider', 'graph.spiderbin');
  }

  /**
   * Saves the graph atomicity using a staging file to prevent partial writes.
   */
  public async save(nodes: Map<string, SpiderNode>): Promise<void> {
    const dir = path.dirname(this.spiderbinPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const stagingPath = `${this.spiderbinPath}.tmp`;
    const entries = Array.from(nodes.entries()).map(([k, v]) => [
        k, 
        { ...v, imports: Array.from(v.imports), resolvedImports: Array.from(v.resolvedImports) }
    ]);
    
    // We use a binary-wrapped JSON payload for the V15 facade, 
    // ensuring we can add true binary protocol buffers later while maintaining the .spiderbin extension.
    const payload = Buffer.from(JSON.stringify(entries), 'utf-8');
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0x53504944, 0); // 'SPID' Magic Number
    header.writeUInt32BE(payload.length, 4);

    try {
      await fs.promises.writeFile(stagingPath, Buffer.concat([header, payload]));
      await fs.promises.rename(stagingPath, this.spiderbinPath);
    } catch (err) {
      Logger.error(`[SpiderPersistence] Atomic write failed: ${err}`);
      if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    }
  }

  public async load(): Promise<Map<string, SpiderNode> | null> {
    if (!fs.existsSync(this.spiderbinPath)) return null;

    try {
      const buffer = await fs.promises.readFile(this.spiderbinPath);
      const magic = buffer.readUInt32BE(0);
      if (magic !== 0x53504944) {
          throw new Error('Invalid .spiderbin magic number');
      }

      const payloadLength = buffer.readUInt32BE(4);
      const payload = buffer.subarray(8, 8 + payloadLength).toString('utf-8');
      const entries = JSON.parse(payload);
      
      return new Map(entries.map(([k, v]: [string, any]) => [
          k, 
          { ...v, imports: new Set(v.imports), resolvedImports: new Set(v.resolvedImports) }
      ]));
    } catch (err) {
      Logger.error(`[SpiderPersistence] Load failed (corrupted .spiderbin?): ${err}`);
      return null;
    }
  }
}
