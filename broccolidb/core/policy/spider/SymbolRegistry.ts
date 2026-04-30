import type { SpiderNode } from './types.js';

export interface SymbolProvider {
    symbolName: string;
    filePath: string;
    type: 'CLASS' | 'FUNCTION' | 'INTERFACE' | 'TYPE' | 'CONST';
    footprint: string;
}

/**
 * SymbolRegistry: A deterministic index of all exported symbols in the project.
 * Replaces 'Ghost Mapping' with strict, traceable accounting.
 */
export class SymbolRegistry {
  private providers: Map<string, Set<string>> = new Map(); // symbolName -> [filePaths]
  private exportsByFile: Map<string, SymbolProvider[]> = new Map(); // filePath -> [SymbolProviders]
  private transitions: Map<string, { from: string, to: string, timestamp: number }> = new Map(); // symbolName -> moveData

  public register(provider: SymbolProvider) {
    const existing = this.providers.get(provider.symbolName) || new Set();
    existing.add(provider.filePath);
    this.providers.set(provider.symbolName, existing);

    const fileExports = this.exportsByFile.get(provider.filePath) || [];
    if (!fileExports.some(p => p.symbolName === provider.symbolName)) {
        fileExports.push(provider);
        this.exportsByFile.set(provider.filePath, fileExports);
    }

    if (existing.size > 1) {
        // console.warn(`[SymbolRegistry] ⚠️  Ambiguous symbol detected: '${provider.symbolName}' is provided by ${existing.size} files.`);
    }
  }

  public unregisterFile(filePath: string) {
    const exports = this.exportsByFile.get(filePath);
    if (exports) {
        for (const exp of exports) {
            const providers = this.providers.get(exp.symbolName);
            if (providers) {
                providers.delete(filePath);
                if (providers.size === 0) this.providers.delete(exp.symbolName);
            }
        }
    }
    this.exportsByFile.delete(filePath);
  }

  public findProviders(symbolName: string): string[] {
      return Array.from(this.providers.get(symbolName) || []);
  }

  public findProviderByFootprint(footprint: string): SymbolProvider | null {
      for (const providers of this.exportsByFile.values()) {
          const match = providers.find(p => p.footprint === footprint);
          if (match) return match;
      }
      return null;
  }

  /**
   * Records a transitional move to assist in distinguishing renames from removals.
   */
  public recordTransition(symbolName: string, from: string, to: string) {
      this.transitions.set(symbolName, { from, to, timestamp: Date.now() });
      // TTL: Expire transitions after 5 seconds to keep the context localized to the current task
      setTimeout(() => this.transitions.delete(symbolName), 5000);
  }

  public getTransition(symbolName: string) {
      return this.transitions.get(symbolName);
  }

  public getConflicts(): Map<string, string[]> {
      const conflicts = new Map<string, string[]>();
      for (const [symbol, providers] of this.providers.entries()) {
          if (providers.size > 1) {
              conflicts.set(symbol, Array.from(providers));
          }
      }
      return conflicts;
  }

  public getExports(filePath: string): SymbolProvider[] {
      return this.exportsByFile.get(filePath) || [];
  }

  public clear() {
      this.providers.clear();
      this.exportsByFile.clear();
  }

  public serialize(): string {
    const exports = Array.from(this.exportsByFile.entries());
    return JSON.stringify(exports);
  }

  public deserialize(data: string) {
    try {
      const exports = JSON.parse(data);
      this.clear();
      for (const [filePath, providers] of exports) {
          this.exportsByFile.set(filePath, providers);
          for (const p of providers) {
              const existing = this.providers.get(p.symbolName) || new Set();
              existing.add(filePath);
              this.providers.set(p.symbolName, existing);
          }
      }
    } catch (e) {
      // console.error('[SymbolRegistry] Deserialization failed:', e);
    }
  }
}
