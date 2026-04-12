import type { ServiceContext } from './types.js';

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: 'vibe' | 'audit' | 'error' | 'permission_request' | 'permission_response';
  payload: any;
  timestamp: number;
  read: boolean;
}

/**
 * MailboxService provides decentralized inter-agent communication.
 * Absorbed from src/utils/teammateMailbox.ts.
 */
export class MailboxService {
  private _messages: MailboxMessage[] = [];

  constructor(private ctx: ServiceContext) {}

  /**
   * Posts a message to a specific agent's mailbox.
   */
  async postMessage(to: string, from: string, type: MailboxMessage['type'], payload: any): Promise<void> {
    const msg: MailboxMessage = {
      id: Math.random().toString(36).substring(7),
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
      read: false,
    };
    this._messages.push(msg);
    console.log(`[Mailbox] Message from ${from} to ${to}: ${type}`);
  }

  /**
   * Helper to post a status notification.
   */
  async postStatus(agentId: string, status: string): Promise<void> {
    await this.postMessage('system', agentId, 'vibe', { status });
  }

  /**
   * Polls unread messages for a specific agent.
   */
  async pollInbox(agentId: string): Promise<MailboxMessage[]> {
    const unread = this._messages.filter((m) => m.to === agentId && !m.read);
    for (const m of unread) {
        m.read = true;
    }
    return unread;
  }

  /**
   * Clears the mailbox for a session.
   */
  clear(): void {
    this._messages = [];
  }
}
