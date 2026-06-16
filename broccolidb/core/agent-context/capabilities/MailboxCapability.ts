// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService, MailboxMessage } from '../MailboxService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import {
  requireNonEmptyString,
  type MailboxClearResult,
  type MailboxPollInboxInput,
  type MailboxPollInboxResult,
  type MailboxPostMessageInput,
  type MailboxPostMessageResult,
  type MailboxPostStatusInput,
  type MailboxPostStatusResult,
} from '../capability-types.js';

export class MailboxCapability extends CapabilityBase {
  readonly name = 'mailbox';
  readonly dependencies = ['MailboxService'] as const;

  constructor(
    private readonly mailboxService: MailboxService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean
  ) {
    super(assertStarted, isStarted);
  }

  async postMessage(input: MailboxPostMessageInput): Promise<MailboxPostMessageResult> {
    return this.execute('postMessage', async () => {
      await this.mailboxService.postMessage(
        requireNonEmptyString(input.to, 'to'),
        requireNonEmptyString(input.from, 'from'),
        input.type,
        input.payload
      );
      return { posted: true };
    });
  }

  async postStatus(input: MailboxPostStatusInput): Promise<MailboxPostStatusResult> {
    return this.execute('postStatus', async () => {
      await this.mailboxService.postStatus(
        requireNonEmptyString(input.agentId, 'agentId'),
        requireNonEmptyString(input.status, 'status')
      );
      return { posted: true };
    });
  }

  async pollInbox(input: MailboxPollInboxInput): Promise<MailboxPollInboxResult> {
    return this.execute('pollInbox', async () => ({
      messages: await this.mailboxService.pollInbox(requireNonEmptyString(input.agentId, 'agentId')),
    }));
  }

  clear(): MailboxClearResult {
    return this.run('clear', () => {
      this.mailboxService.clear();
      return { cleared: true };
    });
  }
}
