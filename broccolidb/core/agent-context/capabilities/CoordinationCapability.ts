// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService } from '../MailboxService.js';
import type { ServiceContext } from '../types.js';

export class CoordinationCapability {
  private readonly teammates = new Set<string>();

  constructor(
    private readonly serviceContext: ServiceContext,
    private setMailbox: (mailbox: MailboxService) => void
  ) {}

  registerTeammate(agentId: string): void {
    this.teammates.add(agentId);
  }

  getTeammates(): string[] {
    return Array.from(this.teammates);
  }

  setSharedMailbox(mailbox: MailboxService): void {
    this.setMailbox(mailbox);
    this.serviceContext.mailbox = mailbox;
  }
}
