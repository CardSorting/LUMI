// [LAYER: CORE]
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ServiceContext, ToolDef, ToolUseContext } from './types.js';

export interface ToolResult {
    toolUseId: string;
    content: string;
    isError?: boolean;
}

/**
 * StreamingToolExecutor orchestrates tool calls received from the AI.
 * It manages concurrency, safety checks, and provides real-time progress.
 * Ported and adapted from src/services/tools/StreamingToolExecutor.ts.
 */
export class StreamingToolExecutor {
  private inProgress = new Set<string>();

  constructor(
    private tools: ToolDef[],
    private ctx: ServiceContext
  ) {}

  /**
   * Executes a single tool call.
   */
  async execute(name: string, input: any, toolUseId: string): Promise<ToolResult> {
    const tool = this.tools.find(t => t.name === name);
    if (!tool) {
      return {
          toolUseId,
          content: `Error: Tool '${name}' not found.`,
          isError: true
      };
    }

    this.inProgress.add(toolUseId);
    console.log(`[Executor] 🛠️  Executing ${name} (${toolUseId})...`);

    try {
      // 1. Safety Check: Destructive changes require special attention in Sovereign mode
      if (tool.isDestructive) {
          console.log(`[Executor] ⚠️  Destructive tool '${name}' detected. Ensure audit trail is active.`);
      }

      // 2. Execution with progress reporting (simulated for now, would use onProgress in real impl)
      const result = await tool.execute(input, this.ctx);

      // 3. Response Formatting
      const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      
      // Trim if exceeds limit
      const limit = tool.maxResultSizeChars || 100000;
      let finalContent = content.length > limit 
        ? `${content.slice(0, limit)}\n... [result truncated for size]`
        : content;

      // 4. Real-Time Symbolic Mirroring (Anchored on Reality)
      // If the tool modified a file, read its REAL bytes from disk and sync the graph.
      if (!tool.isSearchOrReadCommand && (input.path || input.targetFile || input.TargetFile)) {
          const filePath = input.path || input.targetFile || input.TargetFile;
          const absolutePath = path.resolve(this.ctx.workspace.workspacePath, filePath);

          try {
              const realContent = await fs.readFile(absolutePath, 'utf8');
              const result = await this.ctx.spider.applyChanges([{ filePath, content: realContent }]);
              
              if (result.deficiencies.length > 0) {
                  finalContent += `\n\n🚨 STRUCTURAL WARNING: Your change broke ${result.deficiencies.length} symbolic contracts.`;
                  finalContent += `\nRepair Map (Current Reality):`;
                  for (const def of result.deficiencies) {
                      if (def.symbols.length > 0) {
                        finalContent += `\n- ${def.depId} (Line ${def.line}): Missing providers for: ${def.symbols.join(', ')}`;
                      }
                      for (const disp of def.displacements) {
                        finalContent += `\n- 💡 SUGGESTION: Symbol '${disp.symbol}' found in '${disp.newPath}'.`;
                      }
                      for (const dir of def.directives) {
                        finalContent += `\n- 🛠️ REPAIR PLAN: [${dir.action}] ${dir.rationale}`;
                      }
                  }
              }

              if (result.diagnostics.length > 0) {
                  finalContent += `\n\n❌ COMPILER ERRORS DETECTED:`;
                  for (const diag of result.diagnostics) {
                      finalContent += `\n- Line ${diag.line}: ${diag.message}`;
                  }
                  finalContent += `\n\nAction: Anchor on these real breakages. You MUST fix them to restore structural integrity.`;
              }
          } catch (readErr) {
              // file might have been deleted, which is handled by applyChanges(content: undefined)
              if (!input.content && !input.ReplacementContent && !input.CodeContent) {
                   await this.ctx.spider.applyChanges([{ filePath }]);
              }
          }
      }

      return {
          toolUseId,
          content: finalContent,
          isError: false
      };
    } catch (e: any) {
      console.error(`[Executor] ❌ Tool '${name}' failed:`, e);
      return {
          toolUseId,
          content: `Error executing tool '${name}': ${e.message || String(e)}`,
          isError: true
      };
    } finally {
      this.inProgress.delete(toolUseId);
    }
  }

  /**
   * Executes multiple tools, potentially in parallel if they are marked as search/read.
   */
  async* executeBatch(calls: { name: string; input: any; id: string }[]): AsyncGenerator<ToolResult> {
    const results: Promise<ToolResult>[] = [];
    
    for (const call of calls) {
        const tool = this.tools.find(t => t.name === call.name);
        
        // Parallelize Search/Read tools; serialize others
        if (tool?.isSearchOrReadCommand) {
            results.push(this.execute(call.name, call.input, call.id));
        } else {
            // Wait for existing parallel tools to finish before a destructive/write operation
            if (results.length > 0) {
                for (const r of await Promise.all(results)) {
                    yield r;
                }
                results.length = 0;
            }
            yield await this.execute(call.name, call.input, call.id);
        }
    }

    // Yield any remaining parallel results
    if (results.length > 0) {
        for (const r of await Promise.all(results)) {
            yield r;
        }
    }
  }
}
