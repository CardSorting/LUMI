import type { GateLifecycleState } from "./completionLifecycle"
import type { GateReasonCode } from "./gateReasonCodes"

export interface GateLifecycleTransitionRecord {
	state: GateLifecycleState
	reasonCode: GateReasonCode
	at: number
}

export function parseLifecycleTransitionLog(raw?: string): GateLifecycleTransitionRecord[] {
	if (!raw) {
		return []
	}
	try {
		const parsed = JSON.parse(raw) as GateLifecycleTransitionRecord[]
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

export function appendLifecycleTransitionLog(
	raw: string | undefined,
	record: GateLifecycleTransitionRecord,
	maxEntries = 50,
): string {
	const log = parseLifecycleTransitionLog(raw)
	const last = log[log.length - 1]
	if (last?.state === record.state && last?.reasonCode === record.reasonCode) {
		return raw ?? JSON.stringify(log)
	}
	log.push(record)
	return JSON.stringify(log.slice(-maxEntries))
}
