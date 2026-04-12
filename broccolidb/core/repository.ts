import * as crypto from 'node:crypto';
import type { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { Connection } from './connection.js';
import { AgentGitError } from './errors.js';
import { executor } from './executor.js';
import type { FileEntry } from './file-tree.js';
import { FileTree } from './file-tree.js';
import { LRUCache } from './lru-cache.js';
import { TaskMutex } from './mutex.js';
import { EnvironmentTracker, telemetryQueue } from './tracker.js';

// ─── Interfaces ───

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  totalCost?: number;
  timeToFirstTokenMs?: number;
  durationMs?: number;
  provider?: string;
  modelId?: string;
  pricingTier?: 'tier-high' | 'tier-medium' | 'tier-low' | 'default';
}

export interface MemoryNode {
  id: string;
  parentId: string | null;
  data: Record<string, any>;
  message: string;
  timestamp: number;
  author: string;
  type: 'snapshot' | 'summary' | 'diff' | 'hypothesis' | 'conclusion';
  tree?: Record<string, string> | undefined; // Full snapshot (legacy or resolved)
  changes?: Record<string, string> | undefined; // Only changes (for 'diff' type)
  usage?: Usage | undefined;
  metadata?:
    | {
        treeHash?: string;
        isHierarchical?: boolean;
        taskId?: string;
        decisionIds?: string[];
        environment?: Record<string, any>;
        [key: string]: any;
      }
    | undefined;
}

export interface Branch {
  name: string;
  head: string;
  createdAt: number;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
}

export interface StatusResult {
  branch: string;
  headNodeId: string | null;
  headMessage: string | null;
  headAuthor: string | null;
  fileCount: number;
  files: string[];
  commitCount: number;
}

export interface BlameEntry {
  path: string;
  lastAuthor: string;
  lastMessage: string;
  lastNodeId: string;
  lastTimestamp: number;
}

export interface StashEntry {
  id: string;
  branch: string;
  label: string;
}

export interface RefLogEntry {
  id: string;
  ref: string;
  oldHead: string | null;
  newHead: string;
  author: string;
  message: string;
  timestamp: number;
  operation: 'commit' | 'reset' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash-pop';
}

export interface LogOptions {
  author?: string;
  messageRegex?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  taskId?: string;
}

export interface ConflictResult {
  hasConflicts: boolean;
  conflicts: string[];
  reasoningConflicts?: { nodeId: string; conflictingNodeId: string; confidence: number }[];
  mergedTree: Record<string, string>;
}

export interface TreeEntry {
  type: 'blob' | 'tree' | 'subrepo';
  hash: string;
}

export interface TreeSnapshot {
  id: string;
  entries: Record<string, TreeEntry>;
}

export interface PatchData {
  baseNodeId: string;
  targetNodeId: string;
  nodes: MemoryNode[];
  files: Record<string, any>;
}

// ─── Repository ───

export class Repository {
  private db: BufferedDbPool;
  private basePath: string;
  private taskId?: string;

  private nodeCache: LRUCache<string, MemoryNode>;
  private refCache: LRUCache<string, string>;
  public agentContext: any | null; // AgentContext interface for reasoning audits
  public strictReasoning: boolean = false; // If true, commits with logical contradictions are blocked
  private fileCache = new LRUCache<string, FileEntry>(500);
  private rawTreeCache = new LRUCache<string, TreeSnapshot>(1000);
  private treeCache = new LRUCache<string, Record<string, string>>(512);

  private hooks: Record<string, ((data: any) => Promise<void>)[]> = {};

  constructor(
    dbOrConnection: BufferedDbPool | Connection,
    basePathOrRepoId: string,
    agentContext?: any
  ) {
    this.agentContext = agentContext || null;
    this.nodeCache = new LRUCache<string, MemoryNode>(1000);
    this.refCache = new LRUCache<string, string>(100);
    if (dbOrConnection instanceof Connection) {
      this.db = dbOrConnection.getPool();
      this.basePath = `repos/${basePathOrRepoId}`;
    } else {
      this.db = dbOrConnection;
      this.basePath = basePathOrRepoId;
    }
  }

  files(): FileTree {
    return new FileTree(this.db, this);
  }
  getBasePath(): string {
    return this.basePath;
  }
  getDb(): BufferedDbPool {
    return this.db;
  }
  getFileCache() {
    return this.fileCache;
  }

  setTaskId(taskId: string): void {
    this.taskId = taskId;
  }

  private async recordRefLog(
    ref: string,
    oldHead: string | null,
    newHead: string,
    author: string,
    operation: RefLogEntry['operation'],
    message: string
  ): Promise<void> {
    const id = crypto.randomUUID();
    const entry: RefLogEntry = {
      id,
      ref,
      oldHead,
      newHead,
      author,
      message,
      timestamp: Date.now(),
      operation,
    };
    await this.db.push({
      type: 'insert',
      table: 'reflog',
      values: { ...entry, repoPath: this.basePath },
      layer: 'infrastructure',
    });
    console.log(
      `[AgentGit][RefLog] ${operation.toUpperCase()} on '${ref}': ${message} (${newHead.substring(0, 7)})`
    );
  }

  /**
   * [Pillar 1] Calculates the number of commits between HEAD and the target commit.
   * Used for temporal decay at query-time.
   */
  async getCommitDistance(commitId: string): Promise<number> {
    const head = await this.resolveRef('main').catch(() => null);
    if (!head) return 1000;
    if (head === commitId) return 0;

    const rows = await this.db.selectWhere(
      'reflog',
      [{ column: 'repoPath', value: this.basePath }],
      undefined,
      {
        orderBy: { column: 'timestamp', direction: 'desc' },
        limit: 1000,
      }
    );

    const index = rows.findIndex((r) => r.newHead === commitId);
    return index === -1 ? 1000 : index;
  }

  /**
   * [Pillar 2] Derives baseline confidence from git metadata.
   * Returns a baseline confidence score between 0.5 and 0.95.
   */
  async getNodePriors(path: string): Promise<number> {
    const rows = await this.db.selectWhere(
      'reflog',
      [{ column: 'repoPath', value: this.basePath }],
      undefined,
      {
        limit: 5000,
      }
    );

    const relevantCommits = rows.filter((r) => (r.message || '').includes(path));
    const commitCount = relevantCommits.length;
    const uniqueAuthors = new Set(relevantCommits.map((r) => r.author)).size;

    // Base 0.5 + 0.1 per author (cap 3) + 0.05 per doubling of commits
    const authorFactor = Math.min(0.3, uniqueAuthors * 0.1);
    const commitFactor = Math.min(0.15, Math.log2(commitCount + 1) * 0.02);

    const prior = 0.5 + authorFactor + commitFactor;
    return Math.min(0.95, prior);
  }

  /**
   * [Pillar 1/2] Returns the raw churn frequency for a file path.
   */
  async getFileChurn(path: string): Promise<number> {
    const rows = await this.db.selectWhere(
      'reflog',
      [{ column: 'repoPath', value: this.basePath }],
      undefined,
      {
        limit: 5000,
      }
    );
    return rows.filter((r) => (r.message || '').includes(path)).length;
  }

  // ─── Ref Resolution ───

  async resolveRef(ref: string): Promise<string> {
    const cached = this.refCache.get(ref);
    if (cached) return cached;

    let targetId: string | null = null;

    // Check Branches
    const branch = await this.db.selectOne('branches', [
      { column: 'repoPath', value: this.basePath },
      { column: 'name', value: ref },
    ]);
    if (branch) targetId = branch.head;
    else {
      // Check Tags
      const tag = await this.db.selectOne('tags', [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: ref },
      ]);
      if (tag) targetId = tag.head;
      else {
        // Check Nodes
        const node = await this.db.selectOne('nodes', [
          { column: 'repoPath', value: this.basePath },
          { column: 'id', value: ref },
        ]);
        if (node) targetId = ref;
      }
    }

    if (!targetId) throw new AgentGitError(`Ref '${ref}' not found`, 'REF_NOT_FOUND');
    this.refCache.set(ref, targetId);
    return targetId;
  }

  /**
   * Fetch a single node by ID
   */
  public async getNode(nodeId: string): Promise<MemoryNode> {
    const cached = this.nodeCache.get(nodeId);
    if (cached) return cached;

    const node = await this.db.selectOne('nodes', [
      { column: 'repoPath', value: this.basePath },
      { column: 'id', value: nodeId },
    ]);
    if (!node) {
      throw new AgentGitError(
        `Node '${nodeId}' not found in repo '${this.basePath}'`,
        'NODE_NOT_FOUND'
      );
    }
    const data = {
      ...node,
      data: JSON.parse(node.data || '{}'),
      tree: node.tree ? JSON.parse(node.tree) : null,
      usage: node.usage ? JSON.parse(node.usage) : null,
      metadata: node.metadata ? JSON.parse(node.metadata) : null,
    } as MemoryNode;
    this.nodeCache.set(nodeId, data);
    return data;
  }

  /**
   * Bulk fetch nodes in a single round-trip.
   */
  async bulkGetNodes(nodeIds: string[]): Promise<MemoryNode[]> {
    if (nodeIds.length === 0) return [];

    const results: MemoryNode[] = [];
    const missingIds: string[] = [];

    for (const id of nodeIds) {
      const cached = this.nodeCache.get(id);
      if (cached) results.push(cached);
      else missingIds.push(id);
    }

    if (missingIds.length > 0) {
      // Use efficient IN query now that BufferedDbPool supports it
      const rows = await this.db.selectWhere('nodes', [
        { column: 'id', value: missingIds, operator: 'IN' },
        { column: 'repoPath', value: this.basePath },
      ]);

      for (const row of rows) {
        const node: MemoryNode = {
          ...(row as unknown as MemoryNode),
          data: JSON.parse(row.data),
          tree: row.tree ? JSON.parse(row.tree) : undefined,
          usage: row.usage ? JSON.parse(row.usage) : undefined,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        };
        this.nodeCache.set(node.id, node);
        results.push(node);
      }
    }

    // Sort results by original requested order
    const nodeMap = new Map(results.map((n) => [n.id, n]));
    return nodeIds.map((id) => nodeMap.get(id)).filter(Boolean) as MemoryNode[];
  }

  // ─── Branch Operations ───

  async createBranch(
    name: string,
    fromBranchOrNode?: string,
    options: { isEphemeral?: boolean; expiresAt?: number } = {}
  ): Promise<void> {
    let headNodeId = '';
    if (fromBranchOrNode) {
      headNodeId = await this.resolveRef(fromBranchOrNode);
    }
    await this.db.push({
      type: 'upsert',
      table: 'branches',
      where: [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: name },
      ],
      values: {
        repoPath: this.basePath,
        name,
        head: headNodeId,
        createdAt: Date.now(),
        isEphemeral: options.isEphemeral ? 1 : 0,
        expiresAt: options.expiresAt || null,
      },
      layer: 'domain',
    });
    if (headNodeId) {
      this.refCache.set(name, headNodeId);
    }
  }

  /**
   * Convenience wrapper for hypothesis branching.
   */
  async branchHypothesis(baseRef: string, name: string): Promise<void> {
    await this.createBranch(name, baseRef);
    console.log(`[BroccoliDB] Hypothesizing branch '${name}' from '${baseRef}'`);
  }

  async listBranches(options: { limit?: number; startAfter?: string } = {}): Promise<string[]> {
    const rows = await this.db.selectWhere('branches', [
      { column: 'repoPath', value: this.basePath },
    ]);
    // Simplistic pagination/sorting logic since BufferedDbPool selectWhere is basic
    let results = rows.map((r) => r.name).sort();
    if (options.startAfter) {
      const idx = results.indexOf(options.startAfter);
      if (idx >= 0) results = results.slice(idx + 1);
    }
    if (options.limit) results = results.slice(0, options.limit);
    return results;
  }

  async deleteBranch(name: string): Promise<void> {
    if (name === 'main' || name === 'master') {
      throw new AgentGitError('Cannot delete protected branch', 'PROTECTED_BRANCH');
    }
    await this.db.push({
      type: 'delete',
      table: 'branches',
      where: [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: name },
      ],
      layer: 'domain',
    });
    this.refCache.delete(name);
  }

  // ─── Commit (Transactional) ───

  async commit(
    branchName: string,
    data: Record<string, any>,
    author: string,
    message: string = '',
    options: {
      type?: 'snapshot' | 'summary' | 'diff' | 'hypothesis' | 'conclusion';
      usage?: Usage;
      metadata?: Record<string, any>;
      decisionIds?: string[];
    } = {}
  ): Promise<string> {
    return executor.execute(`commit:${branchName}`, async () => {
      return TaskMutex.runExclusive(`branch:${this.basePath}:${branchName}`, async () => {
        const nodeId = this.generateNodeId();

        // In the new SQLite architecture, we use BufferedDbPool's shadow system for "transactions"
        const agentId = author || 'default';
        await this.db.beginWork(agentId);
        try {
          // Pre-commit Reasoning Audit
          if (
            this.strictReasoning &&
            this.agentContext &&
            (options.type === 'hypothesis' || options.type === 'conclusion')
          ) {
            const kbIds: string[] = [];
            if (data.knowledgeIds) kbIds.push(...data.knowledgeIds);
            if (data.factId) kbIds.push(data.factId);

            if (kbIds.length > 0) {
              const reports = await this.agentContext.detectContradictions(kbIds);
              if (reports.length > 0) {
                throw new AgentGitError(
                  `Reasoning commit blocked: High-confidence logical contradiction detected.`,
                  'REASONING_CONFLICT'
                );
              }
            }
          }

          await this.commitInTransaction(
            null as any,
            branchName,
            nodeId,
            data,
            author,
            message,
            options,
            agentId
          );
          await this.db.commitWork(agentId);
        } catch (e) {
          await this.db.rollbackWork(agentId);
          throw e;
        }

        this.enqueuePostCommitWork(branchName, nodeId, author, message, data, options);
        return nodeId;
      });
    });
  }

  /**
   * Offloads side-effects from the hot-path so commit returns near-instantly.
   * Catches all errors internally so the backend doesn't crash on unhandled rejections.
   */
  private enqueuePostCommitWork(
    branchName: string,
    nodeId: string,
    author: string,
    message: string,
    data: Record<string, any>,
    options: { usage?: Usage } = {}
  ) {
    // 1. Offload Telemetry to memory queue (batched flush later)
    if (options.usage) {
      telemetryQueue.enqueue(this.db, this.basePath, {
        agentId: author,
        usage: options.usage,
        taskId: this.taskId || null,
      });
    }

    // 2. Background Reflog & Hooks
    Promise.allSettled([
      this.recordRefLog(branchName, null, nodeId, author, 'commit', message),
      this.triggerHook('post-commit', { branchName, nodeId, author, message, data }),
    ]).catch((err) => {
      console.error(`[AgentGit] Background post-commit processing failed for ${nodeId}:`, err);
    });
  }

  /**
   * Internal logic for committing within an existing transaction.
   * This allows external components (like FileTree) to batch file writes and commits together.
   */
  public async commitInTransaction(
    _transaction: any, // Ignored in SQLite but kept for interface compatibility
    branchName: string,
    nodeId: string,
    data: Record<string, any>,
    author: string,
    message: string = '',
    options: {
      type?: 'snapshot' | 'summary' | 'diff' | 'hypothesis' | 'conclusion';
      usage?: Usage;
      metadata?: Record<string, any>;
      decisionIds?: string[];
    } = {},
    agentId?: string
  ): Promise<void> {
    const branchDoc = await this.db.selectOne(
      'branches',
      [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: branchName },
      ],
      agentId
    );

    if (!branchDoc) {
      throw new AgentGitError(`Branch ${branchName} not found.`, 'BRANCH_NOT_FOUND');
    }
    const parentId = branchDoc.head || null;

    const usage = options.usage
      ? {
          ...options.usage,
          totalCost: options.usage.totalCost || EnvironmentTracker.estimateCost(options.usage),
        }
      : undefined;

    const metadata: any = {
      ...options.metadata,
      decisionIds: options.decisionIds || [],
      environment: EnvironmentTracker.capture(),
      ...(this.taskId ? { taskId: this.taskId } : {}),
    };

    // --- Pass 5: Logical Sovereignty & Native Hardening ---
    if (this.agentContext) {
      // 1. Merkle-Reasoning Proof
      if (options.type === 'conclusion') {
        const treeHash = metadata.treeHash || 'empty';
        const knowledgeIds = data.knowledgeIds || [];
        const pedigreeHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(knowledgeIds))
          .digest('hex');
        metadata.proofHash = crypto
          .createHash('sha256')
          .update(treeHash + pedigreeHash)
          .digest('hex');
      }

      // 2. Constitutional Audit (Path-bound rules)
      const constraints = await this.agentContext.getLogicalConstraints();
      if (constraints.length > 0) {
        const changedPaths =
          options.type === 'diff' ? Object.keys(data.changes || {}) : Object.keys(data.tree || {});
        for (const path of changedPaths) {
          const matchingConstraints = constraints.filter((c: any) => {
            const pattern = c.pathPattern.replace(/\*/g, '.*');
            return new RegExp(`^${pattern}$`).test(path);
          });

          for (const constraint of matchingConstraints) {
            const rule = await this.agentContext.getKnowledge(constraint.knowledgeId);
            const casHash = options.type === 'diff' ? data.changes[path] : data.tree[path];
            const fileItem = await this.db.selectOne('files', [{ column: 'id', value: casHash }]);

            if (fileItem && rule) {
              const audit = await this.agentContext.checkConstitutionalViolation(
                path,
                fileItem.content,
                rule.content
              );
              if (audit.violated) {
                const msg = `Constitutional violation in ${path}: ${audit.reason}`;
                if (constraint.severity === 'blocking') {
                  throw new AgentGitError(msg, 'REASONING_CONFLICT');
                } else {
                  console.warn(`[AgentGit][ConstitutionalWarning] ${msg}`);
                  metadata.constitutionalWarnings = metadata.constitutionalWarnings || [];
                  metadata.constitutionalWarnings.push(msg);
                }
              }
            }
          }
        }
      }
    }

    const newNode = {
      id: nodeId,
      repoPath: this.basePath,
      parentId,
      data: JSON.stringify(data),
      message,
      author,
      timestamp: Date.now(),
      type: options.type || 'snapshot',
      usage: usage ? JSON.stringify(usage) : null,
      metadata: JSON.stringify(metadata),
      tree: options.type === 'snapshot' ? JSON.stringify(data.tree || {}) : null, // Logic for legacy flat trees
    };

    await this.db.push(
      {
        type: 'insert',
        table: 'nodes',
        values: newNode,
        layer: 'domain',
      },
      agentId
    );

    await this.db.push(
      {
        type: 'update',
        where: [
          { column: 'repoPath', value: this.basePath },
          { column: 'name', value: branchName },
        ],
        table: 'branches',
        values: { head: nodeId },
        layer: 'domain',
      },
      agentId
    );

    // Memory Cache invalidation/warming
    this.nodeCache.set(nodeId, {
      ...(newNode as any),
      data,
      usage,
      metadata,
      tree: newNode.tree ? JSON.parse(newNode.tree) : undefined,
    });
    this.refCache.set(branchName, nodeId);
  }

  public generateNodeId(): string {
    return crypto.randomUUID();
  }

  // ─── Checkout ───

  async checkout(
    branchOrRef: string,
    options: { resolveTree?: boolean } = { resolveTree: true }
  ): Promise<MemoryNode | null> {
    try {
      const nodeId = await this.resolveRef(branchOrRef);
      const node = await this.getNode(nodeId);

      // Resolve full tree if this is a diff or hierarchical node
      if (options.resolveTree && (!node.tree || node.metadata?.isHierarchical)) {
        console.log(
          `[AgentGit][Repo] Resolving tree for node ${nodeId.substring(0, 7)} (${node.metadata?.isHierarchical ? 'Merkle' : 'Flat'})`
        );
        node.tree = await this.resolveTree(node);
      }
      return node;
    } catch (e) {
      if (e instanceof AgentGitError && e.code === 'REF_NOT_FOUND') return null;
      throw e;
    }
  }

  /**
   * Exposes tree cache statistics for observability
   */
  getTreeCacheStats() {
    return {
      size: this.treeCache.size,
      hits: this.treeCache.hits,
      misses: this.treeCache.misses,
    };
  }

  /**
   * Force clear the tree cache
   */
  clearTreeCache() {
    this.treeCache.clear();
  }

  /**
   * Deterministic hash for a tree snapshot.
   */
  private treeHash(entries: Record<string, TreeEntry>): string {
    const sortedKeys = Object.keys(entries).sort();
    const hash = crypto.createHash('sha256');
    for (const key of sortedKeys) {
      const entry = entries[key];
      if (entry) {
        hash.update(`${key}:${entry.type}:${entry.hash}`);
      }
    }
    return hash.digest('hex');
  }

  /**
   * Writes a tree snapshot to the CAS trees collection.
   */
  public async writeTree(
    _transaction: any,
    entries: Record<string, TreeEntry>,
    agentId?: string
  ): Promise<string> {
    const hash = this.treeHash(entries);
    const snapshotObj = { id: hash, entries };

    await this.db.push(
      {
        type: 'upsert',
        table: 'trees',
        where: [
          { column: 'repoPath', value: this.basePath },
          { column: 'id', value: hash },
        ],
        values: {
          repoPath: this.basePath,
          id: hash,
          entries: JSON.stringify(entries),
          createdAt: Date.now(),
        },
        layer: 'domain',
      },
      agentId
    );

    this.rawTreeCache.set(hash, snapshotObj);
    return hash;
  }

  /**
   * Writes a tree snapshot to the CAS trees collection outside of a transaction.
   * Useful for operations that don't need transactional integrity for tree writes.
   */
  public async writeTreeIsolated(entries: Record<string, TreeEntry>): Promise<string> {
    const hash = this.treeHash(entries);
    const snapshotObj = { id: hash, entries };

    await this.db.push({
      type: 'upsert',
      table: 'trees',
      where: [
        { column: 'repoPath', value: this.basePath },
        { column: 'id', value: hash },
      ],
      values: {
        repoPath: this.basePath,
        id: hash,
        entries: JSON.stringify(entries),
        createdAt: Date.now(),
      },
      layer: 'domain',
    });

    this.rawTreeCache.set(hash, snapshotObj);
    return hash;
  }

  /**
   * Reads a tree snapshot by hash.
   */
  public async readTree(hash: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const entries = await this.getTree(hash);
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.type === 'blob') {
        result[name] = entry.hash;
      }
    }
    return result;
  }

  /**
   * Non-transactional tree resolver for traversal.
   */
  public async getTree(hash: string): Promise<Record<string, TreeEntry>> {
    const cached = this.rawTreeCache.get(hash);
    if (cached) return cached.entries;

    const row = await this.db.selectOne('trees', [
      { column: 'repoPath', value: this.basePath },
      { column: 'id', value: hash },
    ]);
    if (!row) throw new AgentGitError(`Tree ${hash} not found`, 'TREE_NOT_FOUND');

    const entries = JSON.parse(row.entries);
    this.rawTreeCache.set(hash, { id: hash, entries });
    return entries;
  }

  /**
   * Recursively resolves the full tree for a diff-based node.
   * Now updated to support Hierarchical Merkle Trees.
   */
  public async resolveTree(node: MemoryNode): Promise<Record<string, string>> {
    const cached = this.treeCache.get(node.id);
    if (cached) return cached;

    // If it's a legacy flat tree, return it
    if (node.tree && !node.metadata?.isHierarchical) {
      this.treeCache.set(node.id, node.tree);
      return node.tree;
    }

    // Resolve hierarchical tree to flat map for backward compatibility with existing LLM tools
    if (node.metadata?.treeHash) {
      const flatTree: Record<string, string> = {};
      await this.flattenTree(node.metadata.treeHash, '', flatTree);
      this.treeCache.set(node.id, flatTree);
      return flatTree;
    }

    if (!node.parentId) return node.changes || {};

    const parent = await this.checkout(node.parentId);
    const parentTree = parent?.tree || {};
    const resolved = { ...parentTree, ...node.changes };

    this.treeCache.set(node.id, resolved);
    return resolved;
  }

  private async flattenTree(
    hash: string,
    prefix: string,
    result: Record<string, string>,
    depth: number = 0
  ): Promise<void> {
    if (depth > 100) {
      console.warn(`[AgentGit] Tree traversal depth limit exceeded at: ${prefix}`);
      return;
    }
    const entries = await this.getTree(hash);

    // Parallelize subtree traversals
    await Promise.all(
      Object.entries(entries).map(async ([name, entry]) => {
        const key = prefix ? `${prefix}/${name}` : name;
        if (entry.type === 'blob') {
          result[key] = entry.hash;
        } else if (entry.type === 'tree') {
          await this.flattenTree(entry.hash, key, result, depth + 1);
        } else if (entry.type === 'subrepo') {
          result[key] = `REPO:${entry.hash}`;
        }
      })
    );
  }

  async tag(name: string, ref: string, author: string, message?: string): Promise<void> {
    const head = await this.resolveRef(ref);
    await this.db.push({
      type: 'upsert',
      table: 'tags',
      where: [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: name },
      ],
      values: {
        repoPath: this.basePath,
        name,
        head,
        author,
        message: message || '',
        createdAt: Date.now(),
      },
      layer: 'domain',
    });
  }

  async listTags(): Promise<string[]> {
    const rows = await this.db.selectWhere('tags', [{ column: 'repoPath', value: this.basePath }]);
    return rows.map((r) => r.name).sort();
  }

  async deleteTag(name: string): Promise<void> {
    await this.db.push({
      type: 'delete',
      table: 'tags',
      where: [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: name },
      ],
      layer: 'domain',
    });
  }

  // ─── History ───

  async history(ref: string, limit: number = 100): Promise<MemoryNode[]> {
    const headId = await this.resolveRef(ref);
    const result: MemoryNode[] = [];
    let currentId: string | null = headId;

    while (currentId && result.length < limit) {
      const node = await this.getNode(currentId);
      result.push(node);
      currentId = node.parentId;
    }
    return result;
  }

  // ─── Merge ───

  async merge(sourceBranch: string, targetBranch: string, author: string): Promise<string | null> {
    return executor.execute(`merge:${sourceBranch}->${targetBranch}`, async () => {
      const sourceHead = await this.resolveRef(sourceBranch);
      const targetHead = await this.resolveRef(targetBranch);

      if (sourceHead === targetHead) return null;

      const lcaId = await this.findLCA(sourceHead, targetHead);
      if (!lcaId) {
        // Default to snapshot spread if no LCA
        const targetNode = await this.checkout(targetBranch);
        const sourceNode = await this.checkout(sourceBranch);
        const mergedData = { ...targetNode?.data, ...sourceNode?.data };
        const treeA = targetNode?.tree || targetNode?.data?.tree || {};
        const treeB = sourceNode?.tree || sourceNode?.data?.tree || {};
        const mergedTree = { ...treeA, ...treeB };

        const res = await this.commit(
          targetBranch,
          { ...mergedData, tree: mergedTree },
          author,
          `Merge branch '${sourceBranch}' (no LCA)`
        );
        await this.recordRefLog(
          targetBranch,
          targetHead,
          res,
          author,
          'merge',
          `Merge ${sourceBranch}`
        );
        return res;
      }

      let conflictResult: ConflictResult;
      let newTreeHash: string | undefined;

      const sourceNode = await this.getNode(sourceHead);
      const targetNode = await this.getNode(targetHead);
      const baseNode = await this.getNode(lcaId);

      if (
        sourceNode?.metadata?.isHierarchical &&
        targetNode?.metadata?.isHierarchical &&
        baseNode?.metadata?.isHierarchical &&
        baseNode.metadata.treeHash &&
        sourceNode.metadata.treeHash &&
        targetNode.metadata.treeHash
      ) {
        // High-Performance Hierarchical Merge
        const result = await this.db.runTransaction(async (agentId) => {
          return this.mergeTrees(
            null,
            baseNode.metadata!.treeHash!,
            sourceNode.metadata!.treeHash!,
            targetNode.metadata!.treeHash!,
            agentId
          );
        });

        if (result.conflicts.length > 0) {
          throw new AgentGitError(
            `Merge conflicts in: ${result.conflicts.join(', ')}`,
            'MERGE_CONFLICT',
            result.conflicts
          );
        }
        newTreeHash = result.hash;
        const mergedTree: Record<string, string> = {};
        await this.flattenTree(newTreeHash, '', mergedTree);
        conflictResult = { hasConflicts: false, conflicts: [], mergedTree };
      } else {
        // Fallback to Flat Merge
        conflictResult = await this.calculateMerge(lcaId, sourceHead, targetHead);
        if (conflictResult.conflicts.length > 0) {
          throw new AgentGitError(
            `Merge conflicts in: ${conflictResult.conflicts.join(', ')}`,
            'MERGE_CONFLICT',
            conflictResult.conflicts
          );
        }
        if (conflictResult.reasoningConflicts && conflictResult.reasoningConflicts.length > 0) {
          const highConf = conflictResult.reasoningConflicts.find((c) => c.confidence > 0.85);
          if (highConf) {
            throw new AgentGitError(
              `High-confidence reasoning contradiction detected between ${highConf.nodeId} and ${highConf.conflictingNodeId}`,
              'REASONING_CONFLICT'
            );
          }
        }
      }

      const resultNodeId = await this.commit(
        targetBranch,
        conflictResult.mergedTree,
        author,
        `Merge branch '${sourceBranch}' into '${targetBranch}'`,
        {
          metadata: {
            mergeSource: sourceHead,
            mergeTarget: targetHead,
            lca: lcaId,
            ...(newTreeHash ? { treeHash: newTreeHash, isHierarchical: true } : {}),
          },
        }
      );

      await this.recordRefLog(
        targetBranch,
        targetHead,
        resultNodeId,
        author,
        'merge',
        `Merge ${sourceBranch}`
      );
      return resultNodeId;
    });
  }

  /**
   * Merges a hypothesis branch and marks the resulting commit as a 'conclusion'.
   * Automatically generates a REASONING_PROOF.md file documenting the verified logic.
   */
  async mergeConclusion(
    sourceBranch: string,
    targetBranch: string,
    author: string,
    message?: string
  ): Promise<string | null> {
    const sourceHead = await this.resolveRef(sourceBranch);
    const resId = await this.merge(sourceBranch, targetBranch, author);
    if (resId) {
      await this.db.push({
        type: 'update',
        table: 'nodes',
        where: [{ column: 'id', value: resId }],
        values: {
          type: 'conclusion',
          message: message || `Conclusion: Merged hypothesis '${sourceBranch}'`,
        },
        layer: 'domain',
      });

      // Generate REASONING_PROOF.md
      if (this.agentContext) {
        try {
          const sourceNode = await this.getNode(sourceHead);
          const kbIds: string[] = [];
          if (sourceNode.data.knowledgeIds) kbIds.push(...sourceNode.data.knowledgeIds);
          if (sourceNode.data.factId) kbIds.push(sourceNode.data.factId);
          if (sourceNode.data.factAId) kbIds.push(sourceNode.data.factAId);
          if (sourceNode.data.factBId) kbIds.push(sourceNode.data.factBId);

          if (kbIds.length > 0) {
            const pedigree = await this.agentContext.getReasoningPedigree(kbIds[0]);
            let proof = `# Reasoning Proof: ${message || sourceNode.message}\n\n`;
            proof += `**Conclusion ID:** ${resId}\n`;
            proof += `**Effective Confidence:** ${(pedigree.effectiveConfidence * 100).toFixed(1)}%\n\n`;
            proof += `## Evidence Chain\n`;
            for (const step of pedigree.lineage) {
              proof += `- **[${step.nodeId.substring(0, 7)}]** (${step.type}): ${step.content.substring(0, 100)}...\n`;
            }

            await this.files().writeFile(targetBranch, 'REASONING_PROOF.md', proof, author, {
              message: `Generate Reasoning Proof for ${resId.substring(0, 7)}`,
            });
          }
        } catch (e) {
          console.error('[AgentGit][Reasoning] Failed to generate REASONING_PROOF.md:', e);
        }
      }

      // Update cache
      if (this.nodeCache.has(resId)) {
        const cached = this.nodeCache.get(resId)!;
        this.nodeCache.set(resId, {
          ...cached,
          type: 'conclusion',
          message: message || cached.message,
        });
      }
    }
    return resId;
  }

  /**
   * Identifies all 'hypothesis' and 'conclusion' nodes added or removed between two refs.
   */
  async getReasoningDiff(
    refA: string,
    refB: string
  ): Promise<{
    added: MemoryNode[];
    removed: MemoryNode[];
    commonAncestor: string | null;
  }> {
    const headA = await this.resolveRef(refA);
    const headB = await this.resolveRef(refB);
    const lcaId = await this.findLCA(headA, headB);

    const historyA = await this.history(refA, 200);
    const historyB = await this.history(refB, 200);

    const added: MemoryNode[] = [];
    for (const node of historyB) {
      if (node.id === lcaId) break;
      if (node.type === 'hypothesis' || node.type === 'conclusion') {
        added.push(node);
      }
    }

    const removed: MemoryNode[] = [];
    for (const node of historyA) {
      if (node.id === lcaId) break;
      if (node.type === 'hypothesis' || node.type === 'conclusion') {
        removed.push(node);
      }
    }

    return { added, removed, commonAncestor: lcaId };
  }

  /**
   * Speculative Merge Simulation: Forecasts conflicts and blast radius without writing a commit.
   * Perfect for "What-If" analysis in agentic swarms.
   */
  async simulateMerge(
    sourceRef: string,
    targetRef: string
  ): Promise<ConflictResult & { lcaId: string | null; affectedPaths: string[] }> {
    const sourceHead = await this.resolveRef(sourceRef);
    const targetHead = await this.resolveRef(targetRef);
    const lcaId = await this.findLCA(sourceHead, targetHead);

    if (!lcaId) {
      // If no LCA, everything in source might be new
      const sourceNode = await this.getNode(sourceHead);
      const sourceTree = sourceNode.tree || (await this.resolveTree(sourceNode));
      return {
        hasConflicts: false,
        conflicts: [],
        mergedTree: sourceTree,
        lcaId: null,
        affectedPaths: Object.keys(sourceTree),
      };
    }

    const conflictResult = await this.calculateMerge(lcaId, sourceHead, targetHead);
    const sourceNode = await this.getNode(sourceHead);
    const baseNode = await this.getNode(lcaId);

    let affectedPaths: string[] = [];
    if (
      sourceNode.metadata?.isHierarchical &&
      baseNode.metadata?.isHierarchical &&
      baseNode.metadata.treeHash &&
      sourceNode.metadata.treeHash
    ) {
      // O(log N) Affected Path detection via hash diffing
      affectedPaths = await this.calculateAffectedPaths(
        baseNode.metadata.treeHash,
        sourceNode.metadata.treeHash
      );
    } else {
      const sourceTree = sourceNode.tree || (await this.resolveTree(sourceNode));
      const baseTree = baseNode.tree || (await this.resolveTree(baseNode));
      affectedPaths = Object.keys(sourceTree).filter((p) => sourceTree[p] !== baseTree[p]);
    }

    return {
      ...conflictResult,
      lcaId,
      affectedPaths,
    };
  }

  /**
   * Recursively identifies paths that differ between two tree hashes.
   */
  private async calculateAffectedPaths(
    hashA: string,
    hashB: string,
    prefix: string = ''
  ): Promise<string[]> {
    if (hashA === hashB) return [];

    const entriesA = await this.getTree(hashA);
    const entriesB = await this.getTree(hashB);
    const allNames = new Set([...Object.keys(entriesA), ...Object.keys(entriesB)]);
    const paths: string[] = [];

    for (const name of allNames) {
      const a = entriesA[name];
      const b = entriesB[name];
      const currentPath = prefix ? `${prefix}/${name}` : name;

      if (!a && b) {
        if (b.type === 'tree') {
          const sub = await this.calculateAffectedPaths('', b.hash, currentPath);
          paths.push(...sub);
        } else {
          paths.push(currentPath);
        }
      } else if (a && !b) {
        paths.push(currentPath);
      } else if (a && b && a.hash !== b.hash) {
        if (a.type === 'tree' && b.type === 'tree') {
          const sub = await this.calculateAffectedPaths(a.hash, b.hash, currentPath);
          paths.push(...sub);
        } else {
          paths.push(currentPath);
        }
      }
    }
    return paths;
  }

  async mergeTrees(
    transaction: any,
    baseHash: string,
    sourceHash: string,
    targetHash: string,
    agentId?: string
  ): Promise<{ hash: string; conflicts: string[] }> {
    if (sourceHash === targetHash) return { hash: sourceHash, conflicts: [] };
    if (sourceHash === baseHash) return { hash: targetHash, conflicts: [] };
    if (targetHash === baseHash) return { hash: sourceHash, conflicts: [] };

    const baseEntries = await this.getTree(baseHash);
    const sourceEntries = await this.getTree(sourceHash);
    const targetEntries = await this.getTree(targetHash);

    const allNames = new Set([
      ...Object.keys(baseEntries),
      ...Object.keys(sourceEntries),
      ...Object.keys(targetEntries),
    ]);
    const mergedEntries: Record<string, TreeEntry> = {};
    let allConflicts: string[] = [];

    const subTreePromises: Promise<void>[] = [];

    for (const name of allNames) {
      const b = baseEntries[name];
      const s = sourceEntries[name];
      const t = targetEntries[name];

      if (s?.hash === t?.hash) {
        if (s) mergedEntries[name] = s;
        continue;
      }
      if (s?.hash === b?.hash) {
        if (t) mergedEntries[name] = t;
        continue;
      }
      if (t?.hash === b?.hash) {
        if (s) mergedEntries[name] = s;
        continue;
      }

      // Conflict or recursion
      if (s?.type === 'tree' && t?.type === 'tree') {
        const promise = this.mergeTrees(transaction, b?.hash || '', s.hash, t.hash, agentId).then(
          (res) => {
            mergedEntries[name] = { type: 'tree', hash: res.hash };
            allConflicts = allConflicts.concat(res.conflicts.map((c) => `${name}/${c}`));
          }
        );
        subTreePromises.push(promise);
      } else {
        allConflicts.push(name);
        if (t) mergedEntries[name] = t;
      }
    }

    await Promise.all(subTreePromises);
    const newHash = await this.writeTree(transaction, mergedEntries, agentId);
    return { hash: newHash, conflicts: allConflicts };
  }

  private async calculateMerge(
    baseId: string,
    sourceId: string,
    targetId: string
  ): Promise<ConflictResult> {
    const baseNode = await this.getNode(baseId);
    const sourceNode = await this.getNode(sourceId);
    const targetNode = await this.getNode(targetId);

    if (
      baseNode.metadata?.isHierarchical &&
      sourceNode.metadata?.isHierarchical &&
      targetNode.metadata?.isHierarchical
    ) {
      const agentId = 'merge';
      await this.db.beginWork(agentId);
      try {
        const result = await this.mergeTrees(
          null,
          baseNode.metadata?.treeHash!,
          sourceNode.metadata?.treeHash!,
          targetNode.metadata?.treeHash!,
          agentId
        );
        await this.db.commitWork(agentId);
        const mergedTree: Record<string, string> = {};
        await this.flattenTree(result.hash, '', mergedTree);
        return {
          hasConflicts: result.conflicts.length > 0,
          conflicts: result.conflicts,
          mergedTree,
        };
      } catch (e) {
        await this.db.rollbackWork(agentId);
        throw e;
      }
    }

    const baseTree = await this.resolveTree(baseNode);
    const sourceTree = await this.resolveTree(sourceNode);
    const targetTree = await this.resolveTree(targetNode);

    const allPaths = new Set([
      ...Object.keys(baseTree),
      ...Object.keys(sourceTree),
      ...Object.keys(targetTree),
    ]);
    const mergedTree: Record<string, string> = {};
    const conflicts: string[] = [];

    for (const path of allPaths) {
      if (sourceTree[path] === targetTree[path]) {
        if (sourceTree[path]) mergedTree[path] = sourceTree[path]!;
        continue;
      }
      if (sourceTree[path] === baseTree[path]) {
        if (targetTree[path]) mergedTree[path] = targetTree[path]!;
        continue;
      }
      if (targetTree[path] === baseTree[path]) {
        if (sourceTree[path]) mergedTree[path] = sourceTree[path]!;
        continue;
      }
      conflicts.push(path);
      if (targetTree[path]) mergedTree[path] = targetTree[path]!;
    }

    // --- REASONING CONFLICT DETECTION ---
    let reasoningConflicts: { nodeId: string; conflictingNodeId: string; confidence: number }[] =
      [];
    if (this.agentContext) {
      try {
        // Extract KB IDs from the source commit's data
        const kbIds: string[] = [];
        if (sourceNode.data.knowledgeIds) kbIds.push(...sourceNode.data.knowledgeIds);
        if (sourceNode.data.factId) kbIds.push(sourceNode.data.factId);
        if (sourceNode.data.factAId) kbIds.push(sourceNode.data.factAId);
        if (sourceNode.data.factBId) kbIds.push(sourceNode.data.factBId);

        if (kbIds.length > 0) {
          const auditRes = await this.agentContext.detectContradictions(kbIds, 2);
          reasoningConflicts = auditRes.map((r: any) => ({
            nodeId: r.nodeId,
            conflictingNodeId: r.conflictingNodeId,
            confidence: r.confidence,
          }));
        }
    } catch {
      // Ignore
    }
    }

    return {
      hasConflicts: conflicts.length > 0 || reasoningConflicts.length > 0,
      conflicts,
      reasoningConflicts,
      mergedTree,
    };
  }

  // ─── Summarize (Memory Compaction) ───

  async summarize(
    branchName: string,
    summaryData: any,
    author: string,
    message: string = 'Memory Compaction'
  ): Promise<string> {
    return this.commit(branchName, summaryData, author, message, { type: 'summary' });
  }

  // ─── DIFF ───

  async diff(refA: string, refB: string): Promise<DiffResult> {
    const nodeA = await this.checkout(refA);
    const nodeB = await this.checkout(refB);
    const treeA: Record<string, string> = nodeA?.tree || {};
    const treeB: Record<string, string> = nodeB?.tree || {};

    const allPaths = new Set([...Object.keys(treeA), ...Object.keys(treeB)]);
    const result: DiffResult = { added: [], removed: [], modified: [], unchanged: [] };

    for (const p of allPaths) {
      const inA = p in treeA;
      const inB = p in treeB;
      if (inA && !inB) result.removed.push(p);
      else if (!inA && inB) result.added.push(p);
      else if (treeA[p] !== treeB[p]) result.modified.push(p);
      else result.unchanged.push(p);
    }
    return result;
  }

  // ─── STASH ───

  async stash(branch: string, label?: string): Promise<string> {
    return executor.execute(`stash:${branch}`, async () => {
      const node = await this.checkout(branch);
      if (!node) throw new AgentGitError(`Nothing to stash on '${branch}'`, 'EMPTY_BRANCH');

      const id = crypto.randomUUID();
      await this.db.push({
        type: 'insert',
        table: 'stashes',
        values: {
          id,
          repoPath: this.basePath,
          branch,
          nodeId: node.id,
          data: JSON.stringify(node.data),
          tree: JSON.stringify(node.tree || {}),
          label: label || `stash@{${new Date().toISOString()}}`,
          createdAt: Date.now(),
        },
        layer: 'domain',
      });
      return id;
    });
  }

  async stashPop(stashId: string, branch: string, author: string): Promise<string> {
    return executor.execute(`stash-pop:${branch}:${stashId}`, async () => {
      const stash = await this.db.selectOne('stashes', [
        { column: 'repoPath', value: this.basePath },
        { column: 'id', value: stashId },
      ]);
      if (!stash) throw new AgentGitError(`Stash '${stashId}' not found`, 'STASH_NOT_FOUND');

      const commitId = await this.commit(
        branch,
        JSON.parse(stash.data),
        author,
        `Apply stash: ${stash.label}`,
        {
          metadata: { stashId, originalBranch: stash.branch },
        }
      );
      await this.db.push({
        type: 'delete',
        table: 'stashes',
        where: [
          { column: 'repoPath', value: this.basePath },
          { column: 'id', value: stashId },
        ],
        layer: 'domain',
      });
      return commitId;
    });
  }

  async listStashes(): Promise<StashEntry[]> {
    const rows = await this.db.selectWhere('stashes', [
      { column: 'repoPath', value: this.basePath },
    ]);
    return rows.map((r) => ({ id: r.id, branch: r.branch, label: r.label }));
  }

  // ─── RESET (Hard) ───

  async reset(
    branch: string,
    targetRef: string,
    author: string,
    options: { mode?: 'hard' | 'soft'; usage?: Usage; metadata?: Record<string, any> } = {}
  ): Promise<void> {
    return executor.execute(`reset:${branch}`, async () => {
      const targetNodeId = await this.resolveRef(targetRef);
      const branchHeadId = await this.resolveRef(branch);

      const targetNode = await this.getNode(targetNodeId);

      const oldHead = branchHeadId;
      const mode = options.mode || 'hard';
      let finalNodeId = targetNodeId;

      if (mode === 'soft') {
        const diffNodeId = this.generateNodeId();
        const tree = targetNode.tree || (await this.resolveTree(targetNode));
        const metadata = {
          ...options.metadata,
          resetMode: 'soft',
          environment: EnvironmentTracker.capture(),
        };

        const diffNode = {
          id: diffNodeId,
          repoPath: this.basePath,
          parentId: branchHeadId,
          data: JSON.stringify({}),
          message: `soft reset to ${targetRef}`,
          author,
          timestamp: Date.now(),
          type: 'diff' as const,
          tree: JSON.stringify(tree),
          usage: options.usage ? JSON.stringify(options.usage) : null,
          metadata: JSON.stringify(metadata),
        };

        await this.db.push({
          type: 'insert',
          table: 'nodes',
          values: diffNode,
          layer: 'domain',
        });

        this.nodeCache.set(diffNodeId, {
          ...(diffNode as any),
          data: {},
          tree,
          usage: options.usage,
          metadata,
        });
        finalNodeId = diffNodeId;
      }

      await this.db.push({
        type: 'update',
        table: 'branches',
        where: [
          { column: 'repoPath', value: this.basePath },
          { column: 'name', value: branch },
        ],
        values: { head: finalNodeId },
        layer: 'domain',
      });

      this.refCache.set(branch, finalNodeId);
      await this.recordRefLog(
        branch,
        oldHead,
        finalNodeId,
        author,
        'reset',
        `Reset to ${targetRef} (${mode} mode)`
      );
    });
  }

  // ─── REVERT ───

  async revert(branch: string, nodeIdToRevert: string, author: string): Promise<string> {
    return executor.execute(`revert:${branch}:${nodeIdToRevert}`, async () => {
      const targetNode = await this.getNode(nodeIdToRevert);
      if (targetNode.parentId) {
        const parentNode = await this.getNode(targetNode.parentId);
        return this.commit(branch, parentNode.data, author, `Revert "${targetNode.message}"`, {
          metadata: { revertedNode: nodeIdToRevert },
        });
      } else {
        return this.commit(branch, {}, author, `Revert "${targetNode.message}" (initial commit)`, {
          metadata: { revertedNode: nodeIdToRevert },
        });
      }
    });
  }

  // ─── Maintenance & GC ───

  public async gc(): Promise<{
    prunedNodes: number;
    prunedTrees: number;
    vaporizedBranches: number;
  }> {
    return executor.execute('gc', async () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const expiredBranches = await this.db.selectWhere('branches', [
        { column: 'repoPath', value: this.basePath },
        { column: 'isEphemeral', value: 1 },
      ]);

      let vaporizedCount = 0;
      for (const branch of expiredBranches) {
        if (branch.createdAt < oneHourAgo) {
          await this.db.push({
            type: 'delete',
            table: 'branches',
            where: [
              { column: 'repoPath', value: this.basePath },
              { column: 'name', value: branch.name },
            ],
            layer: 'domain',
          });
          vaporizedCount++;
        }
      }
      if (vaporizedCount > 0) this.clearTreeCache();

      const reachableNodes = new Set<string>();
      const reachableTrees = new Set<string>();

      const [branches, tags, stashes, reflog] = await Promise.all([
        this.db.selectWhere('branches', [{ column: 'repoPath', value: this.basePath }]),
        this.db.selectWhere('tags', [{ column: 'repoPath', value: this.basePath }]),
        this.db.selectWhere('stashes', [{ column: 'repoPath', value: this.basePath }]),
        this.db.selectWhere('reflog', [{ column: 'repoPath', value: this.basePath }]),
      ]);

      const heads = new Set<string>(
        [
          ...branches.map((d) => d.head),
          ...tags.map((d) => d.head),
          ...stashes.map((d) => d.nodeId),
          ...reflog.map((d) => d.newHead),
          ...reflog.map((d) => d.oldHead),
        ].filter((h): h is string => h !== null)
      );

      for (const nodeId of heads) {
        await this.markReachable(nodeId, reachableNodes, reachableTrees);
      }

      const allNodes = await this.db.selectWhere('nodes', [
        { column: 'repoPath', value: this.basePath },
      ]);
      let prunedNodes = 0;
      for (const node of allNodes) {
        if (!reachableNodes.has(node.id)) {
          await this.db.push({
            type: 'delete',
            table: 'nodes',
            where: [
              { column: 'repoPath', value: this.basePath },
              { column: 'id', value: node.id },
            ],
            layer: 'domain',
          });
          prunedNodes++;
        }
      }

      const allTrees = await this.db.selectWhere('trees', [
        { column: 'repoPath', value: this.basePath },
      ]);
      let prunedTrees = 0;
      for (const tree of allTrees) {
        if (!reachableTrees.has(tree.id)) {
          await this.db.push({
            type: 'delete',
            table: 'trees',
            where: [
              { column: 'repoPath', value: this.basePath },
              { column: 'id', value: tree.id },
            ],
            layer: 'domain',
          });
          prunedTrees++;
        }
      }

      return { prunedNodes, prunedTrees, vaporizedBranches: vaporizedCount };
    });
  }

  private async markReachable(
    startNodeId: string,
    visitedNodes: Set<string>,
    visitedTrees: Set<string>
  ): Promise<void> {
    let currentId: string | null = startNodeId;
    while (currentId) {
      if (visitedNodes.has(currentId)) break;
      visitedNodes.add(currentId);

      const node = await this.getNode(currentId);
      if (!node) break;

      if (node.metadata?.treeHash) {
        await this.markTreeReachable(node.metadata.treeHash, visitedTrees);
      }
      currentId = node.parentId || null;
    }
  }

  private async markTreeReachable(
    treeHash: string,
    visitedTrees: Set<string>,
    depth: number = 0
  ): Promise<void> {
    if (visitedTrees.has(treeHash) || depth > 100) return;
    visitedTrees.add(treeHash);

    const entries = await this.getTree(treeHash);
    for (const entry of Object.values(entries)) {
      if (entry.type === 'tree') {
        await this.markTreeReachable(entry.hash, visitedTrees, depth + 1);
      }
    }
  }

  // ─── CHERRY-PICK ───

  async cherryPick(nodeId: string, targetBranch: string, author: string): Promise<string> {
    return executor.execute(`cherry-pick:${targetBranch}:${nodeId}`, async () => {
      const sourceNode = await this.getNode(nodeId);
      return this.commit(
        targetBranch,
        sourceNode.data,
        author,
        `Cherry-pick: ${sourceNode.message}`,
        {
          type: sourceNode.type,
          metadata: { ...sourceNode.metadata, cherryPickedFrom: nodeId },
        }
      );
    });
  }

  // ─── STATUS ───

  async status(branch: string): Promise<StatusResult> {
    const branchDoc = await this.db.selectOne('branches', [
      { column: 'repoPath', value: this.basePath },
      { column: 'name', value: branch },
    ]);
    if (!branchDoc) throw new AgentGitError(`Branch '${branch}' not found`, 'BRANCH_NOT_FOUND');

    const headNodeId = branchDoc.head || null;
    let headMessage: string | null = null;
    let headAuthor: string | null = null;
    let files: string[] = [];
    let commitCount = 0;

    if (headNodeId) {
      const headNode = await this.getNode(headNodeId);
      headMessage = headNode.message;
      headAuthor = headNode.author;
      const tree = await this.resolveTree(headNode);
      files = Object.keys(tree).sort();

      let current: string | null = headNodeId;
      while (current) {
        commitCount++;
        const n = await this.getNode(current);
        current = n.parentId;
      }
    }

    return {
      branch,
      headNodeId,
      headMessage,
      headAuthor,
      fileCount: files.length,
      files,
      commitCount,
    };
  }

  // ─── BLAME ───

  async blame(branch: string, filePath: string): Promise<BlameEntry> {
    const normalizedPath = filePath.replace(/^\/+/, '').replace(/\/\/+/g, '/');
    const commits = await this.history(branch, 100);

    for (let i = 0; i < commits.length; i++) {
      const node = commits[i]!;
      const tree = await this.resolveTree(node);

      if (!(normalizedPath in tree)) {
        if (i > 0) {
          const prev = commits[i - 1]!;
          return {
            path: normalizedPath,
            lastAuthor: prev.author,
            lastMessage: prev.message,
            lastNodeId: prev.id,
            lastTimestamp: prev.timestamp,
          };
        }
        break;
      }

      if (i < commits.length - 1) {
        const nextNode = commits[i + 1]!;
        const prevTree = await this.resolveTree(nextNode);
        if (tree[normalizedPath] !== prevTree[normalizedPath]) {
          return {
            path: normalizedPath,
            lastAuthor: node.author,
            lastMessage: node.message,
            lastNodeId: node.id,
            lastTimestamp: node.timestamp,
          };
        }
      } else {
        return {
          path: normalizedPath,
          lastAuthor: node.author,
          lastMessage: node.message,
          lastNodeId: node.id,
          lastTimestamp: node.timestamp,
        };
      }
    }

    throw new AgentGitError(`File '${normalizedPath}' not found in history`, 'FILE_NOT_FOUND');
  }

  // ─── REBASE ───

  async rebase(branch: string, ontoRef: string, author: string): Promise<string> {
    return executor.execute(`rebase:${branch}->${ontoRef}`, async () => {
      const ontoNodeId = await this.resolveRef(ontoRef);
      const branchHeadId = await this.resolveRef(branch);

      if (branchHeadId === ontoNodeId) return branchHeadId;

      const lcaId = await this.findLCA(branchHeadId, ontoNodeId);
      if (!lcaId)
        throw new AgentGitError('No common ancestor found for rebase', 'NO_COMMON_ANCESTOR');

      if (lcaId === branchHeadId) {
        await this.reset(branch, ontoNodeId, author);
        return ontoNodeId;
      }

      const commitsToReplay: MemoryNode[] = [];
      let currentId: string | null = branchHeadId;
      while (currentId && currentId !== lcaId) {
        const node = await this.getNode(currentId);
        commitsToReplay.unshift(node);
        currentId = node.parentId;
      }

      let newHeadId = ontoNodeId;
      for (const commit of commitsToReplay) {
        const newNodeId = await this.commit(branch, commit.data, commit.author, commit.message, {
          type: commit.type,
          metadata: { ...commit.metadata, rebasedFrom: commit.id },
        });
        newHeadId = newNodeId;
      }

      await this.recordRefLog(
        branch,
        branchHeadId,
        newHeadId,
        author,
        'rebase',
        `Rebase onto ${ontoRef} (${ontoNodeId})`
      );
      return newHeadId;
    });
  }

  // ─── SQUASH ───

  async squash(branch: string, count: number, author: string, message: string): Promise<string> {
    return executor.execute(`squash:${branch}`, async () => {
      if (count < 2)
        throw new AgentGitError('Squash requires at least 2 commits', 'INVALID_SQUASH_COUNT');

      const head = await this.checkout(branch);
      if (!head) throw new AgentGitError('Branch is empty', 'EMPTY_BRANCH');

      const history = await this.history(branch, count + 1);
      if (history.length < count)
        throw new AgentGitError(
          `Not enough commits to squash (requested ${count}, found ${history.length})`,
          'NOT_ENOUGH_HISTORY'
        );

      const nodeId = this.generateNodeId();
      const agentId = author || 'default';
      await this.db.beginWork(agentId);
      try {
        await this.commitInTransaction(
          null as any,
          branch,
          nodeId,
          head.data,
          author,
          message,
          {
            type: 'snapshot',
          },
          agentId
        );
        await this.db.commitWork(agentId);
      } catch (e) {
        await this.db.rollbackWork(agentId);
        throw e;
      }

      await this.recordRefLog(
        branch,
        head.id,
        nodeId,
        author,
        'commit',
        `Squash ${count} commits: ${message}`
      );
      return nodeId;
    });
  }

  // ─── REFLOG ───

  async getRefLog(branch: string, options: { limit?: number } = {}): Promise<RefLogEntry[]> {
    const rows = await this.db.selectWhere('reflog', [
      { column: 'repoPath', value: this.basePath },
      { column: 'ref', value: branch },
    ]);

    let results = rows
      .map(
        (r) =>
          ({
            ...r,
            timestamp: Number(r.timestamp),
          }) as unknown as RefLogEntry
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit) results = results.slice(0, options.limit);
    return results;
  }

  // ─── ENHANCED LOG ───

  async log(branch: string, options: LogOptions = {}): Promise<MemoryNode[]> {
    const { limit = 100, author, messageRegex, since, until, taskId } = options;
    const history = await this.history(branch, limit);

    return history.filter((node) => {
      if (author && node.author !== author) return false;
      if (messageRegex && !new RegExp(messageRegex, 'i').test(node.message)) return false;
      if (since && node.timestamp < since.getTime()) return false;
      if (until && node.timestamp > until.getTime()) return false;
      if (taskId && node.metadata?.taskId !== taskId) return false;
      return true;
    });
  }

  // ─── LCA (Lowest Common Ancestor) ───

  private async findLCA(idA: string, idB: string): Promise<string | null> {
    const ancestorsA = new Set<string>();
    let currA: string | null = idA;
    while (currA) {
      ancestorsA.add(currA);
      const node = await this.getNode(currA);
      currA = node.parentId;
      if (ancestorsA.size > 1000) break; // Safety break
    }

    let currB: string | null = idB;
    while (currB) {
      if (ancestorsA.has(currB)) return currB;
      const node = await this.getNode(currB);
      currB = node.parentId;
    }
    return null;
  }

  // ─── HOOKS ───

  registerHook(
    event: 'pre-commit' | 'post-commit' | 'post-merge',
    callback: (data: any) => Promise<void>
  ) {
    if (!this.hooks[event]) this.hooks[event] = [];
    this.hooks[event].push(callback);
  }

  private async triggerHook(event: string, data: any) {
    const callbacks = this.hooks[event] || [];
    for (const cb of callbacks) await cb(data);
  }

  // ─── BISECT ───

  /**
   * Bisect: Automated binary search through history to find a "bad" commit.
   * testFn should return true if commit is "good", false if "bad".
   */
  async bisect(
    badRef: string,
    goodRef: string,
    testFn: (node: MemoryNode) => Promise<boolean>
  ): Promise<MemoryNode> {
    const badId = await this.resolveRef(badRef);
    const goodId = await this.resolveRef(goodRef);

    const history = await this.history(badId, 1000);
    const range: MemoryNode[] = [];
    let foundGood = false;
    for (const node of history) {
      range.push(node);
      if (node.id === goodId) {
        foundGood = true;
        break;
      }
    }

    if (!foundGood)
      throw new AgentGitError('Good ref not found in bad ref history', 'BISECT_INVALID_RANGE');

    let low = 0;
    let high = range.length - 1;
    let firstBad = range[0]!;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const isGood = await testFn(range[mid]!);
      if (isGood) {
        high = mid - 1;
      } else {
        firstBad = range[mid]!;
        low = mid + 1;
      }
    }
    return firstBad;
  }

  // ─── PATCHING ───

  /**
   * Create a portable patch between two refs.
   */
  async createPatch(fromRef: string, toRef: string): Promise<PatchData> {
    const fromId = await this.resolveRef(fromRef);
    const toId = await this.resolveRef(toRef);

    const history = await this.history(toId, 100);
    const nodes: MemoryNode[] = [];
    const fileIds = new Set<string>();

    for (const node of history) {
      nodes.push(node);
      const tree = node.tree || (await this.resolveTree(node));
      Object.values(tree).forEach((id) => {
        fileIds.add(id as string);
      });
      if (node.id === fromId) break;
    }

    const files: Record<string, any> = {};
    for (const fid of fileIds) {
      const file = await this.db.selectOne('files', [{ column: 'id', value: fid }]);
      if (file) files[fid] = file;
    }

    return { baseNodeId: fromId, targetNodeId: toId, nodes, files };
  }

  /**
   * Apply a portable patch to a branch.
   */
  async applyPatch(branch: string, patch: PatchData, author: string): Promise<string> {
    const agentId = author || 'default';
    await this.db.beginWork(agentId);
    try {
      // Import files
      for (const [fid, fdata] of Object.entries(patch.files)) {
        await this.db.push(
          {
            type: 'insert',
            table: 'files',
            values: { ...(fdata as any), id: fid },
            layer: 'infrastructure',
          },
          agentId
        );
      }

      // Import nodes
      for (const node of patch.nodes) {
        await this.db.push(
          {
            type: 'insert',
            table: 'nodes',
            values: {
              ...(node as any),
              repoPath: this.basePath,
              data: JSON.stringify(node.data),
              usage: node.usage ? JSON.stringify(node.usage) : null,
              metadata: JSON.stringify(node.metadata),
              tree: node.tree ? JSON.stringify(node.tree) : null,
            },
            layer: 'domain',
          },
          agentId
        );
      }

      // Update branch head
      const branchRef = await this.db.selectOne(
        'branches',
        [
          { column: 'repoPath', value: this.basePath },
          { column: 'name', value: branch },
        ],
        agentId
      );
      if (!branchRef) throw new AgentGitError(`Branch ${branch} not found`, 'BRANCH_NOT_FOUND');

      await this.db.push(
        {
          type: 'update',
          table: 'branches',
          where: [
            { column: 'repoPath', value: this.basePath },
            { column: 'name', value: branch },
          ],
          values: { head: patch.targetNodeId },
          layer: 'domain',
        },
        agentId
      );

      await this.db.commitWork(agentId);
      await this.recordRefLog(
        branch,
        branchRef.head,
        patch.targetNodeId,
        author,
        'commit',
        `Applied patch ${patch.targetNodeId}`
      );
      return patch.targetNodeId;
    } catch (e) {
      await this.db.rollbackWork(agentId);
      throw e;
    }
  }

  // ─── AUTONOMOUS INTELLIGENCE ───

  /**
   * Semantic Context Routing
   * Analyzes history to find files frequently co-modified with the target file.
   */
  async getContextGraph(
    branch: string,
    filePath: string,
    limit: number = 50
  ): Promise<{ path: string; weight: number }[]> {
    const commits = await this.history(branch, 200); // Analyze last 200 commits for correlations
    const normalizedTarget = filePath.replace(/^\/+/, '').replace(/\/\/+/g, '/');
    const correlations: Record<string, number> = {};

    for (let i = 0; i < commits.length - 1; i++) {
      const curr = commits[i]!;
      const prev = commits[i + 1]!;
      const currTree = curr.data?.tree || curr.tree || {};
      const prevTree = prev.data?.tree || prev.tree || {};

      // Find all changed files in this commit
      const changedFiles = new Set<string>();
      for (const p of Object.keys(currTree)) {
        if (currTree[p] !== prevTree[p]) changedFiles.add(p);
      }
      for (const p of Object.keys(prevTree)) {
        if (!(p in currTree)) changedFiles.add(p);
      }

      // If the target file changed, increase weight of all other co-changed files
      if (changedFiles.has(normalizedTarget)) {
        changedFiles.delete(normalizedTarget);
        for (const cochanged of changedFiles) {
          correlations[cochanged] = (correlations[cochanged] || 0) + 1;
        }
      }
    }

    // Sort by descending correlation weight
    const sorted = Object.entries(correlations)
      .map(([path, weight]) => ({ path, weight }))
      .sort((a, b) => b.weight - a.weight);

    return sorted.slice(0, limit);
  }

  /**
   * Chronological Time Travel
   * Uses the reflog to safely rollback the branch to its exact state before the given timestamp.
   */
  async timeTravel(branch: string, targetTime: Date, author: string): Promise<string> {
    return executor.execute(`time-travel:${branch}`, async () => {
      const reflogEntries = await this.getRefLog(branch);
      const targetEntry = reflogEntries.find((e) => e.timestamp < targetTime.getTime());

      if (!targetEntry) {
        throw new AgentGitError(
          `No reflog entry found before ${targetTime.toISOString()}`,
          'NOT_ENOUGH_HISTORY'
        );
      }

      const safeNodeId = targetEntry.newHead;

      await this.reset(branch, safeNodeId, author);
      await this.recordRefLog(
        branch,
        null,
        safeNodeId,
        author,
        'reset',
        `Time Travel to ${targetTime.toISOString()} (${safeNodeId})`
      );

      return safeNodeId;
    });
  }

  // ─── AGENTIC SYMBIOSIS ───

  /**
   * Generates a high-level, RAG-ready structural changelog between two references.
   */
  async generateChangelog(baseRef: string, headRef: string): Promise<string> {
    const baseId = await this.resolveRef(baseRef);
    const headId = await this.resolveRef(headRef);

    if (baseId === headId) return 'No changes.';

    const commits = await this.history(headId, 500); // Max 500 commits analyzed
    const path: MemoryNode[] = [];

    let found = false;
    for (const c of commits) {
      path.push(c);
      if (c.id === baseId) {
        found = true;
        break;
      }
    }

    if (!found)
      throw new AgentGitError(
        `Base reference '${baseId}' not found in head's history`,
        'NOT_ENOUGH_HISTORY'
      );

    // path is now head -> ... -> base+1 -> base
    // Exclude base from the actual applied changes
    const appliedCommits = path.slice(0, path.length - 1).reverse(); // Oldest to newest

    const authors = new Set<string>();
    const _filesModified = new Set<string>();
    const messages: string[] = [];

    const baseNode = path[path.length - 1]!;
    const baseTree = baseNode.data?.tree || baseNode.tree || {};
    const headNode = path[0]!;
    const headTree = headNode.data?.tree || headNode.tree || {};

    const added = [];
    const removed = [];
    const modified = [];

    for (const f of Object.keys(headTree)) {
      if (!(f in baseTree)) added.push(f);
      else if (headTree[f] !== baseTree[f]) modified.push(f);
    }
    for (const f of Object.keys(baseTree)) {
      if (!(f in headTree)) removed.push(f);
    }

    for (const c of appliedCommits) {
      authors.add(c.author);
      messages.push(`- [${c.id.substring(0, 7)}] ${c.author}: ${c.message}`);
    }

    return `CHANGELOG: ${baseRef} -> ${headRef}
Authors: ${Array.from(authors).join(', ')}
Total Commits: ${appliedCommits.length}

Files Added (${added.length}): ${added.join(', ') || 'None'}
Files Modified (${modified.length}): ${modified.join(', ') || 'None'}
Files Removed (${removed.length}): ${removed.join(', ') || 'None'}

Commit History:
${messages.join('\n')}`;
  }

  /**
   * Agentic Self-Healing: Finds the last previously known state of a deleted/corrupted file and restores it.
   */
  async recoverFile(branch: string, filePath: string, author: string): Promise<string> {
    return executor.execute(`recover:${branch}:${filePath}`, async () => {
      const normalizedPath = filePath.replace(/^\/+/, '').replace(/\/\/+/g, '/');
      const commits = await this.history(branch, 200);

      let lastKnownDocId: string | null = null;
      let lastKnownCommit: string | null = null;

      for (const commit of commits) {
        const tree = commit.data?.tree || commit.tree || {};
        if (normalizedPath in tree) {
          lastKnownDocId = tree[normalizedPath] as string;
          lastKnownCommit = commit.id;
          break;
        }
      }

      if (!lastKnownDocId) {
        throw new AgentGitError(
          `Cannot recover '${normalizedPath}': file never existed in recent history.`,
          'FILE_NOT_FOUND'
        );
      }

      const branchDoc = await this.db.selectOne('branches', [
        { column: 'repoPath', value: this.basePath },
        { column: 'name', value: branch },
      ]);
      if (!branchDoc) throw new AgentGitError(`Branch ${branch} not found`, 'BRANCH_NOT_FOUND');

      const currentNodeId = branchDoc.head || null;
      if (!currentNodeId) throw new AgentGitError(`Branch ${branch} has no head`, 'EMPTY_BRANCH');

      const headNode = await this.getNode(currentNodeId);
      const headTree = await this.resolveTree(headNode);

      if (headTree[normalizedPath] === lastKnownDocId) {
        return headNode.id; // Already at the correct state
      }

      const newTree = { ...headTree, [normalizedPath]: lastKnownDocId };
      return this.commit(
        branch,
        { tree: newTree },
        author,
        `Recovered ${normalizedPath} from commit ${lastKnownCommit}`,
        {
          metadata: { treeOp: 'recover', path: normalizedPath, recoveredFrom: lastKnownCommit },
        }
      );
    });
  }

  // ─── HYPER-COGNITION ───
}
