// [LAYER: CORE]
// @classification CAPABILITY
import { randomUUID } from 'node:crypto';
import type { WriteOp } from '../../../infrastructure/db/BufferedDbPool.js';
import type { Workspace } from '../../workspace.js';
import { AgentGitError } from '../../errors.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
import {
  type TelemetryRecordInput,
  type TelemetryRecordResult,
} from '../capability-types.js';

export class TelemetryCapability extends CapabilityBase {
  readonly name = 'telemetry' as const;
  readonly dependencies = ['BufferedDbPool'] as const;

  constructor(
    private readonly push: (op: WriteOp, agentId?: string) => Promise<void>,
    private readonly workspace: Workspace,
    private readonly userId: string,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async record(input: TelemetryRecordInput): Promise<TelemetryRecordResult> {
    return this.execute(
      'record',
      async () => {
      const promptTokens = input.usage?.promptTokens;
      const completionTokens = input.usage?.completionTokens;
      if (!Number.isFinite(promptTokens) || promptTokens < 0) {
        throw new AgentGitError('usage.promptTokens must be a non-negative number', 'INVALID_ARGUMENT');
      }
      if (!Number.isFinite(completionTokens) || completionTokens < 0) {
        throw new AgentGitError('usage.completionTokens must be a non-negative number', 'INVALID_ARGUMENT');
      }

      const telemetryId = randomUUID();
      await this.push({
        type: 'insert',
        table: 'telemetry',
        values: {
          id: telemetryId,
          repoPath: input.repoPath ?? this.workspace.workspacePath,
          agentId: input.agentId ?? this.userId,
          taskId: input.taskId ?? null,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          modelId: input.usage.modelId ?? 'unknown',
          cost: 0,
          timestamp: Date.now(),
          environment: JSON.stringify({ source: 'TelemetryCapability.record' }),
        },
        layer: 'infrastructure',
      });
      return { recorded: true, telemetryId };
      },
      {
        input,
        inputSummary: {
          agentId: input.agentId,
          promptTokens: input.usage.promptTokens,
          completionTokens: input.usage.completionTokens,
        },
        expectedEffects: ['BufferedDbPool.telemetry'],
        durability: 'durable',
        summarizeResult: (result) => ({ telemetryId: result.telemetryId }),
      }
    );
  }
}
