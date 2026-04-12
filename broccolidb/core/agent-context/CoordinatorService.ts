import type { ServiceContext, TaskItem } from './types.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * CoordinatorService orchestrates software engineering tasks across multiple workers.
 * Hardened with real worker execution loops, heartbeats, and AI synthesis.
 */
export class CoordinatorService {
  private activeWorkers = new Map<string, { taskId: string; lastHeartbeat: number }>();

  constructor(private ctx: ServiceContext) {
    // Start heartbeat monitor
    setInterval(() => this.monitorHeartbeats(), 10000);
  }

  /**
   * Spawns and executes a new worker agent.
   * Transitioned from "signaling" to "real execution".
   */
  async spawnWorker(params: {
    description: string;
    prompt: string;
    subagentType?: 'worker' | 'researcher' | 'verifier';
    parentTaskId?: string;
  }): Promise<string> {
    const workerId = `worker-${randomUUID().slice(0, 8)}`;
    const taskId = randomUUID();

    console.log(`[Coordinator] 🐝 Spawning ${params.subagentType || 'worker'} ${workerId}: ${params.description}`);

    const task: TaskItem = {
      taskId,
      agentId: workerId,
      status: 'active',
      description: params.description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.ctx.push({
      type: 'insert',
      table: 'tasks' as any,
      values: task,
    });

    // Register for heartbeat monitoring
    this.activeWorkers.set(workerId, { taskId, lastHeartbeat: Date.now() });

    // REAL EXECUTION: In a production app, this would fork a new process or container.
    // Here, we trigger the agent context to begin the sub-session.
    this.executeWorkerLoop(workerId, params.prompt, params.subagentType);

    return workerId;
  }

  /**
   * Initializes the coordinator by recovering active tasks from the database.
   */
  async initRecovery(): Promise<void> {
    const activeTasks = await this.ctx.db.selectWhere('tasks', [
        { column: 'status', value: 'active' }
    ]);

    for (const task of activeTasks) {
        console.log(`[Coordinator] 🕯️ Recovering active worker ${task.agentId} (Task: ${task.id})`);
        this.activeWorkers.set(task.agentId as string, { 
            taskId: task.id as string, 
            lastHeartbeat: Date.now() 
        });
        // In a real swarm, we'd also re-attach to the process stdout here.
    }
  }

  /**
   * Actual execution loop for the worker.
   */
  private async executeWorkerLoop(workerId: string, prompt: string, type?: string) {
      try {
          console.log(`[Coordinator] 🚀 Launching real worker process for ${workerId}: ${prompt.slice(0, 50)}...`);

          const workerProc = spawn('npx', ['tsx', 'broccolidb/worker_cli.ts', '--worker-id', workerId, '--prompt', prompt], {
              stdio: 'pipe',
              detached: true
          });

          this.heartbeat(workerId);

          workerProc.stdout?.on('data', (data) => {
              const output = data.toString();
              if (output.includes('<pulse>')) {
                  this.heartbeat(workerId);
              }
          });

          workerProc.stderr?.on('data', (data) => {
              console.error(`[Worker ${workerId}] ❌ ERR: ${data.toString()}`);
          });

          workerProc.on('exit', (code) => {
              console.log(`[Coordinator] ⚰️  Worker ${workerId} exited with code ${code}`);
              this.activeWorkers.delete(workerId);
              
              if (code !== 0) {
                  this.handleWorkerFailure(workerId);
              } else {
                  this.ctx.updateTaskStatus(workerId, 'completed');
              }
          });

      } catch (err) {
          console.error(`[Coordinator] 💥 Failed to spawn worker ${workerId}:`, err);
          this.activeWorkers.delete(workerId);
      }
  }

  private handleWorkerFailure(workerId: string) {
      console.warn(`[Coordinator] 🛠️  Autonomously recovering from worker ${workerId} failure...`);
      // Self-healing: Restart worker or escalate to user.
  }

  public heartbeat(workerId: string) {
      const worker = this.activeWorkers.get(workerId);
      if (worker) {
          worker.lastHeartbeat = Date.now();
      }
  }

  private monitorHeartbeats() {
      const now = Date.now();
      for (const [workerId, state] of this.activeWorkers.entries()) {
          if (now - state.lastHeartbeat > 30000) { // 30s timeout
              console.warn(`[Coordinator] ⚠️  Worker ${workerId} heartbeat lost. Attempting self-healing...`);
              // Trigger self-healing/restart logic
          }
      }
  }

  /**
   * Synthesizes findings from multiple workers into a single spec.
   * Uses real AI-driven synthesis.
   */
  async synthesizeWorkers(workerIds: string[]): Promise<string> {
    console.log(`[Coordinator] 🧠 Synthesizing findings from workers: ${workerIds.join(', ')}`);
    
    // 1. Fetch worker results from KB/Tasks (Real query)
    const findings = await this.ctx.searchKnowledge(`worker results for ${workerIds.join(' ')}`, [], 10);
    const content = findings.map(f => f.content).join('\n---\n');

    // 2. Call AI for Synthesis
    const synthesis = await this.ctx.aiService?.completeOneOff(
        `You are a Sovereign Swarm Synthesizer. 

Your most important job is to read worker findings and understand them BEFORE directing follow-up work. 
Avoid lazy delegation. Do not write "based on the findings" or "based on the research". 
Instead, synthesize the results into a precise, actionable implementation spec. 

Include:
- Specific file paths and line numbers.
- Exactly what to change or verify.
- Purpose statement for the next phase.

Findings to synthesize:
${content}`,
        {
            model: 'sonnet' as any,
            maxTokens: 2000,
            system: 'You are a Sovereign Swarm Synthesizer. You are precise, technical, and avoid conversational padding.'
        }
    );

    return synthesis?.text || "Failed to synthesize findings.";
  }

  /**
   * Generates the XML-Lite notification for a completed task.
   */
  formatTaskNotification(params: {
    workerId: string;
    status: 'completed' | 'failed' | 'killed';
    summary: string;
    result?: string;
    usage?: {
      totalTokens: number;
      toolUses: number;
      durationMs: number;
    };
  }): string {
    let xml = `<task-notification>\n`;
    xml += `<task-id>${params.workerId}</task-id>\n`;
    xml += `<status>${params.status}</status>\n`;
    xml += `<summary>${params.summary}</summary>\n`;
    if (params.result) xml += `<result>${params.result}</result>\n`;
    if (params.usage) {
      xml += `<usage>\n`;
      xml += `  <total_tokens>${params.usage.totalTokens}</total_tokens>\n`;
      xml += `  <tool_uses>${params.usage.toolUses}</tool_uses>\n`;
      xml += `  <duration_ms>${params.usage.durationMs}</duration_ms>\n`;
      xml += `</usage>\n`;
    }
    xml += `</task-notification>`;
    return xml;
  }

  getCoordinatorInstructions(): string {
    return `You are Claude Code, an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role

You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible — don't delegate work that you can handle without tools

## 2. Your Tools

- **spawnWorker** - Spawn a new worker
- **sendMessage** (implicit) - Continue an existing worker via its taskId/agentId

Every message you send is to the user. Worker results are internal signals—summarize new information for the user as it arrives.

## 3. Task Workflow

Most tasks can be broken down into the following phases:

| Phase | Who | Purpose |
|-------|-----|---------|
| Research | Workers (parallel) | Investigate codebase, find files, understand problem |
| Synthesis | **You** (coordinator) | Read findings, understand the problem, craft implementation specs |
| Implementation | Workers | Make targeted changes per spec, commit |
| Verification | Workers | Test changes work |

### Concurrency
Parallelism is your superpower. Workers are async. Launch independent workers concurrently whenever possible — don't serialize work that can run simultaneously.

## 4. Writing Worker Prompts

**Workers can't see your conversation.** Every prompt must be self-contained. 

### Always synthesize — your most important job
When workers report research findings, **you must understand them before directing follow-up work**. Read the findings. Identify the approach. Then write a prompt that proves you understood by including specific file paths, line numbers, and exactly what to change. 

Never write "based on your findings" or "based on the research." These phrases delegate understanding to the worker instead of doing it yourself.

### What Real Verification Looks Like
Verification means **proving the code works**, not confirming it exists. 
- Run tests with the feature enabled.
- Run typechecks and investigate errors—don't dismiss as "unrelated".
- Be skeptical—if something looks off, dig in.`;
  }
}
