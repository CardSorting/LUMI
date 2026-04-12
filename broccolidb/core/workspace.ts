import type { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import type { Schema } from '../infrastructure/db/Config.js';
import { Connection } from './connection.js';
import { AgentGitError } from './errors.js';
import { executor } from './executor.js';
import { Repository } from './repository.js';

export interface WorkspaceInfo {
  userId: string;
  workspaceId: string;
  createdAt: number;
  sharedMemoryLayer?: string[];
}

/**
 * Workspace scopes AgentGit operations to a specific user silo.
 * Repositories are stored at users/{userId}/repositories/...
 */
export class Workspace {
  private db: BufferedDbPool;
  readonly userId: string;
  readonly workspaceId: string;
  public sharedMemoryLayer: string[] = [];

  constructor(
    dbOrConnection: BufferedDbPool | Connection,
    userId: string,
    workspaceId: string,
    private taskId?: string
  ) {
    if (!userId?.trim()) {
      throw new AgentGitError('userId is required', 'INVALID_USER_ID');
    }
    if (!workspaceId?.trim()) {
      throw new AgentGitError('workspaceId is required', 'INVALID_WORKSPACE_ID');
    }
    if (dbOrConnection instanceof Connection) {
      this.db = dbOrConnection.getPool();
    } else {
      this.db = dbOrConnection;
    }
    this.userId = userId.trim();
    this.workspaceId = workspaceId.trim();
  }

  getDb(): BufferedDbPool {
    return this.db;
  }

  /** Base path for this specific workspace */
  get workspacePath(): string {
    return `workspaces/${this.workspaceId}`;
  }

  /** Base path for the user silo */
  get userBasePath(): string {
    return `users/${this.userId}`;
  }

  async init(): Promise<void> {
    await executor.execute(`workspace:init:${this.userId}:${this.workspaceId}`, async () => {
      const user = await this.db.selectOne('users', [{ column: 'id', value: this.userId }]);
      if (!user) {
        await this.db.push({
          type: 'insert',
          table: 'users',
          values: { id: this.userId, createdAt: Date.now() },
          layer: 'infrastructure',
        });
      }

      const ws = await this.db.selectOne('workspaces', [{ column: 'id', value: this.workspaceId }]);
      if (!ws) {
        await this.db.push({
          type: 'insert',
          table: 'workspaces',
          values: {
            id: this.workspaceId,
            userId: this.userId,
            sharedMemoryLayer: JSON.stringify([]),
            createdAt: Date.now(),
          },
          layer: 'infrastructure',
        });
        this.sharedMemoryLayer = [];
      } else {
        this.sharedMemoryLayer = JSON.parse(ws.sharedMemoryLayer || '[]');
      }
    });
  }

  async createRepo(repoId: string, defaultBranch: string = 'main'): Promise<Repository> {
    return executor.execute(`repo:create:${repoId}`, async () => {
      const repoPath = `${this.userBasePath}/repositories/${repoId}`;
      const existing = await this.db.selectOne('repositories', [{ column: 'id', value: repoId }]);
      if (existing) {
        throw new AgentGitError(`Repository '${repoId}' already exists`, 'REPO_EXISTS');
      }
      await this.db.push({
        type: 'insert',
        table: 'repositories',
        values: {
          id: repoId,
          workspaceId: this.workspaceId,
          repoId,
          repoPath,
          createdAt: Date.now(),
          defaultBranch,
        },
        layer: 'infrastructure',
      });

      const repo = new Repository(this.db, repoPath);
      if (this.taskId) repo.setTaskId(this.taskId);
      await repo.createBranch(defaultBranch);
      return repo;
    });
  }

  async getRepo(repoId: string): Promise<Repository> {
    const row = await this.db.selectOne('repositories', [{ column: 'id', value: repoId }]);
    if (!row) {
      throw new AgentGitError(`Repository '${repoId}' not found`, 'REPO_NOT_FOUND');
    }
    const repo = new Repository(this.db, row.repoPath);
    if (this.taskId) repo.setTaskId(this.taskId);
    return repo;
  }

  /**
   * Helper for AgentContext to bridge the gap between cognitive and repo state.
   */
  async getRepoByPath(repoPath: string): Promise<Repository> {
    const repo = new Repository(this.db, repoPath);
    if (this.taskId) repo.setTaskId(this.taskId);
    return repo;
  }

  async listRepos(options: { limit?: number; startAfter?: string } = {}): Promise<string[]> {
    const rows = await this.db.selectWhere('repositories', [
      { column: 'workspaceId', value: this.workspaceId },
    ]);
    let ids = rows.map((r) => r.id).sort();
    if (options.startAfter) {
      const idx = ids.indexOf(options.startAfter);
      if (idx >= 0) ids = ids.slice(idx + 1);
    }
    if (options.limit) ids = ids.slice(0, options.limit);
    return ids;
  }

  async deleteRepo(repoId: string): Promise<void> {
    const repo = await this.getRepo(repoId);
    const repoPath = repo.getBasePath();

    const tables: Array<keyof Schema> = [
      'branches',
      'nodes',
      'tags',
      'files',
      'reflog',
      'stashes',
      'trees',
    ];
    for (const table of tables) {
      await this.db.push({
        type: 'delete',
        table,
        where: [{ column: 'repoPath', value: repoPath }],
        layer: 'infrastructure',
      });
    }

    await this.db.push({
      type: 'delete',
      table: 'repositories',
      where: [{ column: 'id', value: repoId }],
      layer: 'infrastructure',
    });
  }

  async fork(sourceRepoId: string, newRepoId: string): Promise<Repository> {
    return executor.execute(`repo:fork:${sourceRepoId}->${newRepoId}`, async () => {
      const sourceRepo = await this.getRepo(sourceRepoId);
      const sourcePath = sourceRepo.getBasePath();
      const newPath = `${this.userBasePath}/repositories/${newRepoId}`;

      const existing = await this.db.selectOne('repositories', [
        { column: 'id', value: newRepoId },
      ]);
      if (existing) throw new AgentGitError(`Repo '${newRepoId}' already exists`, 'REPO_EXISTS');

      await this.db.push({
        type: 'insert',
        table: 'repositories',
        values: {
          id: newRepoId,
          workspaceId: this.workspaceId,
          repoPath: newPath,
          createdAt: Date.now(),
          defaultBranch: 'main',
        },
        layer: 'infrastructure',
      });

      const tables: Array<keyof Schema> = [
        'branches',
        'nodes',
        'tags',
        'files',
        'reflog',
        'stashes',
        'trees',
      ];
      for (const table of tables) {
        const rows = await this.db.selectWhere(table, [{ column: 'repoPath', value: sourcePath }]);
        for (const row of rows) {
          await this.db.push({
            type: 'insert',
            table,
            values: { ...row, repoPath: newPath },
            layer: 'domain',
          });
        }
      }

      const repo = new Repository(this.db, newPath);
      if (this.taskId) repo.setTaskId(this.taskId);
      return repo;
    });
  }

  async clone(remoteWs: Workspace, remoteRepoId: string, localRepoId: string): Promise<Repository> {
    return this.forkFromRemote(remoteWs, remoteRepoId, localRepoId);
  }

  async push(
    localRepoId: string,
    branch: string,
    remoteWs: Workspace,
    remoteRepoId: string
  ): Promise<void> {
    await executor.execute(`repo:push:${localRepoId}:${branch}`, async () => {
      const localRepo = await this.getRepo(localRepoId);
      const remoteRepo = await remoteWs.getRepo(remoteRepoId);
      const localPath = localRepo.getBasePath();
      const remotePath = remoteRepo.getBasePath();

      const branchRow = await this.db.selectOne('branches', [
        { column: 'repoPath', value: localPath },
        { column: 'name', value: branch },
      ]);
      if (!branchRow) throw new AgentGitError(`Branch ${branch} not found`, 'BRANCH_NOT_FOUND');

      const history = await localRepo.history(branch, 100);
      const remoteDb = remoteWs.getDb();

      // Sync Nodes
      for (const node of history) {
        await remoteDb.push({
          type: 'upsert',
          table: 'nodes' as any,
          where: [
            { column: 'repoPath', value: remotePath },
            { column: 'id', value: node.id },
          ],
          values: {
            ...node,
            repoPath: remotePath,
            data: JSON.stringify(node.data),
            tree: JSON.stringify(node.tree),
            usage: JSON.stringify(node.usage),
            metadata: JSON.stringify(node.metadata),
          },
          layer: 'domain',
        });
      }

      // Update Remote Branch
      await remoteDb.push({
        type: 'upsert',
        table: 'branches' as any,
        where: [
          { column: 'repoPath', value: remotePath },
          { column: 'name', value: branch },
        ],
        values: { repoPath: remotePath, name: branch, head: branchRow.head, createdAt: Date.now() },
        layer: 'domain',
      });
    });
  }

  async pull(
    localRepoId: string,
    branch: string,
    remoteWs: Workspace,
    remoteRepoId: string
  ): Promise<void> {
    await remoteWs.push(remoteRepoId, branch, this, localRepoId);
  }

  private async forkFromRemote(
    remoteWs: Workspace,
    remoteRepoId: string,
    newRepoId: string
  ): Promise<Repository> {
    const remoteRepo = await remoteWs.getRepo(remoteRepoId);
    const remotePath = remoteRepo.getBasePath();
    const localPath = `${this.userBasePath}/repositories/${newRepoId}`;

    await this.db.push({
      type: 'insert',
      table: 'repositories',
      values: {
        id: newRepoId,
        workspaceId: this.workspaceId,
        repoPath: localPath,
        createdAt: Date.now(),
      },
      layer: 'infrastructure',
    });

    const tables: Array<keyof Schema> = [
      'branches',
      'nodes',
      'tags',
      'files',
      'reflog',
      'stashes',
      'trees',
    ];
    const remoteDb = remoteWs.getDb();

    for (const table of tables) {
      const rows = await remoteDb.selectWhere(table as any, [
        { column: 'repoPath', value: remotePath },
      ]);
      for (const row of rows) {
        await this.db.push({
          type: 'insert',
          table: table as any,
          values: { ...row, repoPath: localPath },
          layer: 'domain',
        });
      }
    }

    const repo = new Repository(this.db, localPath);
    if (this.taskId) repo.setTaskId(this.taskId);
    return repo;
  }
}
