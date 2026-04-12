import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentGitError } from '../errors.js';
import type { GraphService } from './GraphService.js';
import type {
  AgentProfile,
  KnowledgeBaseItem,
  ServiceContext,
  TaskContext,
  TaskItem,
} from './types.js';

export class TaskService {
  constructor(
    private ctx: ServiceContext,
    private graph: GraphService
  ) {}

  /**
   * Returns the disk path for the Sovereign Scratchpad (SOFT_STATE.md).
   * Absorbed from src/coordinator/coordinatorMode.ts.
   */
  getScratchpadPath(): string {
    return path.resolve(process.cwd(), '.broccolidb', 'SOFT_STATE.md');
  }

  /**
   * Loads the current Sovereign Scratchpad content.
   */
  async loadScratchpad(): Promise<string> {
    const p = this.getScratchpadPath();
    if (!fs.existsSync(p)) return '# Sovereign Scratchpad\n\n*No shared state yet.*';
    return fs.promises.readFile(p, 'utf8');
  }

  /**
   * Updates the Sovereign Scratchpad content atomically.
   */
  async updateScratchpad(content: string): Promise<void> {
    const p = this.getScratchpadPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(p, content, 'utf8');
  }

  /**
   * Returns the disk path for a task's sidechain output.
   * Absorbed from src/utils/task/diskOutput.ts.
   */
  getTaskOutputPath(taskId: string): string {
    const taskDir = path.resolve(process.cwd(), '.broccolidb', 'tasks');
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true });
    }
    return path.join(taskDir, `${taskId}.output`);
  }

  /**
   * Appends content to a task's durable disk buffer.
   */
  async appendTaskBuffer(taskId: string, content: string): Promise<void> {
    const p = this.getTaskOutputPath(taskId);
    await fs.promises.appendFile(p, content, 'utf8');
  }

  /**
   * Reads a task's durable disk buffer.
   */
  async readTaskBuffer(taskId: string): Promise<string> {
    const p = this.getTaskOutputPath(taskId);
    if (!fs.existsSync(p)) return '';
    return fs.promises.readFile(p, 'utf8');
  }

  async registerAgent(
    agentId: string,
    name: string,
    role: string,
    permissions: string[] = []
  ): Promise<void> {
    await this.ctx.push(
      {
        type: 'upsert',
        table: 'agents',
        where: [{ column: 'id', value: agentId }],
        values: {
          id: agentId,
          userId: this.ctx.userId,
          name,
          role,
          permissions: JSON.stringify(permissions),
          memoryLayer: JSON.stringify([]),
          createdAt: Date.now(),
          lastActive: Date.now(),
        },
        layer: 'domain',
      },
      agentId
    );
  }

  async getAgent(agentId: string): Promise<AgentProfile> {
    const agent = await this.ctx.db.selectOne('agents', [{ column: 'id', value: agentId }]);
    if (!agent) {
      throw new AgentGitError(`Agent ${agentId} not found`, 'INVALID_USER_ID');
    }
    await this.ctx.push(
      {
        type: 'update',
        table: 'agents',
        where: [{ column: 'id', value: agentId }],
        values: { lastActive: Date.now() },
        layer: 'infrastructure',
      },
      agentId
    );
    return {
      ...agent,
      agentId: agent.id,
      permissions: JSON.parse(agent.permissions || '[]'),
      memoryLayer: JSON.parse(agent.memoryLayer || '[]'),
    } as any;
  }

  /**
   * Persists a message to an agent's memory for context reuse (SendMessage primitive).
   */
  async appendMemoryLayer(agentId: string, memory: string): Promise<void> {
    const agent = await this.getAgent(agentId);
    const currentMemory = [...(agent.memoryLayer || [])];
    currentMemory.push({
      role: 'system',
      content: memory,
      timestamp: Date.now()
    });

    await this.ctx.push(
      {
        type: 'update',
        table: 'agents',
        where: [{ column: 'id', value: agentId }],
        values: {
          memoryLayer: JSON.stringify(currentMemory),
          lastActive: Date.now(),
        },
        layer: 'infrastructure',
      },
      agentId
    );
  }

  async spawnTask(
    taskId: string,
    agentId: string,
    description: string,
    linkedKnowledgeIds?: string[]
  ): Promise<void> {
    await this.ctx.push(
      {
        type: 'insert',
        table: 'tasks',
        values: {
          id: taskId,
          userId: this.ctx.userId,
          agentId,
          status: 'pending',
          description,
          linkedKnowledgeIds: JSON.stringify(linkedKnowledgeIds || []),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        layer: 'domain',
      },
      agentId
    );
  }

  async updateTaskStatus(taskId: string, status: TaskItem['status'], result?: any): Promise<void> {
    const updatePayload: any = {
      status,
      updatedAt: Date.now(),
    };
    if (result !== undefined) {
      updatePayload.result = JSON.stringify(result);
    }
    await this.ctx.push({
      type: 'update',
      table: 'tasks',
      where: [{ column: 'id', value: taskId }],
      values: updatePayload,
      layer: 'domain',
    });
  }

  async getTask(taskId: string): Promise<TaskItem> {
    const row = await this.ctx.db.selectOne('tasks', [{ column: 'id', value: taskId }]);
    if (!row) throw new AgentGitError(`Task ${taskId} not found`, 'FILE_NOT_FOUND');
    return {
      ...row,
      taskId: row.id,
      linkedKnowledgeIds: JSON.parse(row.linkedKnowledgeIds || '[]'),
      result: row.result ? JSON.parse(row.result) : undefined,
    } as any;
  }

  async getTaskContext(taskId: string): Promise<TaskContext> {
    const task = await this.getTask(taskId);
    const resolvedGraph: KnowledgeBaseItem[] = [];

    if (task.linkedKnowledgeIds && task.linkedKnowledgeIds.length > 0) {
      const graphPromises = task.linkedKnowledgeIds.map((kbId) =>
        this.graph.traverseGraph(kbId, 2)
      );
      const nestedResults = await Promise.all(graphPromises);

      const seen = new Set<string>();
      for (const results of nestedResults) {
        for (const item of results) {
          if (!seen.has(item.itemId)) {
            seen.add(item.itemId);
            resolvedGraph.push(item);
          }
        }
      }
    }

    return { task, resolvedGraph };
  }
}
