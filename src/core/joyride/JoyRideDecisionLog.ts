/**
 * [LAYER: CORE]
 * Bounded in-process JoyRide decision log for no-UI diagnostics.
 */

import type { JoyRideCacheDecision } from "./JoyRideDecisions"

const MAX_DECISION_LOG = 128
const decisionLog: JoyRideCacheDecision[] = []

export function recordJoyRideDecision(decision: JoyRideCacheDecision): void {
	decisionLog.push(decision)
	if (decisionLog.length > MAX_DECISION_LOG) {
		decisionLog.splice(0, decisionLog.length - MAX_DECISION_LOG)
	}
}

export function getJoyRideDecisionLog(limit = 32): readonly JoyRideCacheDecision[] {
	return decisionLog.slice(-limit)
}

export function getLastJoyRideDecision(): JoyRideCacheDecision | undefined {
	return decisionLog[decisionLog.length - 1]
}

export function explainJoyRideDecision(auditEventId: string): JoyRideCacheDecision | undefined {
	return decisionLog.find((d) => d.auditEventId === auditEventId)
}

export function clearJoyRideDecisionLog(): void {
	decisionLog.length = 0
}
