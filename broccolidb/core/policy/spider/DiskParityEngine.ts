// [LAYER: CORE]
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpiderNode } from './types.js';
import type { DiskParityResult, DriftStatus } from './report-types.js';

export class DiskParityEngine {
  constructor(private readonly cwd: string) {}

  hashFileContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  hashDiskFile(absolutePath: string): string | null {
    if (!fs.existsSync(absolutePath)) return null;
    const content = fs.readFileSync(absolutePath, 'utf-8');
    return this.hashFileContent(content);
  }

  verifyDiskParity(nodes: Map<string, SpiderNode>, scope?: Set<string>): DiskParityResult[] {
    const results: DiskParityResult[] = [];

    for (const node of nodes.values()) {
      if (scope && !scope.has(node.path)) continue;

      const absolutePath = path.resolve(this.cwd, node.path);
      let diskHash = '';
      let graphHash = '';
      let lastModifiedAt = 0;
      let driftStatus: DriftStatus = 'unknown';

      if (!fs.existsSync(absolutePath)) {
        driftStatus = 'missing';
        graphHash = this.sha256Hex(node.hash);
      } else {
        const stats = fs.statSync(absolutePath);
        lastModifiedAt = stats.mtimeMs;
        const content = fs.readFileSync(absolutePath, 'utf-8');
        diskHash = this.hashFileContent(content);
        const md5Anchor = crypto.createHash('md5').update(content).digest('hex');
        const graphMatchesDisk = md5Anchor === node.hash;
        graphHash = graphMatchesDisk ? diskHash : this.sha256Hex(node.hash);
        driftStatus = graphMatchesDisk ? 'clean' : 'drifted';
      }

      results.push({
        filePath: node.path,
        graphHash,
        diskHash,
        lastIndexedAt: node.mtime ?? 0,
        lastModifiedAt,
        driftStatus,
      });
    }

    return results;
  }

  private sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
