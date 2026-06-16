// [LAYER: CORE]
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ServiceContext, ToolDef, ToolUseContext } from './types.js';

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
  metadata?: {
    toolName: string;
    elapsedMs: number;
    truncated: boolean;
    mirrored: boolean;
    warnings: string[];
  };
}

export interface ToolCall {
  name: string;
  input?: unknown;
  id: string;
}

export type ToolExecutionPhase =
  | 'queued'
  | 'validating'
  | 'running'
  | 'mirroring'
  | 'completed'
  | 'failed'
  | 'timeout';

export interface ToolExecutionProgress {
  toolUseId: string;
  toolName: string;
  phase: ToolExecutionPhase;
  elapsedMs: number;
  message?: string;
}

export interface ToolExecutorOptions {
  defaultTimeoutMs?: number;
  maxParallelReads?: number;
  mirrorFileChanges?: boolean;
  failOnUnsafeMutationPath?: boolean;
  recordAuditEvents?: boolean;
  onProgress?: (progress: ToolExecutionProgress) => void;
}

type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

type MutationPath = {
  inputPath: string;
  absolutePath: string;
  relativePath: string;
  isSafe: boolean;
};

class ToolTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number
  ) {
    super(`Tool '${toolName}' exceeded timeout of ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

type ToolCallCollector = (call: ToolCall) => void;

/**
 * StreamingToolExecutor orchestrates tool calls received from the AI.
 * It manages concurrency, safety checks, and provides real-time progress.
 * Ported and adapted from src/services/tools/StreamingToolExecutor.ts.
 */
export class StreamingToolExecutor {
  private inProgress = new Set<string>();
  private readonly options: Required<Omit<ToolExecutorOptions, 'onProgress'>> &
    Pick<ToolExecutorOptions, 'onProgress'>;

  constructor(
    private tools: ToolDef[],
    private ctx: ServiceContext,
    options: ToolExecutorOptions = {}
  ) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 60000,
      maxParallelReads: Math.max(1, options.maxParallelReads ?? 8),
      mirrorFileChanges: options.mirrorFileChanges ?? true,
      failOnUnsafeMutationPath: options.failOnUnsafeMutationPath ?? true,
      recordAuditEvents: options.recordAuditEvents ?? true,
      onProgress: options.onProgress,
    };
  }

  public getActiveToolIds(): string[] {
    return Array.from(this.inProgress);
  }

  /**
   * Parses common model-emitted tool-call envelopes:
   * - OpenAI-style {"tool_calls":[{"function":{"name":"x","arguments":"{}"}}]}
   * - Anthropic-style [{"type":"tool_use","name":"x","input":{}}]
   * - Fenced JSON blocks containing either of the above
   * - XML-ish <tool_call name="x">{"arg":true}</tool_call> blocks
   */
  public static parseToolCallsFromText(text: string, tools: ToolDef[] = []): ToolCall[] {
    const calls: ToolCall[] = [];
    const seen = new Set<string>();
    const allowedNames = tools.length > 0 ? new Set(tools.map((tool) => tool.name)) : null;
    const addCall: ToolCallCollector = (call) => {
      if (!call.name) return;
      if (allowedNames && !allowedNames.has(call.name)) return;
      const dedupeKey = `${call.id}:${call.name}:${JSON.stringify(call.input ?? {})}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      calls.push(call);
    };

    for (const candidate of StreamingToolExecutor.extractJsonCandidates(text)) {
      const parsed = StreamingToolExecutor.tryParseJson(candidate);
      if (parsed !== undefined) {
        StreamingToolExecutor.collectToolCallsFromJson(parsed, addCall);
      }
    }

    StreamingToolExecutor.collectXmlToolCalls(text, addCall, allowedNames);
    return calls;
  }

  public static formatToolResultsForPrompt(results: ToolResult[]): string {
    const lines = ['<tool_results>'];
    for (const result of results) {
      const status = result.isError ? 'error' : 'ok';
      const toolName = result.metadata?.toolName || 'unknown';
      lines.push(
        `  <tool_result id="${StreamingToolExecutor.escapeXml(result.toolUseId)}" name="${StreamingToolExecutor.escapeXml(
          toolName
        )}" status="${status}">`
      );
      lines.push(StreamingToolExecutor.escapeXml(result.content));
      lines.push('  </tool_result>');
    }
    lines.push('</tool_results>');
    return lines.join('\n');
  }

  /**
   * Executes a single tool call.
   */
  async execute(name: string, input: unknown, toolUseId: string): Promise<ToolResult> {
    const startedAt = Date.now();
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        toolUseId,
        content: `Error: Tool '${name}' not found.`,
        isError: true,
      };
    }

    const warnings: string[] = [];
    const normalizedInput = this.normalizeInput(input);
    this.inProgress.add(toolUseId);
    this.emitProgress(toolUseId, name, 'queued', startedAt);

    try {
      this.emitProgress(toolUseId, name, 'validating', startedAt);
      const validationErrors = this.validateInput(tool.parameters as JsonSchema | undefined, normalizedInput);
      if (validationErrors.length > 0) {
        const content = `Invalid input for tool '${name}':\n${validationErrors
          .map((err) => `- ${err}`)
          .join('\n')}`;
        await this.recordAuditEvent(name, toolUseId, startedAt, false, warnings, content);
        return this.makeResult(name, toolUseId, content, true, startedAt, false, false, warnings);
      }

      const mutationPath = this.getMutationPath(normalizedInput);
      if (!tool.isSearchOrReadCommand && mutationPath && !mutationPath.isSafe) {
        warnings.push('unsafe_mutation_path');
        if (this.options.failOnUnsafeMutationPath) {
          const content = `Refusing to execute tool '${name}': mutation path escapes workspace (${mutationPath.inputPath}).`;
          await this.recordAuditEvent(name, toolUseId, startedAt, false, warnings, content);
          return this.makeResult(name, toolUseId, content, true, startedAt, false, false, warnings);
        }
      }

      if (tool.isDestructive) {
        warnings.push('destructive_tool');
      }

      this.emitProgress(toolUseId, name, 'running', startedAt);
      const result = await this.executeWithTimeout(tool, normalizedInput, toolUseId, startedAt);

      const content = this.stringifyResult(result);
      const limit = tool.maxResultSizeChars || 100000;
      const redacted = this.redactSensitiveText(content);
      const truncated = redacted.length > limit;
      let finalContent = truncated ? `${redacted.slice(0, limit)}\n... [result truncated for size]` : redacted;
      let mirrored = false;

      if (this.options.mirrorFileChanges && !tool.isSearchOrReadCommand && mutationPath) {
        this.emitProgress(toolUseId, name, 'mirroring', startedAt);

        try {
          const realContent = await fs.readFile(mutationPath.absolutePath, 'utf8');
          const mirrorResult = await this.ctx.spider.applyChanges([
            { filePath: mutationPath.relativePath, content: realContent },
          ]);
          mirrored = true;

          if (mirrorResult.deficiencies.length > 0) {
            finalContent += `\n\nSTRUCTURAL WARNING: Change broke ${mirrorResult.deficiencies.length} symbolic contracts.`;
            finalContent += '\nRepair Map (Current Reality):';
            for (const def of mirrorResult.deficiencies) {
              if (def.symbols.length > 0) {
                finalContent += `\n- ${def.depId} (Line ${def.line}): Missing providers for: ${def.symbols.join(', ')}`;
              }
              for (const disp of def.displacements) {
                finalContent += `\n- SUGGESTION: Symbol '${disp.symbol}' found in '${disp.newPath}'.`;
              }
              for (const dir of def.directives) {
                finalContent += `\n- REPAIR PLAN: [${dir.type ?? dir.action}] ${dir.rationale}`;
              }
            }
          }

          if (mirrorResult.diagnostics.length > 0) {
            finalContent += '\n\nCOMPILER ERRORS DETECTED:';
            for (const diag of mirrorResult.diagnostics) {
              finalContent += `\n- Line ${diag.line}: ${diag.message}`;
            }
            finalContent += '\n\nAction: Anchor on these real breakages before continuing.';
          }
        } catch {
          if (!this.hasInlineReplacement(normalizedInput)) {
            await this.ctx.spider.applyChanges([{ filePath: mutationPath.relativePath }]);
            mirrored = true;
          }
        }
      }

      this.emitProgress(toolUseId, name, 'completed', startedAt);
      await this.recordAuditEvent(name, toolUseId, startedAt, true, warnings);
      return this.makeResult(name, toolUseId, finalContent, false, startedAt, truncated, mirrored, warnings);
    } catch (e: any) {
      const timedOut = e instanceof ToolTimeoutError;
      this.emitProgress(toolUseId, name, timedOut ? 'timeout' : 'failed', startedAt, e.message);
      const content = this.redactSensitiveText(`Error executing tool '${name}': ${e.message || String(e)}`);
      await this.recordAuditEvent(name, toolUseId, startedAt, false, warnings, content);
      return this.makeResult(name, toolUseId, content, true, startedAt, false, false, warnings);
    } finally {
      this.inProgress.delete(toolUseId);
    }
  }

  /**
   * Executes multiple tools, potentially in parallel if they are marked as search/read.
   */
  async* executeBatch(calls: ToolCall[]): AsyncGenerator<ToolResult> {
    const readBatch: Promise<ToolResult>[] = [];

    const flushReads = async function* (pending: Promise<ToolResult>[]) {
      if (pending.length === 0) return;
      for (const result of await Promise.all(pending)) {
        yield result;
      }
      pending.length = 0;
    };

    for (const call of calls) {
      const tool = this.tools.find((t) => t.name === call.name);

      if (tool?.isSearchOrReadCommand) {
        readBatch.push(this.execute(call.name, call.input, call.id));
        if (readBatch.length >= this.options.maxParallelReads) {
          yield* flushReads(readBatch);
        }
      } else {
        yield* flushReads(readBatch);
        yield await this.execute(call.name, call.input, call.id);
      }
    }

    yield* flushReads(readBatch);
  }

  private normalizeInput(input: unknown): Record<string, unknown> {
    if (input === null || input === undefined) return {};
    if (typeof input === 'object' && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return { value: input };
  }

  private validateInput(schema: JsonSchema | undefined, value: unknown, location = 'input'): string[] {
    if (!schema || Object.keys(schema).length === 0) return [];
    const errors: string[] = [];

    if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
      errors.push(`${location} must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
      return errors;
    }

    if (schema.type && !this.matchesJsonType(schema.type, value)) {
      errors.push(`${location} must be ${schema.type}`);
      return errors;
    }

    if (schema.type === 'object' || schema.properties || schema.required) {
      if (!this.isRecord(value)) {
        errors.push(`${location} must be object`);
        return errors;
      }

      for (const key of schema.required || []) {
        if (!(key in value)) errors.push(`${location}.${key} is required`);
      }

      for (const [key, childSchema] of Object.entries(schema.properties || {})) {
        if (key in value) {
          errors.push(...this.validateInput(childSchema, value[key], `${location}.${key}`));
        }
      }

      if (schema.additionalProperties === false && schema.properties) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(value)) {
          if (!allowed.has(key)) errors.push(`${location}.${key} is not allowed`);
        }
      }
    }

    if (schema.type === 'array' || schema.items) {
      if (!Array.isArray(value)) {
        errors.push(`${location} must be array`);
        return errors;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${location} must contain at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${location} must contain at most ${schema.maxItems} items`);
      }
      if (schema.items) {
        value.forEach((item, index) => {
          errors.push(...this.validateInput(schema.items, item, `${location}[${index}]`));
        });
      }
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${location} must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${location} must be at most ${schema.maxLength} characters`);
      }
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${location} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${location} must be <= ${schema.maximum}`);
      }
    }

    return errors;
  }

  private matchesJsonType(type: JsonSchema['type'], value: unknown): boolean {
    switch (type) {
      case 'object':
        return this.isRecord(value);
      case 'array':
        return Array.isArray(value);
      case 'integer':
        return Number.isInteger(value);
      case 'null':
        return value === null;
      default:
        return typeof value === type;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async executeWithTimeout(
    tool: ToolDef,
    input: Record<string, unknown>,
    toolUseId: string,
    startedAt: number
  ): Promise<unknown> {
    const timeoutMs = tool.timeoutMs ?? this.options.defaultTimeoutMs;
    const controller = new AbortController();
    const toolUseContext: ToolUseContext = {
      ...(this.ctx.toolUseContext || { options: { tools: this.tools } }),
      toolUseId,
      startedAt,
      signal: controller.signal,
      options: {
        ...(this.ctx.toolUseContext?.options || {}),
        tools: this.tools,
      },
    };
    const executionContext: ServiceContext = {
      ...this.ctx,
      toolUseContext,
    };

    let timeout: NodeJS.Timeout | undefined;
    const execution = Promise.resolve()
      .then(() => tool.execute(input, executionContext))
      .catch((err) => {
        throw err;
      });
    execution.catch(() => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ToolTimeoutError(tool.name, timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([execution, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private stringifyResult(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result === undefined) return '';
    return JSON.stringify(result, null, 2);
  }

  private redactSensitiveText(content: string): string {
    return content
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
      .replace(
        /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi,
        '$1=[REDACTED]'
      );
  }

  private getMutationPath(input: Record<string, unknown>): MutationPath | null {
    const inputPath = input.path ?? input.targetFile ?? input.TargetFile ?? input.filePath;
    if (typeof inputPath !== 'string' || inputPath.trim() === '') return null;

    const workspaceRoot = path.resolve(this.ctx.workspace.workspacePath);
    const absolutePath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(workspaceRoot, inputPath);
    const relative = path.relative(workspaceRoot, absolutePath);
    const isSafe = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    return {
      inputPath,
      absolutePath,
      relativePath: relative.split(path.sep).join('/'),
      isSafe,
    };
  }

  private hasInlineReplacement(input: Record<string, unknown>): boolean {
    return (
      typeof input.content === 'string' ||
      typeof input.ReplacementContent === 'string' ||
      typeof input.CodeContent === 'string'
    );
  }

  private makeResult(
    toolName: string,
    toolUseId: string,
    content: string,
    isError: boolean,
    startedAt: number,
    truncated: boolean,
    mirrored: boolean,
    warnings: string[]
  ): ToolResult {
    return {
      toolUseId,
      content,
      isError,
      metadata: {
        toolName,
        elapsedMs: Date.now() - startedAt,
        truncated,
        mirrored,
        warnings,
      },
    };
  }

  private emitProgress(
    toolUseId: string,
    toolName: string,
    phase: ToolExecutionPhase,
    startedAt: number,
    message?: string
  ): void {
    const progress: ToolExecutionProgress = {
      toolUseId,
      toolName,
      phase,
      elapsedMs: Date.now() - startedAt,
      message,
    };
    this.options.onProgress?.(progress);
    this.ctx.toolUseContext?.onProgress?.(progress);
  }

  private async recordAuditEvent(
    toolName: string,
    toolUseId: string,
    startedAt: number,
    ok: boolean,
    warnings: string[],
    error?: string
  ): Promise<void> {
    if (!this.options.recordAuditEvents) return;

    try {
      await this.ctx.push({
        type: 'insert',
        table: 'audit_events',
        values: {
          id: crypto.randomUUID(),
          userId: this.ctx.userId,
          agentId: this.ctx.toolUseContext?.agentId || this.ctx.userId,
          type: 'tool_execution',
          data: JSON.stringify({
            toolName,
            toolUseId,
            ok,
            warnings,
            error,
            elapsedMs: Date.now() - startedAt,
          }),
          createdAt: Date.now(),
        },
        layer: 'infrastructure',
      });
    } catch {
      // Tool execution must not fail just because audit persistence is unavailable.
    }
  }

  private static extractJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    const trimmed = text.trim();

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      candidates.push(trimmed);
    }

    const fencedBlockPattern = /```(?:json|tool|tools|tool_calls)?\s*([\s\S]*?)```/gi;
    let fencedMatch: RegExpExecArray | null;
    while ((fencedMatch = fencedBlockPattern.exec(text)) !== null) {
      const body = fencedMatch[1]?.trim();
      if (body) candidates.push(body);
    }

    const toolCallsXmlPattern = /<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/gi;
    let xmlMatch: RegExpExecArray | null;
    while ((xmlMatch = toolCallsXmlPattern.exec(text)) !== null) {
      const body = xmlMatch[1]?.trim();
      if (body) candidates.push(body);
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(text.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(text.slice(arrayStart, arrayEnd + 1));
    }

    return Array.from(new Set(candidates));
  }

  private static collectToolCallsFromJson(
    value: unknown,
    addCall: ToolCallCollector,
    depth = 0
  ): void {
    if (depth > 5) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        StreamingToolExecutor.collectToolCallsFromJson(item, addCall, depth + 1);
      }
      return;
    }

    if (!StreamingToolExecutor.isStaticRecord(value)) return;

    const toolCollections = [
      value.tool_calls,
      value.toolCalls,
      value.tools,
      value.actions,
      value.content,
    ];
    for (const collection of toolCollections) {
      if (Array.isArray(collection)) {
        for (const item of collection) {
          StreamingToolExecutor.collectToolCallsFromJson(item, addCall, depth + 1);
        }
      }
    }

    const normalized = StreamingToolExecutor.normalizeToolCallCandidate(value);
    if (normalized) {
      addCall(normalized);
    }
  }

  private static normalizeToolCallCandidate(candidate: Record<string, unknown>): ToolCall | null {
    const functionSpec = StreamingToolExecutor.isStaticRecord(candidate.function)
      ? candidate.function
      : undefined;
    const name = StreamingToolExecutor.asString(
      candidate.name ?? candidate.toolName ?? candidate.tool_name ?? candidate.tool ?? functionSpec?.name
    );

    if (!name) return null;
    const hasToolCallShape =
      functionSpec !== undefined ||
      candidate.input !== undefined ||
      candidate.args !== undefined ||
      candidate.arguments !== undefined ||
      candidate.parameters !== undefined ||
      candidate.params !== undefined ||
      candidate.toolName !== undefined ||
      candidate.tool_name !== undefined ||
      candidate.tool !== undefined ||
      candidate.type === 'tool_use' ||
      candidate.type === 'function';
    if (!hasToolCallShape) return null;

    const input =
      candidate.input ??
      candidate.args ??
      candidate.arguments ??
      candidate.parameters ??
      candidate.params ??
      functionSpec?.arguments ??
      {};

    return {
      id: StreamingToolExecutor.asString(candidate.id) || `tool-${crypto.randomUUID()}`,
      name,
      input: StreamingToolExecutor.normalizeToolInput(input),
    };
  }

  private static collectXmlToolCalls(
    text: string,
    addCall: ToolCallCollector,
    allowedNames: Set<string> | null
  ): void {
    const explicitToolPattern =
      /<(?:tool_call|tool|use_tool)\b([^>]*)>([\s\S]*?)<\/(?:tool_call|tool|use_tool)>/gi;
    let match: RegExpExecArray | null;
    while ((match = explicitToolPattern.exec(text)) !== null) {
      const attributes = StreamingToolExecutor.parseXmlAttributes(match[1] || '');
      const name = attributes.name || attributes.tool || attributes.tool_name;
      if (!name) continue;
      addCall({
        id: attributes.id || `tool-${crypto.randomUUID()}`,
        name,
        input: StreamingToolExecutor.normalizeToolInput(match[2]?.trim() || {}),
      });
    }

    if (!allowedNames) return;

    for (const name of allowedNames) {
      const escaped = StreamingToolExecutor.escapeRegExp(name);
      const tagPattern = new RegExp(`<${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/${escaped}>`, 'gi');
      let namedMatch: RegExpExecArray | null;
      while ((namedMatch = tagPattern.exec(text)) !== null) {
        const attributes = StreamingToolExecutor.parseXmlAttributes(namedMatch[1] || '');
        addCall({
          id: attributes.id || `tool-${crypto.randomUUID()}`,
          name,
          input: StreamingToolExecutor.normalizeToolInput(namedMatch[2]?.trim() || {}),
        });
      }
    }
  }

  private static parseXmlAttributes(raw: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const attrPattern = /([A-Za-z_][\w:-]*)\s*=\s*(['"])(.*?)\2/g;
    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(raw)) !== null) {
      attributes[match[1]!] = match[3] || '';
    }
    return attributes;
  }

  private static normalizeToolInput(input: unknown): unknown {
    if (typeof input !== 'string') return input;

    const trimmed = input.trim();
    if (!trimmed) return {};
    const parsed = StreamingToolExecutor.tryParseJson(trimmed);
    if (parsed !== undefined) return parsed;
    return { value: trimmed };
  }

  private static tryParseJson(raw: string): unknown | undefined {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  private static asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private static isStaticRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
