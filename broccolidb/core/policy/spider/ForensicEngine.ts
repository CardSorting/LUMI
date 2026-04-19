import { Project, SyntaxKind } from 'ts-morph';
import { Logger } from '../../../shared/services/Logger.js';

/**
 * ForensicEngine: Implements deep-symbol verification.
 * Distinguishes between 'legitimate structural moves' and 'abandoned exports'.
 */
export class ForensicEngine {
  constructor(private project: Project) {}

  /**
   * Performs forensic analysis of a file's exports.
   * Identifies symbols as Concrete (Class/Method) or Abstract (Interface/Type).
   */
  public analyzeExports(targetPath: string): { concrete: string[], abstract: string[] } {
    const results = { concrete: [] as string[], abstract: [] as string[] };
    try {
        const sourceFile = this.project.getSourceFile(targetPath) || 
                           this.project.addSourceFileAtPath(targetPath);
        if (!sourceFile) return results;

        sourceFile.getClasses().filter(c => c.isExported()).forEach(c => results.concrete.push(c.getName()!));
        sourceFile.getFunctions().filter(f => f.isExported()).forEach(f => results.concrete.push(f.getName()!));
        sourceFile.getVariableStatements().filter(v => v.isExported()).forEach(v => {
            v.getDeclarations().forEach(d => results.concrete.push(d.getName()));
        });
        sourceFile.getInterfaces().filter(i => i.isExported()).forEach(i => results.abstract.push(i.getName()!));
        sourceFile.getTypeAliases().filter(t => t.isExported()).forEach(t => results.abstract.push(t.getName()!));

        return results;
    } catch {
        return results;
    }
  }

  public verifyExport(targetPath: string, symbolName: string): boolean {
    try {
      const sourceFile = this.project.getSourceFile(targetPath) || 
                         this.project.addSourceFileAtPath(targetPath);
      
      if (!sourceFile) return false;

      // Check for named exports
      const hasExport = sourceFile.getExportSymbols().some(s => s.getName() === symbolName);
      if (hasExport) return true;

      // Fallback: Check for 'export default' if the symbol name matches the file or is 'default'
      if (symbolName === 'default') {
          return sourceFile.getDescendantsOfKind(SyntaxKind.ExportAssignment).length > 0;
      }

      return false;
    } catch (err) {
      Logger.warn(`[ForensicEngine] Symbol verification failed for ${symbolName} in ${targetPath}: ${err}`);
      return false;
    }
  }
}
