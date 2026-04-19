import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CallExpression, type ImportDeclaration, Project, SyntaxKind } from 'ts-morph';
import { getLayer, type Layer } from '../../utils/joy-zoning.js';
import { MetricsEngine } from './spider/MetricsEngine.js';
import { PathResolver } from './spider/PathResolver.js';
import { PersistenceManager } from './spider/PersistenceManager.js';
import { ForensicEngine } from './spider/ForensicEngine.js';
import { SymbolRegistry } from './spider/SymbolRegistry.js';
import { SpiderRefactorer, type RefactoringSuggestion } from './SpiderRefactorer.js';

export interface SpiderNode {
  id: string;
  path: string;
  layer: Layer;
  imports: Set<string>;
  resolvedImports: Set<string>;
  depth: number;
  orphaned: boolean;
  vitality: number;
}

export interface SpiderSnapshot {
  timestamp: string;
  entropyScore: number;
  nodes: SpiderNode[];
  components: {
    depthScore: number;
    namingScore: number;
    orphanScore: number;
    couplingScore: number;
  };
}

export interface SpiderEntropyReport {
  score: number;
  components: {
    depthScore: number;
    namingScore: number;
    orphanScore: number;
    couplingScore: number;
  };
}

export interface SpiderViolation {
  id: string;
  severity: 'ERROR' | 'WARN' | 'INFO';
  message: string;
  path: string;
  cycle?: string[]; // Path of the detected cycle
}

/**
 * SpiderEngine (V15 Modular Facade): Orchestrates path resolution, 
 * forensic symbol auditing, metrics calculation, and binary persistence.
 */
export class SpiderEngine {
  public nodes: Map<string, SpiderNode> = new Map();
  public version = 0;
  
  private project: Project;
  private metrics: MetricsEngine;
  private resolver: PathResolver;
  private persistence: PersistenceManager;
  private forensic: ForensicEngine;
  private symbols: SymbolRegistry;
  private snapshotDir: string;

  constructor(public cwd: string) {
    this.snapshotDir = path.join(cwd, '.spider', 'snapshots');
    this.project = this.createProject();
    
    // Core Engine Injection
    this.metrics = new MetricsEngine();
    this.resolver = new PathResolver(cwd, this.nodes);
    this.persistence = new PersistenceManager(cwd);
    this.forensic = new ForensicEngine(this.project);
    this.symbols = new SymbolRegistry();
  }

  private createProject() {
    return new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        resolveJsonModule: true,
        moduleResolution: 1,
      },
    });
  }

  public recycleProject() {
    this.project = this.createProject();
    this.resolver.clearCache();
    // Re-inject project to forensic engine
    this.forensic = new ForensicEngine(this.project);
  }

  public normalizePath(filePath: string): string {
    const absolutePath = path.resolve(this.cwd, filePath);
    const relativePath = path.relative(this.cwd, absolutePath);
    return relativePath.replace(/\\/g, '/');
  }

  public updateNode(filePath: string, content: string) {
    const absolutePath = path.resolve(this.cwd, filePath);
    const normalizedPath = this.normalizePath(filePath);
    const layer = getLayer(absolutePath);

    const sourceFile = this.project.createSourceFile(absolutePath, content, { overwrite: true });
    const imports: Set<string> = new Set();

    sourceFile.forEachDescendant((node) => {
      if (node.isKind(SyntaxKind.ImportDeclaration)) {
        const importDeclaration = node as ImportDeclaration;
        imports.add(importDeclaration.getModuleSpecifier().getLiteralValue());
      } else if (node.isKind(SyntaxKind.CallExpression)) {
        const callExpression = node as CallExpression;
        if (callExpression.getExpression().getText() === 'import' && callExpression.getArguments().length > 0) {
          const arg = callExpression.getArguments()[0];
          if (arg?.isKind(SyntaxKind.StringLiteral)) {
            imports.add(arg.getLiteralValue());
          }
        }
      }
    });

    const oldNode = this.nodes.get(normalizedPath);
    if (oldNode) this.symbols.unregisterFile(normalizedPath);

    // Populate Symbol Registry
    const forensicData = this.forensic.analyzeExports(absolutePath);
    for (const name of forensicData.concrete) this.symbols.register({ symbolName: name, filePath: normalizedPath, type: 'CLASS' });
    for (const name of forensicData.abstract) this.symbols.register({ symbolName: name, filePath: normalizedPath, type: 'INTERFACE' });

    let importsChanged = !oldNode || oldNode.imports.size !== imports.size;
    if (!importsChanged && oldNode) {
        for (const imp of imports) {
            if (!oldNode.imports.has(imp)) {
                importsChanged = true;
                break;
            }
        }
    }

    this.nodes.set(normalizedPath, {
      id: normalizedPath,
      path: normalizedPath,
      layer,
      imports,
      resolvedImports: new Set(),
      depth: normalizedPath.split('/').length - 1,
      orphaned: false,
      vitality: oldNode?.vitality || 0,
    });

    this.project.removeSourceFile(sourceFile);

    if (importsChanged) {
      this.resolver.clearCache();
      this.computeReachability();
    }
  }

  public removeNode(filePath: string) {
    const absolutePath = path.resolve(this.cwd, filePath);
    const normalizedPath = this.normalizePath(filePath);

    this.nodes.delete(normalizedPath);
    this.symbols.unregisterFile(normalizedPath);
    const sf = this.project.getSourceFile(absolutePath);
    if (sf) this.project.removeSourceFile(sf);
    this.resolver.clearCache();
    this.computeReachability();
    this.version++;
  }

  public clearNodes() {
    this.nodes.clear();
    this.symbols.clear();
    for (const sourceFile of this.project.getSourceFiles()) {
      this.project.removeSourceFile(sourceFile);
    }
    this.resolver.clearCache();
    this.version++;
  }

  public buildGraph(files: { filePath: string; content: string }[]): void {
    this.clearNodes();
    for (const file of files) {
      this.updateNode(file.filePath, file.content);
    }
  }

  public computeReachability() {
    const roots = Array.from(this.nodes.values()).filter(
      (n) => n.layer === 'ui' || n.layer === 'core' || n.path.includes('main.') || n.path.includes('index.')
    );

    const reachable = new Set<string>();
    const queue = roots.map((r) => r.id);
    for (const id of queue) reachable.add(id);

    let head = 0;
    while (head < queue.length) {
      const currentId = queue[head++];
      if (!currentId) continue;
      const node = this.nodes.get(currentId);
      if (node) {
        node.resolvedImports.clear();
        for (const imp of node.imports) {
          const resolved = this.resolver.resolve(node.path, imp);
          if (resolved && this.nodes.has(resolved)) {
            node.resolvedImports.add(resolved);
            if (!reachable.has(resolved)) {
                reachable.add(resolved);
                queue.push(resolved);
            }
          }
        }
      }
    }

    for (const node of this.nodes.values()) {
      node.orphaned = !reachable.has(node.id);
    }
    this.version++;
  }

  public computeEntropy(): SpiderEntropyReport {
    return this.metrics.computeEntropy(this.nodes);
  }

  public getViolations(): SpiderViolation[] {
    return this.metrics.getViolations(this.nodes);
  }

  public toMermaid(): string {
    let mermaid = 'graph TD\n';
    for (const node of this.nodes.values()) {
      for (const resolved of node.resolvedImports) {
          mermaid += `  ${path.basename(node.id).replace(/\./g, '_')} --> ${path.basename(resolved).replace(/\./g, '_')}\n`;
      }
    }
    return mermaid;
  }

  async takeSnapshot(): Promise<string> {
    const report = this.computeEntropy();
    const snapshot: SpiderSnapshot = {
      timestamp: new Date().toISOString(),
      entropyScore: report.score,
      nodes: Array.from(this.nodes.values()).map(n => ({...n, imports: Array.from(n.imports), resolvedImports: Array.from(n.resolvedImports)} as any)),
      components: report.components,
    };
    if (!fs.existsSync(this.snapshotDir)) fs.mkdirSync(this.snapshotDir, { recursive: true });
    const filePath = path.join(this.snapshotDir, `${Date.now()}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2));
    return filePath;
  }

  compareWith(snapshot: SpiderSnapshot): number {
    return this.computeEntropy().score - snapshot.entropyScore;
  }

  async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
    if (!fs.existsSync(this.snapshotDir)) return null;
    const files = await fs.promises.readdir(this.snapshotDir);
    if (files.length === 0) return null;
    const latest = files.sort().reverse()[0];
    if (!latest) return null;
    const content = await fs.promises.readFile(path.join(this.snapshotDir, latest), 'utf-8');
    const snapshot = JSON.parse(content);
    return {
        ...snapshot,
        nodes: snapshot.nodes.map((n: any) => ({...n, imports: new Set(n.imports), resolvedImports: new Set(n.resolvedImports)}))
    };
  }

  public async save() {
      await this.persistence.save(this.nodes);
  }

  public async load() {
      const loaded = await this.persistence.load();
      if (loaded) {
          this.nodes = loaded;
          this.version++;
          this.resolver = new PathResolver(this.cwd, this.nodes);
      }
  }

  /**
   * Returns the internal refactorer instance.
   */
  public getRefactorer(): SpiderRefactorer {
    return new SpiderRefactorer(this);
  }

  public getRegistry(): SymbolRegistry {
      return this.symbols;
  }

  public serialize(): string {
    return JSON.stringify(Array.from(this.nodes.entries()).map(([k, v]) => [k, { ...v, imports: Array.from(v.imports), resolvedImports: Array.from(v.resolvedImports) }]));
  }

  public deserialize(data: string) {
    try {
      const entries = JSON.parse(data);
      this.nodes = new Map(entries.map(([k, v]: [string, any]) => [k, { ...v, imports: new Set(v.imports), resolvedImports: new Set(v.resolvedImports) }]));
      this.version++;
      this.resolver = new PathResolver(this.cwd, this.nodes);
    } catch (e) {
      console.error('[SpiderEngine] Deserialization failed:', e);
    }
  }
}
