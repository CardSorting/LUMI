import * as crypto from 'node:crypto';
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

        // 1. Direct Declarations
        sourceFile.getClasses().filter(c => c.isExported()).forEach(c => results.concrete.push(c.getName()!));
        sourceFile.getFunctions().filter(f => f.isExported()).forEach(f => results.concrete.push(f.getName()!));
        sourceFile.getVariableStatements().filter(v => v.isExported()).forEach(v => {
            v.getDeclarations().forEach(d => results.concrete.push(d.getName()));
        });
        sourceFile.getInterfaces().filter(i => i.isExported()).forEach(i => results.abstract.push(i.getName()!));
        sourceFile.getTypeAliases().filter(t => t.isExported()).forEach(t => results.abstract.push(t.getName()!));

        // 2. Named Exports: export { a, b as c }
        sourceFile.getExportDeclarations().forEach(ed => {
            ed.getNamedExports().forEach(ne => {
                const name = ne.getName();
                results.concrete.push(name); // Treating named exports as concrete for registry purposes
            });
            
            // 3. Namespace Exports: export * as ns from './bar'
            const namespaceExport = ed.getNamespaceExport();
            if (namespaceExport) {
                results.concrete.push(namespaceExport.getName());
            }
        });

        // 4. Default Export
        const defaultExport = sourceFile.getDefaultExportSymbol();
        if (defaultExport) {
            results.concrete.push('default');
        }

        return results;
    } catch {
        return results;
    }
  }

  /**
   * Generates a semantic footprint of a symbol to track its identity across files.
   * Anchors on the logic/signature, ignoring formatting/comments.
   */
  public computeFootprint(targetPath: string, symbolName: string): string {
    try {
        const sourceFile = this.project.getSourceFile(targetPath);
        if (!sourceFile) return '';

        let targetNode: any = null;
        // Search across common export types
        targetNode = sourceFile.getClass(symbolName) || 
                     sourceFile.getFunction(symbolName) || 
                     sourceFile.getInterface(symbolName) || 
                     sourceFile.getTypeAlias(symbolName);

        if (!targetNode) {
            // Check variables
            const varDecl = sourceFile.getVariableDeclaration(symbolName);
            if (varDecl) targetNode = varDecl;
        }

        if (!targetNode) return '';

        // Semantic Cleaning: remove whitespace and comments for stable hashing
        const cleanContent = targetNode.getText(false).replace(/\s+/g, '').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        
        return crypto.createHash('sha256').update(cleanContent).digest('hex');
    } catch {
        return '';
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
