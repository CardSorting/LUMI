// [LAYER: CORE]
// @classification CAPABILITY
import type { TaskService } from '../TaskService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
import {
  requireNonEmptyString,
  type TaskAgentInput,
  type TaskAppendMemoryInput,
  type TaskAppendMemoryResult,
  type TaskContextInput,
  type TaskContextResult,
  type TaskRegisterAgentInput,
  type TaskRegisterAgentResult,
  type TaskScratchpadContentInput,
  type TaskScratchpadContentResult,
  type TaskScratchpadPathResult,
  type TaskScratchpadUpdateResult,
  type TaskSpawnInput,
  type TaskSpawnResult,
  type TaskUpdateStatusInput,
  type TaskUpdateStatusResult,
} from '../capability-types.js';

export class TaskCapability extends CapabilityBase {
  readonly name = 'tasks' as const;
  readonly dependencies = ['TaskService'] as const;

  constructor(
    private readonly taskService: TaskService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async registerAgent(input: TaskRegisterAgentInput): Promise<TaskRegisterAgentResult> {
    return this.execute('registerAgent', async () => {
      const agentId = requireNonEmptyString(input.agentId, 'agentId');
      await this.taskService.registerAgent(
        agentId,
        requireNonEmptyString(input.name, 'name'),
        requireNonEmptyString(input.role, 'role'),
        input.permissions ?? []
      );
      return { registered: true, agentId };
    });
  }

  async getAgent(input: TaskAgentInput) {
    return this.execute('getAgent', async () =>
      this.taskService.getAgent(requireNonEmptyString(input.agentId, 'agentId'))
    );
  }

  async appendMemoryLayer(input: TaskAppendMemoryInput): Promise<TaskAppendMemoryResult> {
    return this.execute('appendMemoryLayer', async () => {
      await this.taskService.appendMemoryLayer(
        requireNonEmptyString(input.agentId, 'agentId'),
        requireNonEmptyString(input.memory, 'memory')
      );
      return { appended: true };
    });
  }

  async updateStatus(input: TaskUpdateStatusInput): Promise<TaskUpdateStatusResult> {
    return this.execute('updateStatus', async () => {
      const taskId = requireNonEmptyString(input.taskId, 'taskId');
      await this.taskService.updateTaskStatus(taskId, input.status, input.result);
      return { updated: true, taskId };
    });
  }

  async spawn(input: TaskSpawnInput): Promise<TaskSpawnResult> {
    return this.execute('spawn', async () => {
      const taskId = requireNonEmptyString(input.taskId, 'taskId');
      await this.taskService.spawnTask(
        taskId,
        requireNonEmptyString(input.agentId, 'agentId'),
        requireNonEmptyString(input.description, 'description'),
        input.linkedKnowledgeIds
      );
      return { taskId };
    });
  }

  async getContext(input: TaskContextInput): Promise<TaskContextResult> {
    return this.execute('getContext', async () => ({
      context: await this.taskService.getTaskContext(requireNonEmptyString(input.taskId, 'taskId')),
    }));
  }

  getScratchpadPath(): TaskScratchpadPathResult {
    return this.run('getScratchpadPath', () => ({ path: this.taskService.getScratchpadPath() }));
  }

  async loadScratchpad(): Promise<TaskScratchpadContentResult> {
    return this.execute('loadScratchpad', async () => ({ content: await this.taskService.loadScratchpad() }));
  }

  async updateScratchpad(input: TaskScratchpadContentInput): Promise<TaskScratchpadUpdateResult> {
    return this.execute('updateScratchpad', async () => {
      await this.taskService.updateScratchpad(requireNonEmptyString(input.content, 'content'));
      return { updated: true };
    });
  }
}
