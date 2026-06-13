import type { DietCodeMessage } from "@shared/ExtensionMessage"
import { type AuditMessageSnapshot, messageCarriesAuditMetadata, resolveAuditSource } from "./auditMessages"

/** Finds message index for scroll-to-audit navigation — matches ts + source when possible. */
export function findMessageIndexForAuditTs(messages: DietCodeMessage[], ts: number): number {
	return messages.findIndex((message) => message.ts === ts && messageCarriesAuditMetadata(message))
}

/** Resolves chat message index for a specific audit snapshot — SonarQube issue navigation pattern. */
export function findAuditMessageIndex(
	messages: DietCodeMessage[],
	snapshot: Pick<AuditMessageSnapshot, "ts" | "source">,
): number {
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i]
		if (!messageCarriesAuditMetadata(message) || !message.auditMetadata) {
			continue
		}
		const source = resolveAuditSource(message)
		if (message.ts === snapshot.ts && source === snapshot.source) {
			return i
		}
	}
	return findMessageIndexForAuditTs(messages, snapshot.ts)
}
