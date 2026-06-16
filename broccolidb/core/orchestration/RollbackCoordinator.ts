// [LAYER: CORE]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileSnapshot } from './types.js';
import type { ExecutionTrace } from './ExecutionTrace.js';

export class RollbackCoordinator {
  private readonly snapshots = new Map<string, FileSnapshot>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly trace: ExecutionTrace
  ) {}

  snapshotBefore(files: string[], sessionId: string): string[] {
    const ids: string[] = [];
    for (const filePath of files) {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.workspaceRoot, filePath);
      if (!fs.existsSync(absolute)) continue;
      const snapshotId = randomUUID();
      const content = fs.readFileSync(absolute, 'utf8');
      this.snapshots.set(snapshotId, {
        snapshotId,
        filePath,
        content,
        capturedAt: Date.now(),
      });
      ids.push(snapshotId);
    }
    this.trace.emit(sessionId, 'rollback_started', { snapshotCount: ids.length, files });
    return ids;
  }

  restore(snapshotIds: string[], sessionId: string): { restored: string[]; failed: string[] } {
    const restored: string[] = [];
    const failed: string[] = [];

    for (const snapshotId of snapshotIds) {
      const snap = this.snapshots.get(snapshotId);
      if (!snap) {
        failed.push(snapshotId);
        continue;
      }
      const absolute = path.isAbsolute(snap.filePath)
        ? snap.filePath
        : path.join(this.workspaceRoot, snap.filePath);
      try {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, snap.content, 'utf8');
        restored.push(snap.filePath);
      } catch {
        failed.push(snap.filePath);
      }
    }

    this.trace.emit(sessionId, 'rollback_completed', { restored, failed });
    return { restored, failed };
  }

  discard(snapshotIds: string[]): void {
    for (const id of snapshotIds) {
      this.snapshots.delete(id);
    }
  }

  getSnapshot(snapshotId: string): FileSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  clear(): void {
    this.snapshots.clear();
  }
}
