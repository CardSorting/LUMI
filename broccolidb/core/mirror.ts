import { type SimpleGit, simpleGit } from 'simple-git';
import type { Repository } from './repository.js';

/**
 * LocalMirror Prototype
 * Inspired by Cline's "Shadow Git" checkpointing system.
 * It provides an ultra-fast local-first logging system that asynchronously
 * pushes metadata patches to the AgentGit cloud repository.
 */
export class LocalMirror {
  private git: SimpleGit;

  constructor(
    private readonly repo: Repository,
    private readonly branch: string,
    private readonly localDirPath: string
  ) {
    this.git = simpleGit(this.localDirPath);
  }

  /**
   * Initializes the shadow git local mirror.
   */
  public async init(): Promise<void> {
    await this.git.init();
    await this.git.addConfig('user.name', 'Agent-LocalMirror');
    await this.git.addConfig('user.email', 'mirror@agentgit.local');
    // Ensure we track modifications transparently
    await this.git.addConfig('core.autocrlf', 'false');
    console.log(`[LocalMirror] Initialized shadow git at ${this.localDirPath}`);
  }

  /**
   * Commits all changes to the local shadow git, and asynchronously logs
   * the patch event to the cloud via the AgentGit Repository.
   */
  public async commit(message: string): Promise<string> {
    await this.git.add(['.', '--ignore-errors']);
    const result = await this.git.commit(message, { '--allow-empty': null });
    const hash = (result.commit || '').replace(/^HEAD\s+/, '');

    console.log(`[LocalMirror] Committed local snapshot ${hash}`);

    // Background sync to the cloud storage
    this.syncToCloud(hash, message).catch((err) => {
      console.error(`[LocalMirror] Failed cloud sync for ${hash}: ${err.message}`);
    });

    return hash;
  }

  private async syncToCloud(hash: string, message: string): Promise<void> {
    try {
      // Get the patch content using git show
      const patch = await this.git.show([hash, '--pretty=format:']);

      await this.repo.commit(
        this.branch,
        { shadowHash: hash },
        'mirror-agent',
        `[LocalMirror] ${message}`,
        {
          type: 'snapshot',
          metadata: {
            shadowCommitHash: hash,
            patch: patch.trim(),
          },
        }
      );
      console.log(`[LocalMirror] Successfully synced event ${hash} to cloud.`);
    } catch (err: any) {
      console.error(`[LocalMirror] Failed to generate patch for ${hash}: ${err.message}`);
      // Fallback to basic sync if patch fails
      await this.repo.commit(
        this.branch,
        { shadowHash: hash },
        'mirror-agent',
        `[LocalMirror] ${message}`,
        {
          type: 'snapshot',
          metadata: { shadowCommitHash: hash },
        }
      );
    }
  }

  /**
   * Generates a structural summary of modifications.
   */
  public async diffSummary(hashA: string, hashB?: string): Promise<any> {
    const range = hashB ? `${hashA}..${hashB}` : hashA;
    return await this.git.diffSummary([range]);
  }
}
