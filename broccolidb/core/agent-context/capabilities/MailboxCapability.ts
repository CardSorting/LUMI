// [LAYER: CORE]
// @classification CAPABILITY
import type { MailboxService } from '../MailboxService.js';
import { CapabilityBase } from '../CapabilityBase.js';
import type { IntentTracer } from '../IntentTracer.js';
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
  readonly name = 'mailbox' as const;
  readonly dependencies = ['MailboxService'] as const;

  constructor(
    private readonly mailboxService: MailboxService,
    assertStarted: (operation: string) => void,
    isStarted: () => boolean,
    intentTracer: IntentTracer
  ) {
    super(assertStarted, isStarted, intentTracer);
  }

  async postMessage(input: MailboxPostMessageInput): Promise<MailboxPostMessageResult> {
    return this.execute(
      'postMessage',
      async () => {
        await this.mailboxService.postMessage(
          requireNonEmptyString(input.to, 'to'),
          requireNonEmptyString(input.from, 'from'),
          input.type,
          input.payload
        );
        return { posted: true };
      },
      {
        input,
        inputSummary: { to: input.to, from: input.from, type: input.type },
        expectedEffects: ['MailboxService.postMessage'],
        durability: 'ephemeral',
      }
    );
  }

  async postStatus(input: MailboxPostStatusInput): Promise<MailboxPostStatusResult> {
    return this.execute(
      'postStatus',
      async () => {
        await this.mailboxService.postStatus(
          requireNonEmptyString(input.agentId, 'agentId'),
          requireNonEmptyString(input.status, 'status')
        );
        return { posted: true };
      },
      {
        input,
        inputSummary: { agentId: input.agentId, status: input.status },
        expectedEffects: ['MailboxService.postStatus'],
        durability: 'ephemeral',
      }
    );
  }

  async pollInbox(input: MailboxPollInboxInput): Promise<MailboxPollInboxResult> {
    return this.execute(
      'pollInbox',
      async () => ({
        messages: await this.mailboxService.pollInbox(requireNonEmptyString(input.agentId, 'agentId')),
      }),
      {
        input,
        inputSummary: { agentId: input.agentId },
        expectedEffects: ['MailboxService.pollInbox'],
        durability: 'ephemeral',
        summarizeResult: (result) => ({ messageCount: result.messages.length }),
      }
    );
  }

  clear(): MailboxClearResult {
    return this.run(
      'clear',
      () => {
        this.mailboxService.clear();
        return { cleared: true };
      },
      { expectedEffects: ['MailboxService.clear'], durability: 'ephemeral' }
    );
  }
}
