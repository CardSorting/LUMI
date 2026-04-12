import * as fs from 'node:fs';
import * as path from 'node:path';
import { type CallExpression, type ImportDeclaration, Project, SyntaxKind } from 'ts-morph';

export type Layer = 'domain' | 'core' | 'infrastructure' | 'plumbing' | 'ui';

/**
 * Determines the layer of a given file path based on Joy-Zoning conventions or spider.spec.json.
 */
export function getLayer(filePath: string): Layer {
  const normalized = filePath.replace(/\\/g, '/');

  // Try to load spider.spec.json for custom domain/layer mappings
  try {
    const specPath = path.resolve(process.cwd(), 'spider.spec.json');
    if (fs.existsSync(specPath)) {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
      if (spec.resources) {
        // Check if any resource path matches
        for (const [_key, resource] of Object.entries(spec.resources)) {
          const res = resource as { path?: string; domain?: string };
          if (res.path && normalized.includes(res.path)) {
            if (res.domain) {
              const domainToLayer: Record<string, Layer> = {
                ui: 'ui',
                api: 'infrastructure',
                admin: 'infrastructure',
                domain: 'domain',
                core: 'core',
              };
              return domainToLayer[res.domain] || 'infrastructure';
            }
          }
        }
      }
    }
    } catch {
      // Ignore
    }

  if (normalized.includes('src/domain/')) return 'domain';
  if (normalized.includes('src/infrastructure/')) return 'infrastructure';
  if (normalized.includes('src/plumbing/')) return 'plumbing';
  if (normalized.includes('src/ui/')) return 'ui';

  // Fallback for Codemarie's specific structure if it doesn't match the standard Joy-Zoning
  // NOTE: src/core/ is NOT strict domain — it's a "soft" domain with relaxed enforcement
  if (normalized.includes('src/core/')) return 'core';
  if (normalized.includes('src/services/') || normalized.includes('src/integrations/'))
    return 'infrastructure';
  if (normalized.includes('src/utils/')) return 'plumbing';
  if (normalized.includes('webview-ui/')) return 'ui';

  return 'infrastructure'; // Default
}

/**
 * Validates architectural smells in the given content.
 * Layer-aware: strict checks apply only to domain/infrastructure.
 */
export function validateSmells(filePath: string, content: string): string[] {
  const errors: string[] = [];
  const layer = getLayer(filePath);

  // Multiple classes in a single file — only enforced in domain
  if (layer === 'domain') {
    const classCount = (content.match(/class\s+/g) || []).length;
    if (classCount > 1) {
      errors.push(
        `${path.basename(filePath)}: Multiple classes in a single file — split into separate files.`
      );
    }
  }

  // Discouraged 'any' type — domain and infrastructure only (core is exempt)
  if (layer === 'domain' || layer === 'infrastructure') {
    if (content.includes(': any') || content.includes('<any>')) {
      // Surface as an architectural smell rather than a strict error
      errors.push(`${path.basename(filePath)}: Architectural smell — 'any' type detected.`);
    }
  }

  return errors;
}

/**
 * Validates layering constraints using AST analysis.
 */
export function validateLayering(filePath: string, content: string): string[] {
  const errors: string[] = [];
  const layer = getLayer(filePath);

  const project = new Project();
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });

  // Validate imports
  sourceFile.getImportDeclarations().forEach((imp: ImportDeclaration) => {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (moduleSpecifier.startsWith('.')) {
      const absoluteImportPath = path.resolve(path.dirname(filePath), moduleSpecifier);
      const importedLayer = getLayer(absoluteImportPath);

      if (layer === 'domain') {
        if (importedLayer === 'infrastructure' || importedLayer === 'ui') {
          errors.push(
            `Domain layer in ${path.basename(filePath)} cannot import from ${importedLayer}.`
          );
        }
      }
      if (layer === 'core') {
        if (importedLayer === 'ui') {
          errors.push(
            `Core layer in ${path.basename(filePath)} cannot import from UI — use events or callbacks.`
          );
        }
      }
      if (layer === 'infrastructure') {
        if (importedLayer === 'ui') {
          errors.push(`Infrastructure layer in ${path.basename(filePath)} cannot import from UI.`);
        }
      }
      if (layer === 'ui') {
        if (importedLayer === 'infrastructure') {
          errors.push(
            `UI layer in ${path.basename(filePath)} cannot directly import Infrastructure.`
          );
        }
      }
      if (layer === 'plumbing') {
        if (['domain', 'core', 'infrastructure', 'ui'].includes(importedLayer)) {
          errors.push(
            `Plumbing layer in ${path.basename(filePath)} cannot depend on ${importedLayer} layer.`
          );
        }
      }
    }
  });

  // Validate forbidden calls in Domain
  if (layer === 'domain') {
    const forbiddenTerms = ['fetch', 'fs.', 'child_process', 'axios', 'http.'];
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call: CallExpression) => {
      const text = call.getExpression().getText();
      if (forbiddenTerms.some((term) => text.includes(term))) {
        errors.push(
          `Architectural Violation: Forbidden call '${text}' in Domain layer file ${path.basename(filePath)}.`
        );
      }
    });
  }

  // Circular Dependency Detection (Surface Level: A ↔ B direct cycles)
  sourceFile.getImportDeclarations().forEach((imp: ImportDeclaration) => {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (moduleSpecifier.startsWith('.')) {
      const resolvedPath = path.resolve(
        path.dirname(filePath),
        moduleSpecifier + (moduleSpecifier.endsWith('.ts') ? '' : '.ts')
      );
      try {
        const importedFile = project.addSourceFileAtPathIfExists(resolvedPath);
        if (importedFile) {
          const isCircular = importedFile.getImportDeclarations().some((i) => {
            const spec = i.getModuleSpecifierValue();
            if (!spec.startsWith('.')) return false;
            const backResolved = path.resolve(
              path.dirname(resolvedPath),
              spec + (spec.endsWith('.ts') ? '' : '.ts')
            );
            return backResolved === filePath;
          });
          if (isCircular) {
            errors.push(
              `Architectural Violation: Circular dependency detected between ${path.basename(filePath)} and ${path.basename(resolvedPath)}.`
            );
          }
        }
      } catch {
        /* Imported file not on disk or inaccessible; skip circular check for this import */
      }
    }
  });

  return errors;
}

/**
 * Full Joy-Zoning validation for a file.
 */
export function validateJoyZoning(
  filePath: string,
  content: string
): { success: boolean; errors: string[] } {
  const smellErrors = validateSmells(filePath, content);
  const layeringErrors = validateLayering(filePath, content);
  const allErrors = [...smellErrors, ...layeringErrors];

  return {
    success: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Analyzes code content and suggests which architectural layer best fits.
 * Returns the suggested layer and the reasoning behind the suggestion.
 */
export function suggestLayerForContent(content: string): { layer: Layer; reason: string } | null {
  // Check for UI patterns
  if (/import\s+.*from\s+["']react/i.test(content) || /jsx|tsx|component|render/i.test(content)) {
    return { layer: 'ui', reason: 'Contains React/JSX patterns — belongs in the UI layer.' };
  }

  // Check for I/O / adapter patterns
  if (
    /import\s+.*from\s+["'](?:fs|http|https|net|child_process|pg|mysql|redis|axios)/i.test(content)
  ) {
    return {
      layer: 'infrastructure',
      reason: 'Contains I/O or external service imports — belongs in Infrastructure.',
    };
  }

  // Check for pure utility patterns (no class, stateless exports)
  if (
    !/class\s+/.test(content) &&
    /export\s+(?:function|const)\s+/.test(content) &&
    !/import\s+.*from\s+["']@(?:core|infrastructure|services)/.test(content)
  ) {
    return {
      layer: 'plumbing',
      reason: 'Stateless utility functions with no layer dependencies — fits Plumbing.',
    };
  }

  return null; // can't confidently suggest
}

/**
 * Extracts a target file path from various common tool parameter names.
 */
export function getTargetPath(params: Record<string, unknown>): string | null {
  if (!params) return null;
  const rawPath = params.path || params.file_path || params.target_file || params.absolutePath;
  if (typeof rawPath !== 'string') return null;
  return rawPath;
}
