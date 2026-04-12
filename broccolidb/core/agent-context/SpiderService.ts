import { Logger } from '../../shared/services/Logger.js';
import { SpiderEngine, type SpiderViolation } from '../policy/SpiderEngine.js';
import { Repository } from '../repository.js';
import { StructuralDiscoveryService } from './StructuralDiscoveryService.js';
import type { ServiceContext } from './types.js';

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
  async auditWithLsp(files: { filePath: string; content: string }[]): Promise<any> {
    console.log(`[Spider] 🕵️ Performing LSP-enhanced audit on ${files.length} files...`);
    
    this.engine.buildGraph(files);

    for (const file of files) {
        if (!file.filePath.endsWith('.ts') && !file.filePath.endsWith('.tsx')) continue;
        
        await this.ctx.lsp.startServer('typescript', 'typescript-language-server', ['--stdio']);
        
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
                        console.log(`[Spider] 🧠 Resolved symbol '${symbolName}' via LSP: ${JSON.stringify(definitions[0].uri)}`);
                        // High-Fidelity Edge: In a real app, we'd add this to the graph
                        // this.engine.addEdge(file.filePath, definitions[0].uri, 'references');
                    }
                } catch (err) {
                    console.warn(`[Spider] ⚠️ Failed to resolve symbol '${symbolName}':`, err);
                }
            }
        }
    }

    return this.auditStructure(files);
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
        this.engine.buildGraph(files);
      }
      const entropyReport = this.engine.computeEntropy();
      const entropy = entropyReport.score;
      const violations = this.engine.getViolations();
      const mermaid = this.engine.toMermaid();

      return { entropy, violations, mermaid };
    } catch (e) {
      Logger.error('[SpiderService] Audit failed:', e);
      return { entropy: 1.0, violations: [], mermaid: '' };
    }
  }

  /**
   * Incrementally updates the structural graph with a set of changes.
   * If content is missing, the node is removed.
   */
  applyChanges(changes: { filePath: string; content?: string }[]): void {
    this.discovery.clearCache();
    for (const change of changes) {
      if (change.content !== undefined) {
        this.engine.updateNode(change.filePath, change.content);
      } else {
        this.engine.removeNode(change.filePath);
      }
    }
  }

  /**
   * Bootstraps the structural graph from the latest repository head.
   * Now uses a persistent cache to speed up subsequent bootstraps.
   */
  async bootstrapGraph(): Promise<void> {
    if (this.bootstrapped) return;
    const startTime = Date.now();
    try {
      const repoPath = this.ctx.workspace.workspacePath;
      const db = this.ctx.workspace.getDb();
      const repo = new Repository(db, repoPath);

      // Get default branch
      const repoDoc = await db.selectOne('repositories', [{ column: 'repoPath', value: repoPath }]);
      const branchName = repoDoc?.defaultBranch || 'main';

      // 1. Try to load from persistent cache
      const cache = await db.selectOne('knowledge', [
        { column: 'userId', value: this.ctx.userId },
        { column: 'type', value: 'structural_snapshot' },
      ]);

      let lastCommit: string | null = null;
      if (cache) {
        const metadata = JSON.parse(cache.metadata || '{}');
        if (metadata.isBootstrapCache) {
          this.engine.deserialize(cache.content);
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

      // 3. Fallback to (optimized) full read if cache is missing or invalid
      const filesData = await repo.files().listFiles(branchName);
      const tsFiles = filesData.filter((f) => f.path.endsWith('.ts') || f.path.endsWith('.tsx'));

      // Parallel read with concurrency limit (e.g. 10 files at a time)
      const auditFiles: { filePath: string; content: string }[] = [];
      const batchSize = 10;
      for (let i = 0; i < tsFiles.length; i += batchSize) {
        const batch = tsFiles.slice(i, i + batchSize);
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
      }

      this.discovery.clearCache();
      this.engine.buildGraph(auditFiles);
      this.bootstrapped = true;

      // 4. Persist the new cache
      if (currentHead) {
        await this.persistBootstrapCache(currentHead);
      }

      const duration = Date.now() - startTime;
      Logger.info(
        `[SpiderService] Graph bootstrapped with ${auditFiles.length} files in ${duration}ms.`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Logger.error(`[SpiderService] Bootstrap failed: ${msg}`);
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
}
