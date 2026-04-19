import type { SpiderNode } from '../SpiderEngine.js';

export interface SymbolProvider {
    symbolName: string;
    filePath: string;
    type: 'CLASS' | 'FUNCTION' | 'INTERFACE' | 'TYPE' | 'CONST';
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
    fileExports.push(provider);
    this.exportsByFile.set(provider.filePath, fileExports);
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

  public getExports(filePath: string): SymbolProvider[] {
      return this.exportsByFile.get(filePath) || [];
  }

  public clear() {
      this.providers.clear();
      this.exportsByFile.clear();
  }
}
