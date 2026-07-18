import type { DietCodeMessage } from "@shared/ExtensionMessage"
import type { CompletionFunnelEvent } from "./completionFunnelEvent"
import { getTerminalCompletionEvidence } from "./taskCompletionEvidence"

export interface ResolvedCompletionFunnelSnapshot {
	event?: CompletionFunnelEvent
	terminalCompletion: boolean
	sourceMessageTs?: number
}

/**
 * Selects one complete funnel event. No fields are merged across messages, so
 * an older pending observation can never compete with a newer terminal event.
 */
export function resolveCompletionFunnelSnapshot(messages: readonly DietCodeMessage[]): ResolvedCompletionFunnelSnapshot {
	const terminalEvidence = getTerminalCompletionEvidence(messages)
	if (terminalEvidence) {
		for (let index = messages.length - 1; index >= 0; index--) {
			const event = messages[index].completionFunnelEvent
			if (event?.terminal) {
				return { event, terminalCompletion: true, sourceMessageTs: messages[index].ts }
			}
		}
		return {
			terminalCompletion: true,
			sourceMessageTs:
				terminalEvidence.messageIndex === undefined ? undefined : messages[terminalEvidence.messageIndex]?.ts,
		}
	}
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message.completionFunnelEvent) {
			return {
				event: message.completionFunnelEvent,
				terminalCompletion: message.completionFunnelEvent.terminal,
				sourceMessageTs: message.ts,
			}
		}
	}
	return { terminalCompletion: false }
}
