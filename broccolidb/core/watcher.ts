import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as chokidar from 'chokidar';
import { AgentGitError } from './errors.js';
import type { Repository } from './repository.js';

export class LocalWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private isProcessing = false;
  private queue: { type: 'add' | 'change' | 'unlink'; filePath: string }[] = [];

  constructor(
    private readonly repo: Repository,
    private readonly branch: string,
    private readonly localDirPath: string,
    private readonly author: string = 'agent-watcher'
  ) {}

  public async start(): Promise<void> {
    if (this.watcher) {
      throw new AgentGitError('Watcher is already running', 'WATCHER_ALREADY_RUNNING');
    }

    this.watcher = chokidar.watch(this.localDirPath, {
      ignored: /(^|[/\\])\../, // ignore dotfiles mapping
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath) => this.enqueue('add', filePath))
      .on('change', (filePath) => this.enqueue('change', filePath))
      .on('unlink', (filePath) => this.enqueue('unlink', filePath));

    console.log(`[LocalWatcher] Started watching ${this.localDirPath}`);
  }

  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log(`[LocalWatcher] Stopped watching ${this.localDirPath}`);
    }
  }

  private enqueue(type: 'add' | 'change' | 'unlink', filePath: string) {
    this.queue.push({ type, filePath });
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;

        const relPath = path.relative(this.localDirPath, item.filePath);

        try {
          if (item.type === 'unlink') {
            await this.repo
              .files()
              .deleteFile(this.branch, relPath, this.author, { message: `Auto-delete ${relPath}` });
            console.log(`[LocalWatcher] Synced deletion of ${relPath}`);
          } else {
            const content = await fs.readFile(item.filePath, 'utf-8');
            await this.repo.files().writeFile(this.branch, relPath, content, this.author, {
              message: `Auto-update ${relPath}`,
            });
            console.log(`[LocalWatcher] Synced update of ${relPath}`);
          }
        } catch (err: any) {
          console.error(`[LocalWatcher] Failed to sync ${relPath}: ${err.message}`);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
