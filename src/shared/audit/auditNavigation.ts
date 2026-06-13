import type { DietCodeMessage } from "@shared/ExtensionMessage"

/** Finds message index for scroll-to-audit navigation in chat history. */
export function findMessageIndexForAuditTs(messages: DietCodeMessage[], ts: number): number {
	return messages.findIndex((message) => message.ts === ts)
}
