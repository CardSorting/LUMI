// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService } from '../MailboxService.js';
import type { MutexService } from '../MutexService.js';
import type { CoordinatorService } from '../CoordinatorService.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class CoordinationCapability {
  private readonly teammates = new Set<string>();

  constructor(
    private readonly mutexService: MutexService,
    private readonly coordinatorService: CoordinatorService,
    private readonly setMailbox: (mailbox: MailboxService) => void,
    private readonly updateMailboxContext: (mailbox: MailboxService) => void,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('coordination', this.isStarted(), [
      'MutexService',
      'CoordinatorService',
    ]);
  }

  registerTeammate(agentId: string): void {
    this.assertOperational('coordination.registerTeammate');
    this.teammates.add(agentId);
  }

  getTeammates(): string[] {
    this.assertOperational('coordination.getTeammates');
    return Array.from(this.teammates);
  }

  setSharedMailbox(mailbox: MailboxService): void {
    this.assertOperational('coordination.setSharedMailbox');
    this.setMailbox(mailbox);
    this.updateMailboxContext(mailbox);
  }

  async acquireLock(resource: string): Promise<number | null> {
    this.assertOperational('coordination.acquireLock');
    return this.mutexService.acquireLock(resource);
  }

  async releaseLock(resource: string): Promise<void> {
    this.assertOperational('coordination.releaseLock');
    return this.mutexService.releaseLock(resource);
  }

  async spawnWorker(params: Parameters<CoordinatorService['spawnWorker']>[0]) {
    this.assertOperational('coordination.spawnWorker');
    return this.coordinatorService.spawnWorker(params);
  }

  async synthesizeWorkers(workerIds: string[]) {
    this.assertOperational('coordination.synthesizeWorkers');
    return this.coordinatorService.synthesizeWorkers(workerIds);
  }
}
