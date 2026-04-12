import type { ServiceContext } from './types.js';

/**
 * MutexService provides fault-tolerant distributed locking.
 * Absorbed from src/utils/cronTasksLock.ts.
 * Uses a 'Sovereign Fencing Token' to prevent split-brain graph corruption.
 */
export class MutexService {
  private _fencingToken: number = Date.now();
  private _heartbeats: Map<string, NodeJS.Timeout> = new Map();

  constructor(private ctx: ServiceContext) {}

  /**
   * Acquires a lock on a shared resource with active heartbeats.
   * If the lock is held by a dead PID, it automatically annexes it.
   * Returns a fencing token if successful, or null otherwise.
   */
  async acquireLock(resource: string): Promise<number | null> {
    console.log(`[Mutex] 🛡️ Attempting to acquire lock: ${resource}...`);
    
    const existingResults = await this.ctx.db.selectWhere('swarm_locks' as any, { column: 'resource', value: resource }) as any[];
    const existing = existingResults.length > 0 ? existingResults[0] : null;
    
    if (existing) {
        const pid = Number(existing.ownerId);
        const expiresAt = Number(existing.expiresAt);
        const isExpired = Date.now() > expiresAt;
        const isDead = !this._isProcessAlive(pid);
        
        if (isDead || isExpired) {
            console.log(`[Mutex] 💀 Detected ${isDead ? 'stale' : 'expired'} lock from Owner ${pid}. Annexing...`);
            await this.ctx.db.push({
                type: 'delete',
                table: 'swarm_locks',
                where: { column: 'resource', value: resource }
            });
        } else {
            console.warn(`[Mutex] 🔒 Resource ${resource} is locked by active PID ${pid}.`);
            return null;
        }
    }

    // Acquire lock
    this._fencingToken++;
    const token = this._fencingToken;
    
    try {
        await this.ctx.db.push({
            type: 'insert',
            table: 'swarm_locks',
            values: {
                resource,
                ownerId: process.pid.toString(),
                expiresAt: Date.now() + 60000, // 60s initial TTL
                createdAt: Date.now()
            }
        });
    } catch (err) {
        console.error(`[Mutex] ❌ Failed to insert lock for ${resource}. Likely a race condition.`, err);
        return null;
    }

    this._startHeartbeat(resource);
    return token;
  }

  /**
   * Releases a lock and stops heartbeats.
   */
  async releaseLock(resource: string): Promise<void> {
      console.log(`[Mutex] 🔓 Releasing lock: ${resource}`);
      const hb = this._heartbeats.get(resource);
      if (hb) {
          clearInterval(hb);
          this._heartbeats.delete(resource);
      }

      await this.ctx.db.push({
          type: 'delete',
          table: 'swarm_locks',
          where: { column: 'resource', value: resource }
      });
  }

  private _startHeartbeat(resource: string) {
      if (this._heartbeats.has(resource)) return;

      const interval = setInterval(async () => {
          try {
              // Verify we still own the lock before heartbeat
              const existingResults = await this.ctx.db.selectWhere('swarm_locks' as any, { column: 'resource', value: resource }) as any[];
              const existing = existingResults.length > 0 ? existingResults[0] : null;
              
              if (!existing || existing.ownerId !== process.pid.toString()) {
                  console.error(`[Mutex] ⚠️ Lost lock ownership for ${resource}. Stopping heartbeat.`);
                  this._stopHeartbeat(resource);
                  return;
              }

              console.log(`[Mutex] 💓 Heartbeat for ${resource}...`);
              await this.ctx.db.push({
                  type: 'update',
                  table: 'swarm_locks',
                  where: { column: 'resource', value: resource },
                  values: { expiresAt: Date.now() + 60000 }
              });
          } catch (err) {
              console.error(`[Mutex] ❌ Heartbeat failed for ${resource}`, err);
          }
      }, 20000); // Pulse every 20s

      this._heartbeats.set(resource, interval);
  }

  private _stopHeartbeat(resource: string) {
      const hb = this._heartbeats.get(resource);
      if (hb) {
          clearInterval(hb);
          this._heartbeats.delete(resource);
      }
  }

  private _isProcessAlive(pid: number): boolean {
    try {
      if (pid === process.pid) return true;
      // On some systems, process.kill(pid, 0) might throw if we don't have permissions
      // even if the process is alive. But for local swarm agents it should be fine.
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code === 'EPERM'; // If EPERM, the process is alive but we can't signal it
    }
  }

  public get fencingToken(): number {
    return this._fencingToken;
  }

  public shutdown() {
      for (const hb of this._heartbeats.values()) {
          clearInterval(hb);
      }
      this._heartbeats.clear();
  }
}
