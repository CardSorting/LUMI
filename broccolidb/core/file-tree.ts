import * as crypto from 'node:crypto';
import type { BufferedDbPool } from '../infrastructure/db/BufferedDbPool.js';
import { AgentGitError, PathSanitizer } from './errors.js';
import { AgentIgnore } from './ignore.js';
import { TaskMutex } from './mutex.js';
import type { Repository, TreeEntry } from './repository.js';

export interface FileEntry {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  updatedAt: number;
  author: string;
}

/**
 * FileTree provides file-level operations on a Repository branch.
 *
 * Each file is stored as a document in the repo's `files` subcollection.
 * The branch head's MemoryNode.tree maps filePath → fileDocId, creating an
 * immutable snapshot of the tree at each commit.
 */
export class FileTree {
  private db: BufferedDbPool;
  private repo: Repository;
  private ignoreCache: Map<string, { rules: AgentIgnore; head: string }> = new Map();

  constructor(db: BufferedDbPool, repo: Repository) {
    this.db = db;
    this.repo = repo;
  }

  private static CLAIM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  /** Deterministic document ID from file content and encoding (CAS) */
  private fileDocId(content: string, encoding: string): string {
    return crypto.createHash('sha256').update(content).update(encoding).digest('hex'); // Full 64 chars
  }

  private normalizePath(path: string): string {
    return PathSanitizer.validate(path);
  }

  /**
   * Write or update a file on a branch. Creates a new commit with the updated tree.
   */
  async writeFile(
    branch: string,
    path: string,
    content: string,
    author: string,
    options: {
      encoding?: 'utf-8' | 'base64';
      message?: string;
      decisionIds?: string[] | undefined;
    } = {}
  ): Promise<string> {
    const normalizedPath = this.normalizePath(path);
    if (!normalizedPath) {
      throw new AgentGitError('File path cannot be empty', 'INVALID_PATH');
    }

    await this.checkClaim(branch, normalizedPath, author);

    const headNode = await this.repo.checkout(branch, { resolveTree: false });
    const ignoreRules = await this.getIgnoreRules(branch, headNode?.id);
    if (ignoreRules.isIgnored(normalizedPath)) {
      throw new AgentGitError(`Cannot write to ignored path: ${normalizedPath}`, 'IGNORED_PATH');
    }

    const encoding = options.encoding || 'utf-8';
    const fileDocId = this.fileDocId(content, encoding);

    const fileEntry: FileEntry = {
      path: normalizedPath,
      content,
      encoding,
      size: Buffer.byteLength(content, encoding === 'base64' ? 'base64' : 'utf-8'),
      updatedAt: Date.now(),
      author,
    };

    // Warm up the LRU cache immediately
    this.repo.getFileCache().set(fileDocId, fileEntry);

    const nodeId = this.repo.generateNodeId();
    const message = options.message || `write ${normalizedPath}`;

    return TaskMutex.runExclusive(`repo:${this.repo.getBasePath()}:branch:${branch}`, async () => {
      await this.db.runTransaction(async () => {
        // 1. Check if blob exists in Global CAS
        const blob = await this.db.selectOne('files', [{ column: 'id', value: fileDocId }]);
        if (!blob) {
          await this.db.push({
            type: 'insert',
            table: 'files',
            values: {
              id: fileDocId,
              ...fileEntry,
            },
            layer: 'domain',
          });
        }

        // 2. Resolve current head
        const currentNode = await this.repo.checkout(branch, { resolveTree: false });
        const rootHash = currentNode?.metadata?.treeHash || null;

        // 3. Build new hierarchical tree
        const treeEntry: TreeEntry = { type: 'blob', hash: fileDocId };
        const newRootHash = await this.writeHierarchy(rootHash, normalizedPath, treeEntry);

        // 4. Commit
        await this.repo.commitInTransaction(this.db, branch, nodeId, {}, author, message, {
          metadata: {
            treeOp: 'write',
            path: normalizedPath,
            treeHash: newRootHash,
            isHierarchical: true,
          },
        });
      });

      return nodeId;
    });
  }

  /**
   * Recursively builds a hierarchical Merkle tree by path.
   */
  private async writeHierarchy(
    currentRootHash: string | null,
    path: string,
    entry: TreeEntry | null // null means delete
  ): Promise<string> {
    const parts = path.split('/');
    const name = parts[0]!;
    const remaining = parts.slice(1).join('/');

    let entries: Record<string, TreeEntry> = {};
    if (currentRootHash) {
      entries = await this.repo.getTree(currentRootHash);
    }

    if (remaining) {
      // It's a directory
      const subTreeEntry = entries[name];
      const subTreeHash = subTreeEntry?.type === 'tree' ? subTreeEntry.hash : null;
      const newSubTreeHash = await this.writeHierarchy(subTreeHash, remaining, entry);
      entries[name] = { type: 'tree', hash: newSubTreeHash };
    } else {
      // It's the file itself
      if (entry) {
        entries[name] = entry;
      } else {
        delete entries[name];
      }
    }

    return this.repo.writeTree(this.db, entries);
  }

  /**
   * Read a file from the current head of a branch.
   */
  async readFile(
    branch: string,
    path: string,
    options: { skipIgnore?: boolean } = {}
  ): Promise<FileEntry> {
    const normalizedPath = this.normalizePath(path);

    const currentNode = await this.repo.checkout(branch, { resolveTree: false });
    if (!options.skipIgnore) {
      const ignoreRules = await this.getIgnoreRules(branch, currentNode?.id);
      if (ignoreRules.isIgnored(normalizedPath)) {
        throw new AgentGitError(`Cannot read ignored path: ${normalizedPath}`, 'IGNORED_PATH');
      }
    }

    let fileDocId: string | undefined;

    if (currentNode?.metadata?.isHierarchical && currentNode.metadata.treeHash) {
      // Hierarchical Lookup (O(log N))
      fileDocId = await this.resolvePathToHash(currentNode.metadata.treeHash, normalizedPath);
    } else {
      // Legacy flat lookup / fallback
      if (!currentNode) {
        throw new AgentGitError(`Branch '${branch}' is empty`, 'EMPTY_TREE');
      }

      // Re-resolve tree if missing
      if (!currentNode.tree) {
        await this.repo.resolveTree(currentNode);
      }

      fileDocId = currentNode.tree?.[normalizedPath];
    }

    if (!fileDocId) {
      throw new AgentGitError(
        `File '${normalizedPath}' not found on branch '${branch}'`,
        'FILE_NOT_FOUND'
      );
    }

    // Sub-repos appear as "REPO:{id}"
    if (fileDocId.startsWith('REPO:')) {
      throw new AgentGitError(
        `Path '${normalizedPath}' is a sub-repo, use listSubRepos to inspect.`,
        'INVALID_PATH'
      );
    }

    // CHECK CACHE
    const cachedFile = this.repo.getFileCache().get(fileDocId);
    if (cachedFile) return cachedFile;

    const file = await this.db.selectOne('files', [{ column: 'id', value: fileDocId }]);
    if (!file) {
      throw new AgentGitError(`File document '${fileDocId}' missing from storage`, 'FILE_CORRUPT');
    }

    const data = file as FileEntry;
    this.repo.getFileCache().set(fileDocId, data);
    return data;
  }

  /**
   * Recursively traverses the Merkle tree to find a specific path's hash.
   */
  private async resolvePathToHash(treeHash: string, path: string): Promise<string | undefined> {
    const parts = path.split('/');
    const name = parts[0]!;
    const remaining = parts.slice(1).join('/');

    const entries = await this.repo.getTree(treeHash);
    const entry = entries[name];

    if (!entry) return undefined;

    if (remaining) {
      if (entry.type !== 'tree') return undefined; // Expected dir but found file
      return this.resolvePathToHash(entry.hash, remaining);
    } else {
      return entry.type === 'blob' ? entry.hash : `REPO:${entry.hash}`;
    }
  }

  /**
   * Read a file as it existed at a specific commit node.
   */
  async readFileAtNode(nodeId: string, path: string): Promise<FileEntry> {
    const normalizedPath = this.normalizePath(path);
    const node = await this.repo.getNode(nodeId);

    const resolvedTree = node.tree || (await this.repo.resolveTree(node));
    const fileDocId = resolvedTree[normalizedPath];
    if (!fileDocId) {
      throw new AgentGitError(
        `File '${normalizedPath}' not found at node '${nodeId}'`,
        'FILE_NOT_FOUND'
      );
    }

    // CHECK CACHE
    const cachedFile = this.repo.getFileCache().get(fileDocId);
    if (cachedFile) return cachedFile;

    const file = await this.db.selectOne('files', [{ column: 'id', value: fileDocId }]);
    if (!file) {
      throw new AgentGitError(`File document '${fileDocId}' missing from storage`, 'FILE_CORRUPT');
    }

    const data = file as FileEntry;
    this.repo.getFileCache().set(fileDocId, data);
    return data;
  }

  /**
   * Delete a file from a branch. Creates a new commit with the file removed from the tree.
   */
  async deleteFile(
    branch: string,
    path: string,
    author: string,
    options: { message?: string } = {}
  ): Promise<string> {
    const normalizedPath = this.normalizePath(path);

    await this.checkClaim(branch, normalizedPath, author);

    const nodeId = this.repo.generateNodeId();
    const message = options.message || `delete ${normalizedPath}`;

    return TaskMutex.runExclusive(`repo:${this.repo.getBasePath()}:branch:${branch}`, async () => {
      await this.db.runTransaction(async () => {
        const currentNode = await this.repo.checkout(branch, { resolveTree: false });
        const rootHash = currentNode?.metadata?.treeHash || null;

        if (!rootHash) {
          throw new AgentGitError(
            `File '${normalizedPath}' not found on empty branch`,
            'FILE_NOT_FOUND'
          );
        }

        const newRootHash = await this.writeHierarchy(rootHash, normalizedPath, null);

        await this.repo.commitInTransaction(this.db, branch, nodeId, {}, author, message, {
          metadata: {
            treeOp: 'delete',
            path: normalizedPath,
            treeHash: newRootHash,
            isHierarchical: true,
          },
        });
      });
      return nodeId;
    });
  }

  /**
   * List all files on a branch, optionally filtered by a directory prefix.
   * Returns paths alongside their structural file sizes for LLM context management.
   */
  async listFiles(branch: string, prefix?: string): Promise<{ path: string; size: number }[]> {
    const currentNode = await this.repo.checkout(branch);
    if (!currentNode?.tree) {
      return [];
    }

    let entries = Object.entries(currentNode.tree);

    const ignoreRules = await this.getIgnoreRules(branch, currentNode.id);
    entries = entries.filter(([p, id]) => !id.startsWith('REPO:') && !ignoreRules.isIgnored(p));

    if (prefix) {
      const normalizedPrefix = this.normalizePath(prefix);
      entries = entries.filter(([p]) => p.startsWith(normalizedPrefix));
    }

    if (entries.length === 0) return [];

    const result: { path: string; size: number }[] = [];
    const missingDocs: { path: string; docId: string }[] = [];

    // L1 CACHE PRE-FETCH: Resolve all sizes possible from RAM instantly
    for (const [path, docId] of entries) {
      const cached = this.repo.getFileCache().get(docId);
      if (cached) {
        result.push({ path, size: cached.size || 0 });
      } else {
        missingDocs.push({ path, docId });
      }
    }

    // BATCH OPTIMIZATION: Resolve from SQLite
    if (missingDocs.length > 0) {
      for (const item of missingDocs) {
        const file = await this.db.selectOne('files', [{ column: 'id', value: item.docId }]);
        let size = 0;
        if (file) {
          const data = file as FileEntry;
          size = data.size || 0;
          this.repo.getFileCache().set(item.docId, data);
        }
        result.push({ path: item.path, size });
      }
    }

    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Register a sub-repository at a specific directory path.
   * Mirroring `git submodule add`.
   */
  async addSubRepo(
    branch: string,
    path: string,
    subRepoId: string,
    author: string
  ): Promise<string> {
    const normalizedPath = this.normalizePath(path);
    const nodeId = this.repo.generateNodeId();

    return TaskMutex.runExclusive(`repo:${this.repo.getBasePath()}:branch:${branch}`, async () => {
      await this.db.runTransaction(async () => {
        const currentNode = await this.repo.checkout(branch, { resolveTree: false });
        const rootHash = currentNode?.metadata?.treeHash || null;

        const newRootHash = await this.writeHierarchy(rootHash, normalizedPath, {
          type: 'subrepo',
          hash: subRepoId,
        });

        await this.repo.commitInTransaction(
          this.db,
          branch,
          nodeId,
          {},
          author,
          `Add sub-repo ${subRepoId} at ${normalizedPath}`,
          {
            metadata: {
              treeOp: 'subrepo_add',
              path: normalizedPath,
              subRepoId,
              treeHash: newRootHash,
              isHierarchical: true,
            },
          }
        );
      });
      return nodeId;
    });
  }

  /**
   * List all sub-repositories registered in this file tree.
   */
  async listSubRepos(branch: string): Promise<Record<string, string>> {
    const currentNode = await this.repo.checkout(branch);
    if (!currentNode) return {};

    // Use resolved flat tree for full listing
    const tree = currentNode.tree || (await this.repo.resolveTree(currentNode));
    const subs: Record<string, string> = {};

    for (const [path, id] of Object.entries(tree)) {
      if ((id as string).startsWith('REPO:')) {
        subs[path] = (id as string).replace('REPO:', '');
      }
    }
    return subs;
  }

  /**
   * Move or rename a file atomically.
   */
  async moveFile(
    branch: string,
    fromPath: string,
    toPath: string,
    author: string,
    options: { message?: string } = {}
  ): Promise<string> {
    const from = this.normalizePath(fromPath);
    const to = this.normalizePath(toPath);

    await this.checkClaim(branch, from, author);
    await this.checkClaim(branch, to, author);

    const nodeId = this.repo.generateNodeId();
    const message = options.message || `move ${from} to ${to}`;

    return TaskMutex.runExclusive(`repo:${this.repo.getBasePath()}:branch:${branch}`, async () => {
      await this.db.runTransaction(async () => {
        const currentNode = await this.repo.checkout(branch);
        const rootHash = currentNode?.metadata?.treeHash || null;

        // 1. Get blob hash from 'from' path
        const flatTree = await this.repo.resolveTree(currentNode!);
        const blobHash = flatTree[from];
        if (!blobHash) throw new AgentGitError(`Source file '${from}' not found`, 'FILE_NOT_FOUND');

        // 2. Delete 'from', then write 'to'
        const intermediateHash = await this.writeHierarchy(rootHash, from, null);
        const newRootHash = await this.writeHierarchy(intermediateHash, to, {
          type: 'blob',
          hash: blobHash,
        });

        await this.repo.commitInTransaction(this.db, branch, nodeId, {}, author, message, {
          metadata: { treeOp: 'move', from, to, treeHash: newRootHash, isHierarchical: true },
        });
      });
      return nodeId;
    });
  }

  /**
   * Copy a file atomically using CAS pointers (zero storage overhead).
   */
  async copyFile(
    branch: string,
    fromPath: string,
    toPath: string,
    author: string,
    options: { message?: string } = {}
  ): Promise<string> {
    const from = this.normalizePath(fromPath);
    const to = this.normalizePath(toPath);

    const nodeId = this.repo.generateNodeId();
    const message = options.message || `copy ${from} to ${to}`;

    return TaskMutex.runExclusive(`repo:${this.repo.getBasePath()}:branch:${branch}`, async () => {
      await this.db.runTransaction(async () => {
        const currentNode = await this.repo.checkout(branch);
        const rootHash = currentNode?.metadata?.treeHash || null;

        const flatTree = await this.repo.resolveTree(currentNode!);
        const blobHash = flatTree[from];
        if (!blobHash) throw new AgentGitError(`Source file '${from}' not found`, 'FILE_NOT_FOUND');

        const newRootHash = await this.writeHierarchy(rootHash, to, {
          type: 'blob',
          hash: blobHash,
        });

        await this.repo.commitInTransaction(this.db, branch, nodeId, {}, author, message, {
          metadata: { treeOp: 'copy', from, to, treeHash: newRootHash, isHierarchical: true },
        });
      });
      return nodeId;
    });
  }

  /**
   * Returns a recursive, nested representation of the file tree.
   * Useful for LLMs to understand directory structure.
   */

  /**
   * Lists entries in a specific directory using Merkle tree traversal.
   * Perfect for lazy-loading UI components.
   */
  async listDirectory(
    branch: string,
    path: string = ''
  ): Promise<{ name: string; type: 'blob' | 'tree' | 'subrepo'; hash: string }[]> {
    const normalizedPath = this.normalizePath(path);
    const node = await this.repo.checkout(branch, { resolveTree: false });

    if (node?.metadata?.isHierarchical && node.metadata.treeHash) {
      const treeHash =
        normalizedPath === ''
          ? node.metadata.treeHash
          : await this.resolvePathToHash(node.metadata.treeHash, normalizedPath);

      if (!treeHash)
        throw new AgentGitError(`Directory '${normalizedPath}' not found`, 'FILE_NOT_FOUND');

      const entries = await this.repo.getTree(treeHash);
      return Object.entries(entries).map(([name, entry]) => ({
        name,
        ...entry,
      }));
    } else {
      // Fallback for flat trees: filter paths by prefix
      if (node && !node.tree) {
        await this.repo.resolveTree(node);
      }
      const tree = node?.tree || {};
      const prefix =
        normalizedPath === ''
          ? ''
          : normalizedPath.endsWith('/')
            ? normalizedPath
            : `${normalizedPath}/`;

      const entriesMap = new Map<string, { type: 'blob' | 'tree' | 'subrepo'; hash: string }>();

      for (const [p, hash] of Object.entries(tree)) {
        if (p.startsWith(prefix)) {
          const relative = p.slice(prefix.length);
          const name = relative.split('/')[0]!;
          if (relative.includes('/')) {
            entriesMap.set(name, { type: 'tree', hash: '' });
          } else {
            const type = hash.startsWith('REPO:') ? 'subrepo' : 'blob';
            const realHash = type === 'subrepo' ? hash.slice(5) : hash;
            entriesMap.set(name, { type, hash: realHash });
          }
        }
      }
      return Array.from(entriesMap.entries()).map(([name, entry]) => ({ name, ...entry }));
    }
  }

  /**
   * Returns a recursive, nested representation of the file tree.
   * Now optimized for both flat and Merkle trees.
   */
  async getRecursiveTree(branch: string): Promise<any> {
    const node = await this.repo.checkout(branch);
    if (node?.metadata?.isHierarchical && node.metadata.treeHash) {
      return this.buildRecursiveHierarchy(node.metadata.treeHash);
    }

    // Legacy fallback
    if (!node?.tree) return {};
    const tree: any = {};
    for (const path of Object.keys(node.tree)) {
      const parts = path.split('/');
      let curr = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (i === parts.length - 1) {
          curr[part] = node.tree[path];
        } else {
          curr[part] = curr[part] || {};
          curr = curr[part];
        }
      }
    }
    return tree;
  }

  private async buildRecursiveHierarchy(treeHash: string): Promise<any> {
    const entries = await this.repo.getTree(treeHash);
    const result: any = {};
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.type === 'tree') {
        result[name] = await this.buildRecursiveHierarchy(entry.hash);
      } else {
        result[name] = entry.hash;
      }
    }
    return result;
  }

  // ─── AGENTIC SWARM FILE CLAIMING ───

  /**
   * Internal claim validator. Throws FILE_LOCKED if another agent holds the claim.
   */
  private async checkClaim(branch: string, normalizedPath: string, author: string): Promise<void> {
    const encodedPath = encodeURIComponent(normalizedPath);
    const claim = await this.db.selectOne('claims', [
      { column: 'repoPath', value: this.repo.getBasePath() },
      { column: 'branch', value: branch },
      { column: 'path', value: encodedPath },
    ]);

    if (claim) {
      const claimer = claim.author;
      const expiresAt = claim.expiresAt;

      // If claim exists and hasn't expired, and is held by someone else, throw error
      if (claimer && claimer !== author && expiresAt && expiresAt > Date.now()) {
        throw new AgentGitError(
          `File '${normalizedPath}' is currently locked/claimed by agent: ${claimer}`,
          'FILE_LOCKED'
        );
      }
    }
  }

  /**
   * Claim a file for exclusive swarm editing. Prevents other agents from modifying it.
   */
  async claimFile(branch: string, path: string, author: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const encodedPath = encodeURIComponent(normalizedPath);
    const repoPath = this.repo.getBasePath();

    await this.db.runTransaction(async () => {
      const existing = await this.db.selectOne('claims', [
        { column: 'repoPath', value: repoPath },
        { column: 'branch', value: branch },
        { column: 'path', value: encodedPath },
      ]);

      if (existing) {
        const expiresAt = existing.expiresAt;
        if (existing.author !== author && expiresAt && expiresAt > Date.now()) {
          throw new AgentGitError(
            `Cannot claim '${normalizedPath}', already claimed by ${existing.author}`,
            'FILE_LOCKED'
          );
        }
      }

      await this.db.push({
        type: 'upsert',
        table: 'claims' as any,
        where: [
          { column: 'repoPath', value: repoPath },
          { column: 'branch', value: branch },
          { column: 'path', value: encodedPath },
        ],
        values: {
          repoPath,
          branch,
          path: encodedPath,
          author,
          timestamp: Date.now(),
          expiresAt: Date.now() + FileTree.CLAIM_TTL_MS,
        },
        layer: 'domain',
      });
    });
  }

  /**
   * Release a previously claimed file.
   */
  async releaseFile(branch: string, path: string, author: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const encodedPath = encodeURIComponent(normalizedPath);
    const repoPath = this.repo.getBasePath();

    await this.db.runTransaction(async () => {
      const existing = await this.db.selectOne('claims', [
        { column: 'repoPath', value: repoPath },
        { column: 'branch', value: branch },
        { column: 'path', value: encodedPath },
      ]);
      if (existing) {
        if (existing.author !== author) {
          throw new AgentGitError(
            `Cannot release '${normalizedPath}', it is owned by ${existing.author}`,
            'FILE_LOCKED'
          );
        }
        await this.db.push({
          type: 'delete',
          table: 'claims' as any,
          where: [
            { column: 'repoPath', value: repoPath },
            { column: 'branch', value: branch },
            { column: 'path', value: encodedPath },
          ],
          layer: 'domain',
        });
      }
    });
  }

  /**
   * Internal helper to load and cache ignore rules per branch head.
   */
  private async getIgnoreRules(branch: string, headId?: string | null): Promise<AgentIgnore> {
    if (!headId) return new AgentIgnore('');

    const cached = this.ignoreCache.get(branch);
    if (cached && cached.head === headId) {
      return cached.rules;
    }

    const rules = await AgentIgnore.load(this, branch);
    this.ignoreCache.set(branch, { rules, head: headId });
    return rules;
  }
}
