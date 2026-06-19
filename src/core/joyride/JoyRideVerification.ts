/**
 * [LAYER: CORE]
 * Verification proof helpers — strict reuse semantics.
 */

import type { JoyRideCache } from "./JoyRideCache"
import { buildJoyRideWorkspaceSnapshot, type JoyRideTaskScope } from "./JoyRideContext"
import { type JoyRideCacheDecision, missDecision } from "./JoyRideDecisions"
import { lookupVerificationProof } from "./JoyRideHotPath"
import { JOYRIDE_REASON } from "./JoyRideReasonCodes"
import { createVerificationCacheKey } from "./keys"
import type { JoyRideValidationFingerprint } from "./types"

export interface VerificationProofInput {
	command: string
	cwd: string
	relevantFileHashes: Record<string, string>
	approvalBoundaryId: string
	gitHead?: string
	dependencyFingerprint?: string
	lockfileFingerprint?: string
	environmentFingerprint?: string
	runtimeVersion?: string
	toolVersion?: string
}

export function buildVerificationFingerprint(input: VerificationProofInput): { key: string; fingerprint: string } {
	return createVerificationCacheKey({
		command: input.command,
		cwd: input.cwd,
		relevantFileHashes: input.relevantFileHashes,
		approvalBoundaryId: input.approvalBoundaryId,
		gitHead: input.gitHead ?? "",
		dependencyFingerprint: input.dependencyFingerprint ?? "",
		lockfileFingerprint: input.lockfileFingerprint ?? "",
		environmentFingerprint: input.environmentFingerprint ?? "",
		runtimeVersion: input.runtimeVersion ?? process.version,
		toolVersion: input.toolVersion ?? "lumi-verification-v1",
	})
}

export function validateVerificationProof(proof: JoyRideValidationFingerprint): { valid: boolean; missing: string[] } {
	const missing: string[] = []
	if (!proof.relevantFileHashes || Object.keys(proof.relevantFileHashes).length === 0) {
		missing.push("relevantFileHashes")
	}
	if (!proof.workspaceFingerprint) missing.push("workspaceFingerprint")
	if (!proof.approvalBoundaryId) missing.push("approvalBoundaryId")
	if (!proof.gitHead) missing.push("gitHead")
	if (!proof.dependencyFingerprint) missing.push("dependencyFingerprint")
	if (!proof.lockfileFingerprint) missing.push("lockfileFingerprint")
	if (!proof.environmentFingerprint) missing.push("environmentFingerprint")
	if (!proof.runtimeVersion) missing.push("runtimeVersion")
	if (!proof.toolVersion) missing.push("toolVersion")
	return { valid: missing.length === 0, missing }
}

export function explainVerificationMiss(proof: JoyRideValidationFingerprint): JoyRideCacheDecision {
	const { missing } = validateVerificationProof(proof)
	if (missing.includes("relevantFileHashes")) {
		return missDecision(JOYRIDE_REASON.MISS_VERIFICATION_MISSING_FILE_HASHES, "Missing relevant file hashes")
	}
	return missDecision(JOYRIDE_REASON.MISS_VERIFICATION_INCOMPLETE_PROOF, `Incomplete proof: ${missing.join(", ")}`)
}

export async function lookupVerificationProofWithExplain(
	cache: JoyRideCache,
	command: string,
	scope: JoyRideTaskScope,
	relevantFileHashes: Record<string, string>,
) {
	const snapshot = await buildJoyRideWorkspaceSnapshot(scope.cwd, scope.terminalMode)
	const proof: JoyRideValidationFingerprint = {
		relevantFileHashes,
		workspaceFingerprint: snapshot.workspaceFingerprint,
		approvalBoundaryId: scope.approvalBoundaryId,
		generation: scope.generation,
		gitHead: snapshot.gitHead,
		dependencyFingerprint: snapshot.dependencyFingerprint,
		lockfileFingerprint: snapshot.lockfileFingerprint,
		environmentFingerprint: snapshot.environmentFingerprint,
		runtimeVersion: process.version,
		toolVersion: "lumi-verification-v1",
	}
	const validation = validateVerificationProof(proof)
	if (!validation.valid) {
		return explainVerificationMiss(proof)
	}
	return lookupVerificationProof(cache, command, scope, snapshot, relevantFileHashes)
}
