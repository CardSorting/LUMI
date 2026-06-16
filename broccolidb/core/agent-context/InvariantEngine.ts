// [LAYER: CORE]
// @classification MODERN
import * as fs from 'node:fs';
import * as path from 'node:path';

export class InvariantEngine {
  constructor(private workspacePath: string) {}

  public async auditInvariants(): Promise<string[]> {
    const violations: string[] = [];
    const broccolidbRoot = fs.existsSync(path.resolve(this.workspacePath, 'broccolidb'))
      ? path.resolve(this.workspacePath, 'broccolidb')
      : this.workspacePath;

    // 1. Check for banned files on disk
    const bannedFiles = [
      'telemetry_queue.db',
      'telemetry_queue.db-wal',
      'telemetry_queue.db-shm',
      path.relative(this.workspacePath, path.join(broccolidbRoot, 'infrastructure/queue/SqliteQueue.ts')),
      path.relative(this.workspacePath, path.join(broccolidbRoot, 'core/agent-context/PasteStore.ts'))
    ];

    for (const f of bannedFiles) {
      const full = path.resolve(this.workspacePath, f);
      if (fs.existsSync(full)) {
        violations.push(`Banned file exists on disk: ${f}`);
      }
    }

    const scanForBannedDbFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const item of fs.readdirSync(dir)) {
        if (item === 'node_modules' || item === 'dist' || item === '.git') continue;
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scanForBannedDbFiles(full);
        } else if (item.startsWith('telemetry_queue.db')) {
          violations.push(`Banned telemetry queue database exists on disk: ${path.relative(this.workspacePath, full)}`);
        }
      }
    };
    scanForBannedDbFiles(this.workspacePath);

    // 2. Scan source files for banned symbols and direct SQLite instantiations
    const filesToScan: string[] = [];
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const list = fs.readdirSync(dir);
      for (const item of list) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (item !== 'node_modules' && item !== 'tests' && item !== 'dist' && item !== 'out' && item !== 'webview-ui') {
            scanDir(full);
          }
        } else if (item.endsWith('.ts') || item.endsWith('.js')) {
          filesToScan.push(full);
        }
      }
    };

    scanDir(path.resolve(broccolidbRoot, 'core'));
    scanDir(path.resolve(broccolidbRoot, 'infrastructure'));
    scanDir(path.resolve(broccolidbRoot, 'cli'));

    const bannedPatterns = [
      { regex: /SqliteQueue/g, name: 'SqliteQueue' },
      { regex: /AsyncTelemetryQueue/g, name: 'AsyncTelemetryQueue' },
      { regex: /telemetryQueue/g, name: 'telemetryQueue' },
      { regex: /telemetry_queue\.db/g, name: 'telemetry_queue.db' }
    ];

    for (const file of filesToScan) {
      const content = fs.readFileSync(file, 'utf8');
      const relative = path.relative(this.workspacePath, file);
      const isInvariantEngine = relative.includes('InvariantEngine.ts') || relative.includes('InvariantEngine.js');

      // Check banned patterns
      for (const pattern of bannedPatterns) {
        if (pattern.regex.test(content)) {
          // Special exception: allow banned patterns in this InvariantEngine itself!
          if (isInvariantEngine || relative.includes('errors.ts')) continue;
          violations.push(`Forbidden symbol '${pattern.name}' referenced in file: ${relative}`);
        }
      }

      // Check for direct better-sqlite3 instantiations
      if (content.includes('new Database(') || content.includes("require('better-sqlite3')") || content.includes('import Database from \'better-sqlite3\'')) {
        const isConfig = relative.includes('infrastructure/db/Config.ts') || relative.includes('infrastructure/db/Config.js');
        if (!isConfig && !isInvariantEngine) {
          violations.push(`Bypassing BufferedDbPool: Direct 'better-sqlite3' connection initialized in ${relative}`);
        }
      }

      if (content.includes('setInterval(')) {
        const ownsLifecycle =
          content.includes('@classification OWNED') ||
          (content.includes('@classification MODERN') &&
            (content.includes('start(): Promise<void>') || content.includes('async start(')) &&
            (content.includes('stop(): Promise<void>') || content.includes('async stop(')));
        if (!ownsLifecycle && !isInvariantEngine) {
          violations.push(`Background interval without owned lifecycle in ${relative}`);
        }
      }

      // Check for raw imports of PasteStore
      if (content.includes('PasteStore') && !relative.includes('agent-context.ts') && !relative.includes('types.ts') && !isInvariantEngine) {
        violations.push(`Defunct PasteStore referenced in: ${relative}`);
      }

      if (content.includes('pasteStore') && !relative.includes('agent-context.ts') && !relative.includes('types.ts') && !isInvariantEngine) {
        violations.push(`Transitional pasteStore API referenced in production file: ${relative}`);
      }
    }

    return violations;
  }
}
