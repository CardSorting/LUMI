// [LAYER: CORE]
// @classification CAPABILITY
import { randomUUID } from 'node:crypto';
import type { WriteOp } from '../../../infrastructure/db/BufferedDbPool.js';
import type { Workspace } from '../../workspace.js';

export interface TelemetryEvent {
  usage: { promptTokens: number; completionTokens: number; modelId?: string };
  agentId?: string;
  taskId?: string | null;
  repoPath?: string;
}

export class TelemetryCapability {
  constructor(
    private readonly push: (op: WriteOp, agentId?: string) => Promise<void>,
    private readonly workspace: Workspace,
    private readonly userId: string,
    private readonly assertOperational: (operation: string) => void
  ) {}

  async record(event: TelemetryEvent): Promise<void> {
    this.assertOperational('recordTelemetry');
    const promptTokens = event.usage.promptTokens;
    const completionTokens = event.usage.completionTokens;
    await this.push({
      type: 'insert',
      table: 'telemetry',
      values: {
        id: randomUUID(),
        repoPath: event.repoPath ?? this.workspace.workspacePath,
        agentId: event.agentId ?? this.userId,
        taskId: event.taskId ?? null,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        modelId: event.usage.modelId ?? 'unknown',
        cost: 0,
        timestamp: Date.now(),
        environment: JSON.stringify({ source: 'TelemetryCapability.record' }),
      },
      layer: 'infrastructure',
    });
  }
}
