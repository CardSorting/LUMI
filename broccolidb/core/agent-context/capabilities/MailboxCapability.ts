// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService, MailboxMessage } from '../MailboxService.js';
import { capabilityHealth, type CapabilityHealth } from '../capability-health.js';

export class MailboxCapability {
  constructor(
    private readonly mailboxService: MailboxService,
    private readonly assertOperational: (operation: string) => void,
    private readonly isStarted: () => boolean
  ) {}

  health(): CapabilityHealth {
    return capabilityHealth('mailbox', this.isStarted(), ['MailboxService']);
  }

  async postMessage(
    to: string,
    from: string,
    type: MailboxMessage['type'],
    payload: unknown
  ): Promise<void> {
    this.assertOperational('mailbox.postMessage');
    return this.mailboxService.postMessage(to, from, type, payload);
  }

  async postStatus(agentId: string, status: string): Promise<void> {
    this.assertOperational('mailbox.postStatus');
    return this.mailboxService.postStatus(agentId, status);
  }

  async pollInbox(agentId: string): Promise<MailboxMessage[]> {
    this.assertOperational('mailbox.pollInbox');
    return this.mailboxService.pollInbox(agentId);
  }

  clear(): void {
    this.assertOperational('mailbox.clear');
    this.mailboxService.clear();
  }
}
