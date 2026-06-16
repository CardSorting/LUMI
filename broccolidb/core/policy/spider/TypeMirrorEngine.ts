// [LAYER: CORE]
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import type { TypeMirrorDiagnostic, TypeMirrorResult } from './report-types.js';

export class TypeMirrorEngine {
  constructor(private readonly cwd: string) {}

  runTypeMirror(scopeFiles?: Set<string>): TypeMirrorResult {
    const tsconfigPath = ts.findConfigFile(this.cwd, ts.sys.fileExists, 'tsconfig.json');
    if (!tsconfigPath) {
      return {
        compilerAvailable: false,
        diagnosticsComplete: false,
        degradedReason: 'No tsconfig.json found; type truth cannot be verified.',
        diagnosticCount: 0,
        diagnostics: [],
      };
    }

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      return {
        compilerAvailable: false,
        diagnosticsComplete: false,
        degradedReason: `Failed to parse tsconfig: ${configFile.error.messageText}`,
        tsconfigPath,
        diagnosticCount: 0,
        diagnostics: [],
      };
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
    let rootNames = parsed.fileNames;
    if (scopeFiles && scopeFiles.size > 0) {
      rootNames = rootNames.filter((file) => {
        const rel = path.relative(this.cwd, file).replace(/\\/g, '/');
        return scopeFiles.has(rel);
      });
    }

    if (rootNames.length === 0) {
      return {
        compilerAvailable: true,
        diagnosticsComplete: false,
        degradedReason: 'No in-scope TypeScript files matched tsconfig program roots.',
        tsconfigPath,
        commandUsed: 'typescript.createProgram',
        diagnosticCount: 0,
        diagnostics: [],
      };
    }

    const program = ts.createProgram({
      rootNames,
      options: parsed.options,
      host: ts.createCompilerHost(parsed.options, true),
    });

    const syntactic = program.getSyntacticDiagnostics();
    const semantic = program.getSemanticDiagnostics();
    const allDiagnostics = [...syntactic, ...semantic];

    const diagnostics: TypeMirrorDiagnostic[] = allDiagnostics.map((diag) => {
      const file = diag.file;
      const relPath = file
        ? path.relative(this.cwd, file.fileName).replace(/\\/g, '/')
        : 'unknown';
      const start = diag.start ?? 0;
      const lineChar = file ? file.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
      const end = start + (diag.length ?? 1);
      const endLineChar = file ? file.getLineAndCharacterOfPosition(end) : lineChar;

      return {
        filePath: relPath,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        code: diag.code,
        category: ts.DiagnosticCategory[diag.category] ?? 'Unknown',
        sourceRange: file
          ? {
              startLine: lineChar.line + 1,
              startColumn: lineChar.character + 1,
              endLine: endLineChar.line + 1,
              endColumn: endLineChar.character + 1,
            }
          : undefined,
      };
    });

    return {
      compilerAvailable: true,
      diagnosticsComplete: true,
      commandUsed: 'typescript.createProgram',
      tsconfigPath,
      diagnosticCount: diagnostics.length,
      diagnostics,
    };
  }

  isCompilerPresent(): boolean {
    return fs.existsSync(path.join(this.cwd, 'tsconfig.json'));
  }
}
