import { Logger } from '../../shared/services/Logger.js';
import { SpiderEngine, type SpiderViolation, type SpiderEntropyReport } from '../policy/SpiderEngine.js';
import { Repository } from '../repository.js';
import { StructuralDiscoveryService } from './StructuralDiscoveryService.js';
import { TaskMutex } from '../mutex.js';
import type { ServiceContext } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class SpiderService {
  private engine: SpiderEngine;
  private discovery: StructuralDiscoveryService;
  private bootstrapped = false;

  constructor(private ctx: ServiceContext) {
    this.engine = new SpiderEngine(ctx.workspace.workspacePath);
    this.discovery = new StructuralDiscoveryService(() => this.engine);
  }

  /**
   * Performs an LSP-enhanced structural audit.
   * Resolves physical definitions of all exported symbols.
   */
  async auditWithLsp(files: { filePath: string; content: string }[]): Promise<{
    entropy: number;
    violations: SpiderViolation[];
    mermaid: string;
  }> {
    Logger.info(`[SpiderService] 🕵️ Performing LSP-enhanced audit on ${files.length} files...`);
    
    this.engine.buildGraph(files);

    // Ensure server is started once for the entire batch
    await this.ctx.lsp.ensureServer('typescript');

    for (const file of files) {
        const isTs = file.filePath.endsWith('.ts') || file.filePath.endsWith('.tsx');
        const isJs = file.filePath.endsWith('.js') || file.filePath.endsWith('.jsx') || file.filePath.endsWith('.mjs');
        if (!isTs && !isJs) continue;
        
        // Real Scanner: Identify exported symbols using regex
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/export (class|function|interface|const|enum) (\w+)/);
            if (match) {
                const symbolName = match[2];
                const charIndex = line.indexOf(symbolName);
                
                try {
                    const definitions = await this.ctx.lsp.getDefinitions('typescript', file.filePath, i, charIndex);
                    if (definitions && definitions.length > 0) {
                        Logger.info(`[SpiderService] 🧠 Resolved symbol '${symbolName}' via LSP: ${JSON.stringify(definitions[0].uri)}`);
                    }
                } catch (err) {
                    Logger.warn(`[SpiderService] ⚠️ Failed to resolve symbol '${symbolName}': ${err}`);
                }
            }
        }
    }

    for (const file of files) {
        this.engine.updateNode(file.filePath, file.content);
    }

    // Proactive Memory Management: Recycle project after batch update
    this.engine.recycleProject();

    return this.auditStructure();
  }

  async auditStructure(files?: { filePath: string; content: string }[]): Promise<{
    entropy: number;
    violations: SpiderViolation[];
    mermaid: string;
  }> {
    try {
      if (!this.bootstrapped && !files) {
        await this.bootstrapGraph();
      }
      this.discovery.clearCache();
      if (files) {
        for (const file of files) {
            this.engine.updateNode(file.filePath, file.content);
        }
      }
      const entropyReport = this.engine.computeEntropy();
      const entropy = entropyReport.score;
      const violations = this.engine.getViolations();
      const mermaid = this.engine.toMermaid();

      this.engine.recycleProject();

      return { entropy, violations, mermaid };
    } catch (e) {
      Logger.error('[SpiderService] Audit failed:', e);
      return { entropy: 1.0, violations: [], mermaid: '' };
    }
  }

  /**
   * Compares current structural state against the latest baseline snapshot.
   * Returns the delta (positive means entropy increased/worsened).
   */
  async getEntropyDelta(): Promise<number> {
    const latest = await this.engine.getLatestSnapshot();
    if (!latest) return 0;
    return this.engine.getEntropy().score - latest.entropyScore;
  }

  /**
   * Incrementally updates the structural graph with a set of changes.
   * Returns a list of symbolic deficiencies (breakages) caused by these changes.
   * Serialized via mutationLock to prevent concurrent corruption.
   */
  async applyChanges(changes: { filePath: string; content?: string }[]): Promise<{ 
      deficiencies: { 
          depId: string, 
          symbols: string[], 
          displacements: { symbol: string, newPath: string }[],
          directives: import('./types.js').RepairDirective[],
          line: number, 
          character: number 
      }[],
      diagnostics: { message: string, line?: number }[]
  }> {
    const lockKey = `spider-mutation:${this.ctx.workspace.workspacePath}`;
    return await TaskMutex.runExclusive(lockKey, async () => {
      this.discovery.clearCache();
      const defReport: { 
          depId: string, 
          symbols: string[], 
          displacements: { symbol: string, newPath: string }[],
          directives: import('./types.js').RepairDirective[],
          line: number, 
          character: number 
      }[] = [];
      const diagReport: { message: string, line?: number }[] = [];
      
      for (const change of changes) {
        if (change.content !== undefined) {
          this.engine.updateNode(change.filePath, change.content);
          diagReport.push(...this.engine.getDiagnostics(change.filePath));
        } else {
          this.engine.removeNode(change.filePath);
        }
      }

      // 2. Resolve the graph connectivity
      this.engine.computeReachability();

      // 3. Collect breakages for all modified files
      for (const change of changes) {
          const fileReport = this.discovery.getDeficiencyReport(change.filePath);
          defReport.push(...fileReport);
      }

      return { deficiencies: defReport, diagnostics: diagReport };
    });
  }

  /**
   * Bootstraps the structural graph from the latest repository head.
   * Now uses a persistent cache to speed up subsequent bootstraps.
   */
  async bootstrapGraph(): Promise<void> {
    if (this.bootstrapped) return;
    const startTime = Date.now();
    try {
      const db = this.ctx.workspace.getDb();
      let repo: Repository;
      try {
          repo = await this.ctx.workspace.getRepo(this.ctx.workspace.workspaceId);
      } catch {
          // Fallback for legacy or custom path structures
          repo = new Repository(db, this.ctx.workspace.workspacePath);
      }
      
      const repoPath = repo.getBasePath();

      // 0. Branch Discovery: Align with the active substrate layer
      const repoDoc = await db.selectOne('repositories', [{ column: 'repoPath', value: repoPath }]);
      const branches = await db.selectWhere('branches', [{ column: 'repoPath', value: repoPath }]);
      
      // Prioritize the branch with the most recent activity if not specified
      let branchName = repoDoc?.defaultBranch || 'main';
      if (branches.length > 0) {
          const sortedBranches = branches.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          branchName = sortedBranches[0].name;
      }
      
      Logger.info(`[SpiderService] 🕸️  Bootstrapping graph from branch '${branchName}'...`);

      // 1. Try to load from persistent cache
      const cache = await db.selectOne('knowledge', [
        { column: 'userId', value: this.ctx.userId },
        { column: 'type', value: 'structural_snapshot' },
      ]);

      let lastCommit: string | null = null;
      if (cache) {
        const metadata = JSON.parse(cache.metadata || '{}');
        if (metadata.isBootstrapCache) {
          this.engine.deserialize(Buffer.from(cache.content as string, 'utf8'));
          lastCommit = metadata.commitHash;
          Logger.info(
            `[SpiderService] Loaded bootstrap cache from commit: ${lastCommit?.substring(0, 7)}`
          );
        }
      }

      // 2. Determine changed files
      const currentBranch = await db.selectOne('branches', [
        { column: 'repoPath', value: repoPath },
        { column: 'name', value: branchName },
      ]);
      const currentHead = currentBranch?.head;

      if (lastCommit && currentHead && lastCommit === currentHead) {
        Logger.info(
          `[SpiderService] Graph is already up to date at commit: ${currentHead.substring(0, 7)}`
        );
        this.bootstrapped = true;
        return;
      }

      if (lastCommit && currentHead && lastCommit !== currentHead) {
        Logger.info(`[SpiderService] 🔄 Incremental update detected: ${lastCommit.substring(0, 7)} -> ${currentHead.substring(0, 7)}`);
        
        try {
            const oldNode = await repo.getNode(lastCommit);
            const newNode = await repo.getNode(currentHead);
            const oldTree = await repo.resolveTree(oldNode);
            const newTree = await repo.resolveTree(newNode);

            const changedFiles: string[] = [];
            for (const [path, hash] of Object.entries(newTree)) {
                if (oldTree[path] !== hash) {
                    changedFiles.push(path);
                }
            }
            for (const path of Object.keys(oldTree)) {
                if (!newTree[path]) {
                    this.engine.removeNode(path);
                }
            }

            if (changedFiles.length > 0) {
                Logger.info(`[SpiderService] ⚙️  Processing ${changedFiles.length} changed files...`);
                for (let i = 0; i < changedFiles.length; i++) {
                    const filePath = changedFiles[i];
                    const content = await repo.files().readFile(branchName, filePath, { skipIgnore: true });
                    this.engine.updateNode(filePath, content.content);
                    
                    // Memory Management: Recycle every 50 files during incremental update
                    if (i > 0 && i % 50 === 0) {
                        this.engine.recycleProject();
                    }
                }
            }

            this.bootstrapped = true;
            await this.persistBootstrapCache(currentHead);
            Logger.info(`[SpiderService] ✅ Incremental update complete in ${Date.now() - startTime}ms.`);
            return;
        } catch (e) {
            Logger.warn(`[SpiderService] ⚠️ Incremental diff failed, falling back to full read: ${e}`);
        }
      }

      // 3. Fallback to (optimized) full read if cache is missing or invalid
      const filesData = await repo.files().listFiles(branchName);
      const auditFilesData = filesData.filter((f) => 
        f.path.endsWith('.ts') || f.path.endsWith('.tsx') ||
        f.path.endsWith('.js') || f.path.endsWith('.jsx') || f.path.endsWith('.mjs')
      );

      // Parallel read with concurrency limit (e.g. 10 files at a time)
      const auditFiles: { filePath: string; content: string }[] = [];
      const batchSize = 10;
      for (let i = 0; i < auditFilesData.length; i += batchSize) {
        const batch = auditFilesData.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (f) => {
            try {
              const content = await repo.files().readFile(branchName, f.path, { skipIgnore: true });
              return { filePath: f.path, content: content.content };
            } catch {
              return null;
            }
          })
        );
        auditFiles.push(...(results.filter(Boolean) as { filePath: string; content: string }[]));
        
        // Memory Management: Recycle project after batch reading to clear AST pressure
        const memory = process.memoryUsage().rss / 1024 / 1024;
        if (memory > 1500) {
            Logger.warn(`[SpiderService] 🚨 RSS Watchdog triggered (${memory.toFixed(0)}MB). Hard-resetting Project...`);
            this.engine.recycleProject();
        } else if (i > 0 && i % 100 === 0) {
            this.engine.recycleProject();
        }
      }

      this.discovery.clearCache();
      this.engine.buildGraph(auditFiles);

      // Populate Vitality (Churn) data from Repository
      for (const node of this.engine.nodes.values()) {
          node.vitality = await repo.getFileChurn(node.path);
      }

      this.bootstrapped = true;

      // 4. Persist the new cache
      if (currentHead) {
        await this.persistBootstrapCache(currentHead);
      }

      const duration = Date.now() - startTime;
      Logger.info(
        `[SpiderService] Graph bootstrapped with ${auditFiles.length} files in ${duration}ms.`
      );
      
      // Level 9 Integrity Guard: Ghost Node Verification
      await this.verifyGraphIntegrity(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`[SpiderService] Bootstrap failed: ${msg}`);
      this.bootstrapped = true; // Fail-closed to prevent hot loops
    }
  }

  /**
   * Persists the current structural graph as a bootstrap cache.
   */
  private async persistBootstrapCache(commitHash: string): Promise<void> {
    const db = this.ctx.workspace.getDb();
    const serialized = this.engine.serialize();
    const cacheId = `spider-bootstrap-${this.ctx.workspace.workspacePath}`;

    await db.push({
      type: 'upsert',
      table: 'knowledge',
      where: [{ column: 'id', value: cacheId }],
      values: {
        id: cacheId,
        userId: this.ctx.userId,
        type: 'structural_snapshot',
        content: serialized,
        tags: JSON.stringify(['spider', 'bootstrap', 'cache']),
        confidence: 1.0,
        hubScore: 0,
        metadata: JSON.stringify({
          isBootstrapCache: true,
          commitHash,
          workspacePath: this.ctx.workspace.workspacePath,
        }),
        createdAt: Date.now(),
      },
      layer: 'infrastructure',
    });
  }

  /**
   * Returns the internal engine instance for advanced analysis.
   */
  getEngine(): SpiderEngine {
    return this.engine;
  }

  /**
   * Returns the discovery service instance.
   */
  getDiscovery(): StructuralDiscoveryService {
    return this.discovery;
  }

  /**
   * Persists structural health as knowledge in the graph.
   */
  async persistStructuralKnowledge(
    entropy: number,
    mermaid: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const kbId = `spider-snapshot-${Date.now()}`;
    await this.ctx.push({
      type: 'insert',
      table: 'knowledge',
      values: {
        id: kbId,
        userId: this.ctx.userId,
        type: 'structural_snapshot',
        content: mermaid,
        tags: JSON.stringify(['spider', 'architecture', 'visualization']),
        confidence: Math.max(0, 1.0 - entropy),
        hubScore: 0,
        metadata: JSON.stringify({ ...metadata, entropy }),
        createdAt: Date.now(),
      },
      layer: 'domain',
    });
    return kbId;
  }

  /**
   * Level 9 integrity guard.
   * Verifies that every node in the graph exists on disk.
   * Orphaned entries are pruned to prevent "Structural Drift".
   */
  async verifyGraphIntegrity(silent: boolean = false): Promise<{ pruned: number }> {
      const startTime = Date.now();
      let prunedCount = 0;
      const nodes = Array.from(this.engine.nodes.values());
      
      for (const node of nodes) {
          const fullPath = path.resolve(this.ctx.workspace.workspacePath, node.path);
          if (!fs.existsSync(fullPath)) {
              this.engine.removeNode(node.path);
              prunedCount++;
          }
      }

      if (prunedCount > 0) {
          const db = this.ctx.workspace.getDb() as any;
          if (db.reportIntegrityIssue) {
              db.reportIntegrityIssue('orphanedNode', prunedCount);
          }
          Logger.info(`[SpiderService] ✅ Integrity check complete. Pruned ${prunedCount} ghost nodes in ${Date.now() - startTime}ms.`);
      }
      
      return { pruned: prunedCount };
  }

  /**
   * Generates a "Sovereign Study Pack" for a file.
   * Identifies the core structural context an agent needs to master before editing.
   */
  public getStudyPack(filePath: string): { 
      path: string, 
      studyItems: { path: string, reason: string }[] 
  } {
      const engine = this.engine;
      const normalizedPath = engine.normalizePath(filePath);
      const node = engine.nodes.get(normalizedPath);
      
      const studyItems: { path: string, reason: string }[] = [];
      const discovery = this.getDiscovery();
      const registry = engine.getRegistry();

      if (node) {
          // 1. Direct dependencies
          for (const resolved of Array.from(node.resolvedImports.values())) {
              studyItems.push({ path: resolved as string, reason: 'Direct Dependency' });
          }

          // 2. Critical dependents (from Blast Radius)
          const radius = discovery.getBlastRadius(filePath);
          for (const cr of radius.criticalDependents.slice(0, 5)) {
              studyItems.push({ path: cr, reason: 'Critical Dependent' });
          }

          // 3. Ambiguous Symbols used/provided
          const exports = registry.getExports(normalizedPath);
          const conflicts = registry.getConflicts();
          for (const exp of exports) {
              if (conflicts.has(exp.symbolName)) {
                  const providers = conflicts.get(exp.symbolName)!.filter(p => p !== normalizedPath);
                  for (const p of providers) {
                      studyItems.push({ path: p, reason: `Ambiguity Provider for '${exp.symbolName}'` });
                  }
              }
          }
      }

      // De-duplicate and prioritize
      const seen = new Set<string>();
      const pack = studyItems.filter(item => {
          if (seen.has(item.path) || item.path === normalizedPath) return false;
          seen.add(item.path);
          return true;
      });

      return { path: normalizedPath, studyItems: pack };
  }
}
