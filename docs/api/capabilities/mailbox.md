# Mailbox Capability

## Purpose
Inter-agent messaging and status broadcasting.

## Methods
| Method | Input | Output |
|--------|-------|--------|
| `postMessage` | `MailboxPostMessageInput` | `MailboxPostMessageResult` |
| `postStatus` | `MailboxPostStatusInput` | `MailboxPostStatusResult` |
| `pollInbox` | `MailboxPollInboxInput` | `MailboxPollInboxResult` |
| `clear` | — | `MailboxClearResult` |
| `health` | — | `Promise<CapabilityHealth>` |

## Errors
- `LifecycleStateError`
- `AgentGitError` (`INVALID_ARGUMENT`) — missing to/from/agentId

## Lifecycle
Requires `await ctx.start()`.

## Example
```ts
await ctx.mailbox.postMessage({
  to: 'agent-2',
  from: 'agent-1',
  type: 'task_update',
  payload: { status: 'complete' },
});
const { messages } = await ctx.mailbox.pollInbox({ agentId: 'agent-2' });
```
