import { createHash } from "node:crypto"
import type { ExecutionReplayArtifact } from "@shared/execution/replayContract"
import type { GovernedSwarmReceipt } from "@shared/subagent/governedExecution"
import { verifyReplayArtifact } from "./executionReplayMappers"

export interface ReplayValidationResult {
	valid: boolean
	deterministicChecksum: string
	violations: string[]
}

/**
 * Deterministic replay validation — same inputs must produce same checksum.
 */
export function validateDeterministicReplay(
	receipt: GovernedSwarmReceipt,
	replayArtifact: ExecutionReplayArtifact,
): ReplayValidationResult {
	const violations: string[] = []
	const replayCheck = verifyReplayArtifact(replayArtifact)

	if (!replayCheck.valid) {
		violations.push(...replayCheck.violations)
	}

	if (receipt.swarmId !== replayArtifact.artifactId) {
		violations.push(`swarm id mismatch: receipt=${receipt.swarmId} artifact=${replayArtifact.artifactId}`)
	}

	if (receipt.taskId !== replayArtifact.taskId) {
		violations.push(`task id mismatch: receipt=${receipt.taskId} artifact=${replayArtifact.taskId}`)
	}

	const laneCount = receipt.laneReceipts.length
	const artifactAgentCount = replayArtifact.lineage.filter((node) => node.extension?.agentId).length
	if (laneCount > 0 && artifactAgentCount > 0 && artifactAgentCount < laneCount) {
		violations.push(`lane count mismatch: receipt=${laneCount} artifact=${artifactAgentCount}`)
	}

	const canonical = JSON.stringify({
		swarmId: receipt.swarmId,
		executionId: receipt.executionId,
		taskId: receipt.taskId,
		admission: receipt.admission,
		laneReceipts: receipt.laneReceipts.map((lane) => ({
			laneId: lane.laneId,
			agentId: lane.agentId,
			index: lane.index,
			status: lane.status,
			evidenceCount: lane.evidenceCount,
			touchedFiles: [...lane.touchedFiles].sort(),
		})),
		mergePassed: receipt.mergeGate?.passed,
		replayArtifactId: replayArtifact.artifactId,
		replayStatus: replayArtifact.status,
	})

	const deterministicChecksum = createHash("sha256").update(canonical).digest("hex")

	if (receipt.replayChecksum && receipt.replayChecksum !== deterministicChecksum) {
		violations.push("replay checksum mismatch — non-deterministic state detected")
	}

	return {
		valid: violations.length === 0,
		deterministicChecksum,
		violations,
	}
}

/** Human-readable causes for operator console / runbook. */
export function explainReplayMismatch(violations: string[]): string[] {
	return violations.map((violation) => {
		if (violation.includes("replay checksum mismatch")) {
			return "Stored replay checksum does not match recomputed canonical state — receipt or artifact was mutated."
		}
		if (violation.includes("swarm id mismatch")) {
			return "Swarm receipt and replay artifact reference different swarm IDs."
		}
		if (violation.includes("task id mismatch")) {
			return "Task ID drift between receipt and replay artifact."
		}
		if (violation.includes("lane count mismatch")) {
			return "Lane receipt count does not match replay artifact lineage."
		}
		return violation
	})
}
