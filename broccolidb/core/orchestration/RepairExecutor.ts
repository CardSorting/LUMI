// [LAYER: CORE]
/**
 * RepairExecutor — the sole authorized file mutation path in BroccoliDB orchestration.
 * Spider never mutates. All disk writes for repair flow through this executor.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentGitError } from '../errors.js';
import type { RepairDirective } from '../policy/spider/report-types.js';
import type { MutationPlan, RepairExecution } from './types.js';
import type { ExecutionTrace } from './ExecutionTrace.js';

export interface SpiderResyncPort {
  resync(options: { files: string[] }): Promise<{ resynced: string[] }>;
}

export class RepairExecutor {
  constructor(
    private readonly workspaceRoot: string,
    private readonly spiderResync: SpiderResyncPort,
    private readonly trace: ExecutionTrace
  ) {}

  async execute(
    plan: MutationPlan,
    sessionId: string,
    snapshotIds: string[]
  ): Promise<RepairExecution> {
    const execution: RepairExecution = {
      executionId: randomUUID(),
      planId: plan.planId,
      sessionId,
      startedAt: Date.now(),
      appliedSteps: [],
      skippedSteps: [],
      snapshotIds,
      status: 'running',
    };

    this.trace.emit(sessionId, 'execution_started', {
      executionId: execution.executionId,
      planId: plan.planId,
      stepCount: plan.steps.length,
    });

    try {
      for (const step of plan.steps) {
        const directive = plan.directives.find((d) => d.directiveId === step.directiveId);
        if (!directive) {
          execution.skippedSteps.push(step.stepId);
          continue;
        }
        await this.applyDirective(directive, sessionId);
        execution.appliedSteps.push(step.stepId);
      }
      execution.status = 'completed';
      execution.finishedAt = Date.now();
      this.trace.emit(sessionId, 'execution_completed', {
        executionId: execution.executionId,
        applied: execution.appliedSteps.length,
      });
    } catch (error) {
      execution.status = 'failed';
      execution.finishedAt = Date.now();
      execution.error = error instanceof Error ? error.message : String(error);
      this.trace.emit(sessionId, 'execution_failed', {
        executionId: execution.executionId,
        error: execution.error,
      });
      throw error;
    }

    return execution;
  }

  private async applyDirective(directive: RepairDirective, sessionId: string): Promise<void> {
    switch (directive.type) {
      case 'RESYNC_DISK_PARITY':
      case 'REFRESH_GRAPH_NODE':
        await this.spiderResync.resync({ files: [directive.targetFile] });
        return;

      case 'UPDATE_IMPORT_PATH':
        await this.updateImportPath(directive);
        return;

      case 'REMOVE_STALE_IMPORT':
        await this.removeStaleImport(directive);
        return;

      case 'ADD_MISSING_EXPORT':
        await this.addMissingExport(directive);
        return;

      case 'RENAME_SYMBOL_REFERENCE':
      case 'MOVE_SYMBOL_REFERENCE':
        await this.replaceInFile(directive);
        return;

      case 'BREAK_CYCLE_BY_INTERFACE':
      case 'FIX_LAYER_VIOLATION':
        throw new AgentGitError(
          `Directive type '${directive.type}' requires human-guided refactor; cannot auto-execute`,
          'INVALID_ARGUMENT'
        );

      default:
        throw new AgentGitError(`Unsupported repair directive type: ${directive.type}`, 'INVALID_ARGUMENT');
    }
  }

  private resolveFile(targetFile: string): string {
    return path.isAbsolute(targetFile) ? targetFile : path.join(this.workspaceRoot, targetFile);
  }

  private async updateImportPath(directive: RepairDirective): Promise<void> {
    const file = this.resolveFile(directive.targetFile);
    if (!fs.existsSync(file)) {
      throw new AgentGitError(`Target file not found: ${directive.targetFile}`, 'FILE_NOT_FOUND');
    }
    const content = fs.readFileSync(file, 'utf8');
    const newProvider = directive.suggestedValue;
    const updated = content.replace(
      /from\s+['"][^'"]+['"]/,
      `from '${newProvider.replace(/\.ts$/, '').replace(/^\.\//, './')}'`
    );
    if (updated === content) {
      throw new AgentGitError(`No import path updated in ${directive.targetFile}`, 'INVALID_ARGUMENT');
    }
    fs.writeFileSync(file, updated, 'utf8');
  }

  private async removeStaleImport(directive: RepairDirective): Promise<void> {
    const file = this.resolveFile(directive.targetFile);
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const symbol = directive.suggestedValue;
    const filtered = lines.filter((line) => !(line.includes('import') && line.includes(symbol)));
    fs.writeFileSync(file, filtered.join('\n'), 'utf8');
  }

  private async addMissingExport(directive: RepairDirective): Promise<void> {
    const file = this.resolveFile(directive.targetFile);
    if (!fs.existsSync(file)) {
      throw new AgentGitError(`Target file not found: ${directive.targetFile}`, 'FILE_NOT_FOUND');
    }
    const symbol = directive.suggestedValue || directive.targetFile;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(`export`) && content.includes(symbol)) return;
    const exportLine = `export const ${symbol} = ${symbol};\n`;
    fs.writeFileSync(file, exportLine + content, 'utf8');
  }

  private async replaceInFile(directive: RepairDirective): Promise<void> {
    const file = this.resolveFile(directive.targetFile);
    if (!fs.existsSync(file)) {
      throw new AgentGitError(`Target file not found: ${directive.targetFile}`, 'FILE_NOT_FOUND');
    }
    const parts = directive.suggestedValue.split('->');
    if (parts.length !== 2) {
      throw new AgentGitError('RENAME/MOVE directive requires suggestedValue "old->new"', 'INVALID_ARGUMENT');
    }
    const [oldVal, newVal] = parts;
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(oldVal)) {
      throw new AgentGitError(`Symbol '${oldVal}' not found in ${directive.targetFile}`, 'INVALID_ARGUMENT');
    }
    fs.writeFileSync(file, content.replaceAll(oldVal, newVal), 'utf8');
  }
}
