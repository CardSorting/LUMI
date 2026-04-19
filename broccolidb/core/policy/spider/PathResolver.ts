import * as path from 'node:path';
import type { SpiderNode } from '../SpiderEngine.js';

/**
 * PathResolver: Handles high-fidelity import resolution across 
 * diversified web extensions and aliases.
 */
export class PathResolver {
  private cache: Map<string, string | null> = new Map();
  private extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];

  constructor(private cwd: string, private nodes: Map<string, SpiderNode>) {}

  public resolve(sourcePath: string, specifier: string): string | null {
    const cacheKey = `${sourcePath}:${specifier}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null;

    let result: string | null = null;
    
    if (specifier.startsWith('.')) {
      result = this.resolveRelative(sourcePath, specifier);
    } else if (specifier.startsWith('@/')) {
      result = this.resolveAlias(specifier);
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  private resolveRelative(sourcePath: string, specifier: string): string | null {
    const abs = path.resolve(this.cwd, path.dirname(sourcePath), specifier);
    const rel = path.relative(this.cwd, abs).replace(/\\/g, '/');
    
    return this.findWithExtensions(rel) || this.findIndex(rel);
  }

  private resolveAlias(specifier: string): string | null {
    const rel = specifier.replace('@/', 'src/').replace(/\\/g, '/');
    return this.findWithExtensions(rel) || this.findIndex(rel);
  }

  private findWithExtensions(basePath: string): string | null {
    for (const ext of this.extensions) {
      const testPath = ext ? `${basePath}${ext}` : basePath;
      if (this.nodes.has(testPath)) return testPath;
    }
    return null;
  }

  private findIndex(basePath: string): string | null {
    for (const ext of this.extensions) {
      if (!ext) continue;
      const indexFile = path.join(basePath, `index${ext}`).replace(/\\/g, '/');
      if (this.nodes.has(indexFile)) return indexFile;
    }
    return null;
  }

  public clearCache() {
    this.cache.clear();
  }
}
