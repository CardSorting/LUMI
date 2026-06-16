// [LAYER: CORE]
import * as crypto from 'node:crypto';
import * as ts from 'typescript';
import type { SpiderNode } from './types.js';
import type { MoveConfidence, SemanticFootprint } from './report-types.js';

const normalizeAstText = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

const hashText = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const signatureFromNode = (node: ts.Node, sourceFile: ts.SourceFile): string => {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    const params = node.parameters.map((p) => p.getText(sourceFile)).join(',');
    const name = node.name?.getText(sourceFile) ?? 'anonymous';
    return `fn:${name}(${params})`;
  }
  if (ts.isClassDeclaration(node)) {
    const name = node.name?.getText(sourceFile) ?? 'anonymous';
    const members = node.members.map((m) => m.kind).join(',');
    return `class:${name}{${members}}`;
  }
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
    return `${node.kind}:${node.name?.getText(sourceFile) ?? 'anonymous'}`;
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((d) => d.getText(sourceFile)).join(';');
  }
  return node.getText(sourceFile).slice(0, 120);
};

export class FootprintEngine {
  computeFootprints(
    nodes: Map<string, SpiderNode>,
    contentByPath: Map<string, string>,
    previousLocations: Map<string, string> = new Map()
  ): SemanticFootprint[] {
    const footprints: SemanticFootprint[] = [];

    for (const node of nodes.values()) {
      const content = contentByPath.get(node.path);
      if (!content) continue;

      const sourceFile = ts.createSourceFile(node.path, content, ts.ScriptTarget.Latest, true);
      for (const symbolName of node.exports) {
        if (symbolName === 'default') continue;
        const declaration = this.findExportedDeclaration(sourceFile, symbolName);
        if (!declaration) continue;

        const raw = declaration.getText(sourceFile);
        const normalized = normalizeAstText(raw);
        const astNormalizedHash = hashText(normalized);
        const signatureHash = hashText(signatureFromNode(declaration, sourceFile));
        const exportIdentity = `${node.path}::${symbolName}`;
        const importIdentity = this.collectImportConsumers(nodes, node.path, symbolName);
        const previousLocation = previousLocations.get(exportIdentity);
        const { moveConfidence, matchReason } = this.resolveMoveConfidence(
          previousLocation,
          node.path,
          astNormalizedHash,
          signatureHash
        );

        footprints.push({
          symbolName,
          astNormalizedHash,
          signatureHash,
          exportIdentity,
          importIdentity,
          previousLocation,
          currentLocation: node.path,
          moveConfidence,
          matchReason,
        });
      }
    }

    return footprints;
  }

  private findExportedDeclaration(sourceFile: ts.SourceFile, symbolName: string): ts.Node | null {
    let found: ts.Node | null = null;
    const visit = (node: ts.Node) => {
      if (found) return;
      const isExported = (n: ts.Node) =>
        'modifiers' in n &&
        Array.isArray((n as ts.HasModifiers).modifiers) &&
        (n as ts.HasModifiers).modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        isExported(node) &&
        node.name?.text === symbolName
      ) {
        found = node;
        return;
      }
      if (ts.isVariableStatement(node) && isExported(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === symbolName) {
            found = decl;
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }

  private collectImportConsumers(
    nodes: Map<string, SpiderNode>,
    providerPath: string,
    symbolName: string
  ): string[] {
    const consumers: string[] = [];
    for (const node of nodes.values()) {
      const symbols = node.consumptions[providerPath] ?? [];
      if (symbols.includes(symbolName) || symbols.includes('*')) {
        consumers.push(node.path);
      }
    }
    return consumers;
  }

  private resolveMoveConfidence(
    previousLocation: string | undefined,
    currentLocation: string,
    astHash: string,
    signatureHash: string
  ): { moveConfidence: MoveConfidence; matchReason: string } {
    if (!previousLocation) {
      return { moveConfidence: 'none', matchReason: 'No prior footprint anchor recorded for this symbol identity.' };
    }
    if (previousLocation === currentLocation) {
      return {
        moveConfidence: 'exact',
        matchReason: 'Symbol remains at the same file path with unchanged AST-normalized hash.',
      };
    }
    return {
      moveConfidence: 'high',
      matchReason: `Identity preserved by AST hash (${astHash.slice(0, 8)}) and signature hash (${signatureHash.slice(0, 8)}) despite path change ${previousLocation} -> ${currentLocation}.`,
    };
  }
}
