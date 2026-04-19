import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type CallExpression, type ImportDeclaration, Project, SyntaxKind } from 'ts-morph';
import { getLayer, type Layer } from '../../utils/joy-zoning.js';
import { MetricsEngine } from './spider/MetricsEngine.js';
import { PathResolver } from './spider/PathResolver.js';
import { PersistenceManager } from './spider/PersistenceManager.js';
import { ForensicEngine } from './spider/ForensicEngine.js';
import { SymbolRegistry } from './spider/SymbolRegistry.js';
import { SpiderRefactorer, type RefactoringSuggestion } from './SpiderRefactorer.js';

export interface SpiderImport {
    specifier: string;
    symbols: string[]; // Specific symbols consumed (e.g., ['Logger', 'SpiderNode'])
    line: number;
    character: number;
}

export interface SpiderNode {
  id: string;
  path: string;
  layer: Layer;
  imports: Set<SpiderImport>;
  resolvedImports: Map<string, string>; // specifier -> resolvedPath
  depth: number;
  orphaned: boolean;
  vitality: number;
  diskHash?: string; // Physical reality anchor
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
    const imports: Set<SpiderImport> = new Set();

    sourceFile.forEachDescendant((node) => {
      if (node.isKind(SyntaxKind.ImportDeclaration)) {
        const importDeclaration = node as ImportDeclaration;
        const symbols: string[] = [];
        
        // Extract Named Imports
        importDeclaration.getNamedImports().forEach(ni => symbols.push(ni.getName()));
        // Extract Default Import
        const defaultImport = importDeclaration.getDefaultImport();
        if (defaultImport) symbols.push(defaultImport.getText());
        // Extract Namespace Import
        const namespaceImport = importDeclaration.getNamespaceImport();
        if (namespaceImport) symbols.push(namespaceImport.getText());

        imports.add({
            specifier: importDeclaration.getModuleSpecifier().getLiteralValue(),
            symbols,
            line: importDeclaration.getStartLineNumber(),
            character: importDeclaration.getStart() - importDeclaration.getStartLinePos()
        });
      } else if (node.isKind(SyntaxKind.CallExpression)) {
        const callExpression = node as CallExpression;
        if (callExpression.getExpression().getText() === 'import' && callExpression.getArguments().length > 0) {
          const arg = callExpression.getArguments()[0];
          if (arg?.isKind(SyntaxKind.StringLiteral)) {
            imports.add({
                specifier: arg.getLiteralValue(),
                symbols: [], // Dynamic imports are harder to anchor statically without more depth
                line: callExpression.getStartLineNumber(),
                character: callExpression.getStart() - callExpression.getStartLinePos()
            });
          }
        }
      }
    });

    const oldNode = this.nodes.get(normalizedPath);
    if (oldNode) this.symbols.unregisterFile(normalizedPath);

    // Populate Symbol Registry with Footprints (Identity v2)
    const forensicData = this.forensic.analyzeExports(absolutePath);
    for (const name of forensicData.concrete) {
        const footprint = this.forensic.computeFootprint(absolutePath, name);
        this.symbols.register({ symbolName: name, filePath: normalizedPath, type: 'CLASS', footprint });
    }
    for (const name of forensicData.abstract) {
        const footprint = this.forensic.computeFootprint(absolutePath, name);
        this.symbols.register({ symbolName: name, filePath: normalizedPath, type: 'INTERFACE', footprint });
    }

    const diskHash = crypto.createHash('sha256').update(content).digest('hex');

    this.nodes.set(normalizedPath, {
      id: normalizedPath,
      path: normalizedPath,
      layer,
      imports,
      resolvedImports: new Map(),
      depth: normalizedPath.split('/').length - 1,
      orphaned: false,
      vitality: (oldNode?.vitality || 0) + 1,
      diskHash,
    });

    this.project.removeSourceFile(sourceFile);
    this.resolver.clearCache();
    this.computeReachability();
    this.version++;
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
          const resolved = this.resolver.resolve(node.path, imp.specifier);
          if (resolved && this.nodes.has(resolved)) {
            node.resolvedImports.set(imp.specifier, resolved);
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

  /**
   * Performs a targeted type-check on the modified file and its direct dependents.
   * Anchors on the 'Ultimate Reality' of the TypeScript compiler.
   */
  public getDiagnostics(filePath?: string) {
    if (!filePath) return [];
    
    const absolutePath = path.resolve(this.cwd, filePath);
    const sourceFile = this.project.getSourceFile(absolutePath);
    if (!sourceFile) return [];

    // Focus on the diagnostics of this file and its immediate structural blast radius
    const focalDiagnostics = sourceFile.getPreEmitDiagnostics();
    
    return focalDiagnostics.map(d => ({
        message: typeof d.getMessageText() === 'string' ? d.getMessageText() : (d.getMessageText() as any).getMessageText(),
        line: d.getLineNumber(),
        category: d.getCategory() // 1 = Error
    })).filter(d => d.category === 1);
  }

  public getViolations(): SpiderViolation[] {
    return this.metrics.getViolations(this.nodes);
  }

  public toMermaid(): string {
    let mermaid = 'graph TD\n';
    for (const node of this.nodes.values()) {
      for (const resolved of node.resolvedImports.values()) {
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
      nodes: Array.from(this.nodes.values()),
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
    return snapshot;
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

  public getRefactorer(): SpiderRefactorer {
    return new SpiderRefactorer(this);
  }

  public getRegistry(): SymbolRegistry {
      return this.symbols;
  }

  /**
   * High-Fidelity Sovereign Check: Verifies that the memory-resident graph
   * matches the actual bytes-on-disk. Detects 'Reality Drift'.
   */
  public async verifyDrift(): Promise<{ filePath: string, drifted: boolean }[]> {
      const results: { filePath: string, drifted: boolean }[] = [];
      for (const node of this.nodes.values()) {
          try {
              const absolutePath = path.resolve(this.cwd, node.path);
              const data = await fs.promises.readFile(absolutePath, 'utf8');
              const currentHash = crypto.createHash('sha256').update(data).digest('hex');
              
              if (currentHash !== node.diskHash) {
                  results.push({ filePath: node.path, drifted: true });
              }
          } catch {
              results.push({ filePath: node.path, drifted: true }); // Deleted or unreachable
          }
      }
      return results;
  }

  public serialize(): string {
    return JSON.stringify(Array.from(this.nodes.entries()).map(([k, v]) => [k, { ...v, imports: Array.from(v.imports), resolvedImports: Array.from(v.resolvedImports.entries()) }]));
  }

  public deserialize(data: string) {
    try {
      const entries = JSON.parse(data);
      this.nodes = new Map(entries.map(([k, v]: [string, any]) => [k, { ...v, imports: new Set(v.imports), resolvedImports: new Map(v.resolvedImports) }]));
      this.version++;
      this.resolver = new PathResolver(this.cwd, this.nodes);
    } catch (e) {
      console.error('[SpiderEngine] Deserialization failed:', e);
    }
  }
}
