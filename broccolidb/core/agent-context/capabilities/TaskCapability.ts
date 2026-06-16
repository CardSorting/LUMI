// [LAYER: CORE]
// @classification CAPABILITY
import type { TaskService } from '../TaskService.js';
import type { TaskItem, TaskContext } from '../types.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class TaskCapability {
  constructor(
    private readonly taskService: TaskService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('tasks', this.isStarted(), ['TaskService']);
  }

  async registerAgent(agentId: string, name: string, role: string, permissions: string[] = []) {
    this.assertOperational('tasks.registerAgent');
    return this.taskService.registerAgent(agentId, name, role, permissions);
  }

  async getAgent(agentId: string) {
    this.assertOperational('tasks.getAgent');
    return this.taskService.getAgent(agentId);
  }

  async appendMemoryLayer(agentId: string, memory: string) {
    this.assertOperational('tasks.appendMemoryLayer');
    return this.taskService.appendMemoryLayer(agentId, memory);
  }

  async updateStatus(taskId: string, status: TaskItem['status'], result?: unknown) {
    this.assertOperational('tasks.updateStatus');
    return this.taskService.updateTaskStatus(taskId, status, result);
  }

  async spawn(taskId: string, agentId: string, description: string, linkedKnowledgeIds?: string[]) {
    this.assertOperational('tasks.spawn');
    return this.taskService.spawnTask(taskId, agentId, description, linkedKnowledgeIds);
  }

  async getContext(taskId: string): Promise<TaskContext> {
    this.assertOperational('tasks.getContext');
    return this.taskService.getTaskContext(taskId);
  }

  getScratchpadPath(): string {
    this.assertOperational('tasks.getScratchpadPath');
    return this.taskService.getScratchpadPath();
  }

  async loadScratchpad(): Promise<string> {
    this.assertOperational('tasks.loadScratchpad');
    return this.taskService.loadScratchpad();
  }

  async updateScratchpad(content: string): Promise<void> {
    this.assertOperational('tasks.updateScratchpad');
    return this.taskService.updateScratchpad(content);
  }
}
