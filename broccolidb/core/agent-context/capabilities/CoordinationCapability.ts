// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService } from '../MailboxService.js';
import type { MutexService } from '../MutexService.js';
import type { CoordinatorService } from '../CoordinatorService.js';
import { AgentGitError } from '../../errors.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type CoordinationAcquireLockInput,
  type CoordinationAcquireLockResult,
  type CoordinationRegisterTeammateInput,
  type CoordinationRegisterTeammateResult,
  type CoordinationReleaseLockInput,
  type CoordinationReleaseLockResult,
  type CoordinationSpawnWorkerInput,
  type CoordinationSpawnWorkerResult,
  type CoordinationSynthesizeWorkersInput,
  type CoordinationSynthesizeWorkersResult,
  type CoordinationTeammatesResult,
} from '../capability-types.js';

export class CoordinationCapability extends CapabilityBase {
  readonly name = 'coordination';
  readonly dependencies = ['MutexService', 'CoordinatorService'] as const;

  private readonly teammates = new Set<string>();

  constructor(
    private readonly mutexService: MutexService,
    private readonly coordinatorService: CoordinatorService,
    private readonly setMailbox: (mailbox: MailboxService) => void,
    private readonly updateMailboxContext: (mailbox: MailboxService) => void,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  registerTeammate(input: CoordinationRegisterTeammateInput): CoordinationRegisterTeammateResult {
    return this.run('registerTeammate', () => {
      const agentId = requireNonEmptyString(input.agentId, 'agentId');
      this.teammates.add(agentId);
      return { registered: true, agentId };
    });
  }

  getTeammates(): CoordinationTeammatesResult {
    return this.run('getTeammates', () => ({ teammates: Array.from(this.teammates) }));
  }

  setSharedMailbox(mailbox: MailboxService): { shared: true } {
    return this.run('setSharedMailbox', () => {
      this.setMailbox(mailbox);
      this.updateMailboxContext(mailbox);
      return { shared: true };
    });
  }

  async acquireLock(input: CoordinationAcquireLockInput): Promise<CoordinationAcquireLockResult> {
    return this.execute('acquireLock', async () => {
      const token = await this.mutexService.acquireLock(requireNonEmptyString(input.resource, 'resource'));
      return { acquired: token !== null, token };
    });
  }

  async releaseLock(input: CoordinationReleaseLockInput): Promise<CoordinationReleaseLockResult> {
    return this.execute('releaseLock', async () => {
      await this.mutexService.releaseLock(requireNonEmptyString(input.resource, 'resource'));
      return { released: true };
    });
  }

  async spawnWorker(input: CoordinationSpawnWorkerInput): Promise<CoordinationSpawnWorkerResult> {
    return this.execute('spawnWorker', async () => {
      const workerId = await this.coordinatorService.spawnWorker({
        description: requireNonEmptyString(input.description, 'description'),
        prompt: requireNonEmptyString(input.prompt, 'prompt'),
        subagentType: input.subagentType,
        parentTaskId: input.parentTaskId,
      });
      return { workerId };
    });
  }

  async synthesizeWorkers(
    input: CoordinationSynthesizeWorkersInput
  ): Promise<CoordinationSynthesizeWorkersResult> {
    return this.execute('synthesizeWorkers', async () => {
      if (!Array.isArray(input.workerIds) || input.workerIds.length === 0) {
        throw new AgentGitError('workerIds must be a non-empty array', 'INVALID_ARGUMENT');
      }
      const synthesis = await this.coordinatorService.synthesizeWorkers(input.workerIds);
      return { synthesis };
    });
  }
}
