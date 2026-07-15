import { strict as assert } from "node:assert"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type { ConfidenceProbeHistoryEntry, GovernedSwarmReceipt, LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import { GOVERNED_RECEIPT_SCHEMA_VERSION } from "@shared/subagent/governedExecution"
import { describe, it } from "mocha"
import {
	buildConfidenceRetryFingerprint,
	computeEvidenceDelta,
	evaluateConfidenceAwareConvergence,
	isConfidencePlateau,
	shouldSuppressConfidenceOnlyRetry,
} from "../ConfidenceAwareConvergence"
import { swarmEnvelopeToReplayArtifact } from "../executionReplayMappers"
import { validateGovernedReceipt } from "../GovernedExecutionStore"
import { runMergeGate } from "../MergeGate"
import { SubagentEnvelopeBuilder } from "../SubagentEnvelopeBuilder"

function agent(
	id: string,
	index: number,
	result: string,
	overrides?: Partial<SubagentExecutionEnvelope>,
): SubagentExecutionEnvelope {
	const builder = new SubagentEnvelopeBuilder(
		id,
		`exec-${id}`,
		"researcher",
		"swarm-confidence",
		"task-1",
		"Explore the best possible interpretation",
		{
			swarmId: "swarm-confidence",
			index,
			depth: 1,
		},
	)
	builder.setStatus("running")
	builder.recordToolStep("read_file", `read ${id}`, `evidence for ${id}`, { path: `src/${id}.ts` })
	builder.complete(result)
	return { ...builder.build(), ...overrides }
}

function lane(agentId: string, index: number, overrides?: Partial<LaneExecutionReceipt>): LaneExecutionReceipt {
	return {
		laneId: `swarm-lane:swarm-confidence:${index}`,
		agentId,
		index,
		status: "completed",
		executionValidity: "valid",
		findingConfidence: "high",
		confidenceReason: "direct_evidence",
		claimReleased: true,
		evidenceCount: 1,
		touchedFiles: [],
		toolStepCount: 1,
		sealedAt: Date.now(),
		executionMode: "read_only",
		lockRequired: false,
		...overrides,
	}
}

function probeHistory(claimId: string, overrides?: Partial<ConfidenceProbeHistoryEntry>): ConfidenceProbeHistoryEntry {
	const assignment = `Verify ${claimId}`
	const fingerprint = buildConfidenceRetryFingerprint({
		assignment,
		evidenceRefs: [],
		principalClaims: [claimId],
		confidenceReason: "model_uncertainty",
		toolSequence: [],
	})
	return {
		probeId: `probe-${Math.random()}`,
		claimId,
		question: assignment,
		sourceLaneIds: ["swarm-lane:swarm-confidence:0"],
		reason: "critical_claim_unverified",
		attempt: 1,
		launchedAt: 1,
		completedAt: 2,
		evidenceRefs: [],
		evidenceDelta: [],
		principalClaims: [claimId],
		findingConfidence: "unknown",
		confidenceReason: "model_uncertainty",
		toolSequence: [],
		fingerprint,
		status: "exhausted",
		confidencePlateau: false,
		...overrides,
	}
}

function swarm(agents: SubagentExecutionEnvelope[]): SwarmExecutionEnvelope {
	return {
		swarmId: "swarm-confidence",
		executionId: "exec-swarm",
		taskId: "task-1",
		continuity: {
			swarmId: "swarm-confidence",
			taskId: "task-1",
			resumeToken: "resume",
			lastPersistedAt: 1,
			completedAgents: agents.length,
			totalAgents: agents.length,
			status: "completed",
		},
		agents,
		blackboardSnapshot: [],
		timestamps: { started: 1, completed: 2 },
		status: "completed",
		invariants: { validated: true, violations: [] },
		artifactPath: "subagent_executions/swarm-confidence.json",
		schemaVersion: 1,
	}
}

function receipt(convergence?: GovernedSwarmReceipt["confidenceAwareConvergence"]): GovernedSwarmReceipt {
	return {
		schemaVersion: GOVERNED_RECEIPT_SCHEMA_VERSION,
		swarmId: "swarm-confidence",
		executionId: "exec-swarm",
		taskId: "task-1",
		attemptId: "attempt-1",
		admission: { admitted: true, backoffMs: 0 },
		laneReceipts: [],
		laneDag: [],
		claimHistory: [],
		mergeGate: {
			passed: true,
			mergeAudit: { safe: true, violations: [], overlappingPaths: [], missingEvidence: [], placeholderWarnings: [] },
			replayIntegrity: { valid: true, violations: [], checksum: "abc" },
			violations: [],
			failedLaneCount: 0,
			orphanedClaimCount: 0,
			staleLeaseCount: 0,
			splitBrainDetected: false,
			sealedSupersessionBlocked: false,
		},
		replayArtifactPath: "subagent_executions/swarm-confidence.json",
		governedArtifactPath: "subagent_executions/swarm-confidence.governed.attempt-1.json",
		sealedAt: 2,
		sealed: true,
		integrity: { valid: true, violations: [], checksum: "abc" },
		confidenceAwareConvergence: convergence,
	}
}

describe("confidence-aware convergence", () => {
	it("converges with uncertainty when every finding is tentative because the request is vague", () => {
		const agents = [
			agent("a", 0, "[confidence: low] [confidence_reason: underspecified_goal] A tentative option."),
			agent("b", 1, "[confidence: low] [confidence_reason: exploratory_hypothesis] Another hypothesis."),
		]
		const result = evaluateConfidenceAwareConvergence({ agents, laneReceipts: [lane("a", 0), lane("b", 1)] })

		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.acceptedFindings.length, 0)
		assert.equal(result.tentativeFindings.length, 2)
		assert.equal(result.diagnostics.confidenceOnlyRetriesSuppressed, 2)
	})

	it("keeps one weak lane tentative while accepting two strong lanes without veto or restart", () => {
		const agents = [
			agent("strong-a", 0, "Direct implementation evidence."),
			agent("weak", 1, "[confidence: low] This may be an edge case."),
			agent("strong-b", 2, "[confidence: medium] The evidence likely supports this."),
		]
		const result = evaluateConfidenceAwareConvergence({
			agents,
			laneReceipts: [lane("strong-a", 0), lane("weak", 1), lane("strong-b", 2)],
		})

		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.acceptedFindings.length, 2)
		assert.equal(result.tentativeFindings.length, 1)
		assert.equal(result.rejectedFindings.length, 0)
	})

	it("treats valid unknown results as an insufficient-evidence conclusion, not failed execution", () => {
		const agents = [
			agent("a", 0, "Unknown: insufficient evidence."),
			agent("b", 1, "Cannot determine from the source material."),
		]
		const result = evaluateConfidenceAwareConvergence({ agents, laneReceipts: [lane("a", 0), lane("b", 1)] })

		assert.equal(result.decision, "converge_with_uncertainty")
		assert.ok(result.tentativeFindings.every((finding) => finding.confidence === "unknown"))
		assert.equal(result.uncertaintySummary?.safeToProceed, true)
	})

	it("never probes or retries a low-confidence advisory finding", () => {
		const advisory = agent("advisory", 0, "[confidence: low] [criticality: advisory] Tentative observation.")
		const result = evaluateConfidenceAwareConvergence({ agents: [advisory], laneReceipts: [lane("advisory", 0)] })

		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.diagnostics.targetedProbesLaunched, 0)
		assert.equal(
			shouldSuppressConfidenceOnlyRetry({
				executionValidity: "valid",
				findingConfidence: "low",
				requiresCriticalVerification: false,
			}),
			true,
		)
	})

	it("launches one targeted probe for a critical mutation assumption and blocks only if no safe action remains", () => {
		const critical = agent(
			"mutation",
			0,
			"[confidence: low] [criticality: critical] This mutation may rely on an uncertain invariant.",
		)
		const mutationLane = lane("mutation", 0, {
			executionMode: "mutation",
			lockRequired: true,
			claimId: "claim-1",
			writeSet: ["src/mutation.ts"],
			touchedFiles: ["src/mutation.ts"],
		})
		const first = evaluateConfidenceAwareConvergence({ agents: [critical], laneReceipts: [mutationLane] })
		assert.equal(first.decision, "targeted_probe")
		assert.match(
			first.gateDecision.kind === "targeted_probe" ? first.gateDecision.question : "",
			/Verify this single critical claim/,
		)

		const exhausted = evaluateConfidenceAwareConvergence({
			agents: [critical],
			laneReceipts: [mutationLane],
			probeHistory: [probeHistory(first.tentativeFindings[0].id)],
		})
		assert.equal(exhausted.decision, "block_hard_failure")
		assert.equal(
			exhausted.gateDecision.kind === "block_hard_failure" ? exhausted.gateDecision.reason : "",
			"unsafe_under_all_interpretations",
		)

		const reversible = evaluateConfidenceAwareConvergence({
			agents: [critical],
			laneReceipts: [{ ...mutationLane, writeSet: [], touchedFiles: [] }],
			probeHistory: [probeHistory(first.tentativeFindings[0].id)],
		})
		assert.equal(reversible.decision, "converge_with_uncertainty")
	})

	it("detects a confidence plateau, suppresses repeated retries, and converges", () => {
		const tentative = agent("plateau", 0, "[confidence: low] [criticality: advisory] Still tentative.")
		const claimId = `swarm-lane:swarm-confidence:0:${tentative.structuredFindings[0].id}`
		const first = probeHistory(claimId)
		const second = probeHistory(claimId, { probeId: "probe-2", attempt: 2, fingerprint: first.fingerprint })
		const history = [first, second]
		assert.equal(isConfidencePlateau(history), true)

		const result = evaluateConfidenceAwareConvergence({
			agents: [tentative],
			laneReceipts: [lane("plateau", 0)],
			probeHistory: history,
		})
		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.confidencePlateau, true)
		assert.ok(result.diagnostics.events.includes("confidence_plateau"))
	})

	it("does not treat regenerated IDs for the same evidence as an evidence delta", () => {
		const source = {
			id: "source-id",
			kind: "file" as const,
			path: "src/gate.ts",
			label: "read gate",
			excerpt: "const ready = true",
			timestamp: 1,
		}
		const repeated = { ...source, id: "probe-id", timestamp: 2 }
		assert.deepEqual(computeEvidenceDelta([source], [repeated]), [])
		assert.equal(
			buildConfidenceRetryFingerprint({
				assignment: "Verify readiness",
				evidenceRefs: [source],
				principalClaims: ["The gate is ready"],
				confidenceReason: "direct_evidence",
				toolSequence: ["read_file"],
			}),
			buildConfidenceRetryFingerprint({
				assignment: "Verify readiness",
				evidenceRefs: [repeated],
				principalClaims: ["The gate is ready"],
				confidenceReason: "direct_evidence",
				toolSequence: ["read_file"],
			}),
		)
	})

	it("records an assumption split and preserves both valid findings", () => {
		const left = agent("left", 0, "[confidence: medium] Under assumption A, the feature is enabled.")
		const right = agent("right", 1, "[confidence: medium] Under assumption B, the feature is disabled.")
		left.structuredFindings = [
			{
				id: "left-claim",
				summary: "The feature is enabled.",
				severity: "info",
				source: "inferred",
				confidence: "medium",
				confidenceReason: "indirect_evidence",
				evidenceIds: [left.evidenceRefs[0].id],
				assumptions: ["Deployment uses configuration A"],
				decisionCriticality: "important",
				contradictsFindingIds: ["right-claim"],
			},
		]
		right.structuredFindings = [
			{
				id: "right-claim",
				summary: "The feature is disabled.",
				severity: "info",
				source: "inferred",
				confidence: "medium",
				confidenceReason: "indirect_evidence",
				evidenceIds: [right.evidenceRefs[0].id],
				assumptions: ["Deployment uses configuration B"],
				decisionCriticality: "important",
			},
		]
		const result = evaluateConfidenceAwareConvergence({
			agents: [left, right],
			laneReceipts: [lane("left", 0), lane("right", 1)],
		})

		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.acceptedFindings.length, 2)
		assert.equal(result.unresolvedContradictions[0]?.kind, "different_assumption")
		assert.ok(result.taskAmbiguityProfile.reasons.includes("multiple_valid_interpretations"))
	})

	it("normalizes analytical disagreement by timeframe instead of treating it as execution failure", () => {
		const current = agent("current", 0, "[confidence: medium] The feature is currently enabled.")
		const historical = agent("historical", 1, "[confidence: medium] The feature was historically disabled.")
		current.structuredFindings[0].contradictsFindingIds = [historical.structuredFindings[0].id]
		const result = evaluateConfidenceAwareConvergence({
			agents: [current, historical],
			laneReceipts: [lane("current", 0), lane("historical", 1)],
		})
		assert.equal(result.decision, "converge_with_uncertainty")
		assert.equal(result.unresolvedContradictions[0]?.kind, "different_timeframe")
		assert.equal(result.rejectedFindings.length, 0)
	})

	it("classifies analytical disagreement without blocking and reserves hard blocks for mutation conflicts", () => {
		const left = agent("scope-left", 0, "Direct finding for the API scope.")
		const right = agent("scope-right", 1, "Direct finding for the UI scope.")
		const findingIds = [
			`swarm-lane:swarm-confidence:0:${left.structuredFindings[0].id}`,
			`swarm-lane:swarm-confidence:1:${right.structuredFindings[0].id}`,
		]
		const analytical = evaluateConfidenceAwareConvergence({
			agents: [left, right],
			laneReceipts: [lane("scope-left", 0), lane("scope-right", 1)],
			contradictions: [
				{
					id: "different-scope",
					kind: "different_scope",
					findingIds,
					summary: "The lanes answered for different surfaces.",
					critical: false,
					resolved: false,
				},
			],
		})
		assert.equal(analytical.decision, "converge_with_uncertainty")
		assert.equal(analytical.acceptedFindings.length, 2)

		const mutationConflict = evaluateConfidenceAwareConvergence({
			agents: [left, right],
			laneReceipts: [lane("scope-left", 0), lane("scope-right", 1)],
			contradictions: [
				{
					id: "mutation-conflict",
					kind: "mutation_conflict",
					findingIds,
					summary: "Both lanes claim the same mutation authority.",
					critical: true,
					resolved: false,
				},
			],
		})
		assert.equal(mutationConflict.decision, "block_hard_failure")
		assert.equal(
			mutationConflict.gateDecision.kind === "block_hard_failure" ? mutationConflict.gateDecision.reason : "",
			"unreconciled_mutation_conflict",
		)
	})

	it("hard-blocks an invalid governed receipt even when findings are high confidence", () => {
		const strong = agent("strong", 0, "Direct high-confidence finding.")
		assert.equal(validateGovernedReceipt({ schemaVersion: 3, swarmId: "broken" }).valid, false)
		const result = evaluateConfidenceAwareConvergence({
			agents: [strong],
			laneReceipts: [lane("strong", 0)],
			hardFailureReason: "invalid_governed_receipt",
		})
		assert.equal(result.decision, "block_hard_failure")
	})

	it("allows a valid governed receipt with low-confidence findings to converge with uncertainty", () => {
		const low = agent("low", 0, "[confidence: low] Tentative but valid.")
		const convergence = evaluateConfidenceAwareConvergence({ agents: [low], laneReceipts: [lane("low", 0)] })
		assert.equal(validateGovernedReceipt(receipt(convergence)).valid, true)
		assert.equal(convergence.decision, "converge_with_uncertainty")
	})

	it("keeps source confidence and evidence unchanged after reuse or a probe", () => {
		const low = agent("resume", 0, "[confidence: low] [confidence_reason: missing_context] Tentative source claim.")
		const originalEvidenceIds = low.evidenceRefs.map((evidence) => evidence.id)
		const claimId = `swarm-lane:swarm-confidence:0:${low.structuredFindings[0].id}`
		const convergence = evaluateConfidenceAwareConvergence({
			agents: [low],
			laneReceipts: [lane("resume", 0, { findingConfidence: "low", confidenceReason: "missing_context" })],
			probeHistory: [
				probeHistory(claimId, {
					evidenceDelta: ["new-probe-evidence"],
					evidenceRefs: [
						{ id: "new-probe-evidence", kind: "file", path: "src/probe.ts", label: "probe", timestamp: 2 },
					],
					status: "completed",
				}),
			],
		})

		assert.equal(convergence.tentativeFindings[0]?.confidence, "low")
		assert.equal(convergence.tentativeFindings[0]?.confidenceReason, "missing_context")
		assert.deepEqual(
			low.evidenceRefs.map((evidence) => evidence.id),
			originalEvidenceIds,
		)
		assert.equal(convergence.diagnostics.confidenceChanges.length, 0)
	})

	it("seals the merge gate when advisory audit evidence remains unresolved", () => {
		const low = agent("audit", 0, "[confidence: low] [criticality: advisory] Audit remains tentative.", {
			transcriptArtifactPath: undefined,
		})
		const laneReceipt = lane("audit", 0, { transcriptArtifactPath: undefined })
		const envelope = swarm([low])
		const gate = runMergeGate({
			agents: [low],
			laneReceipts: [laneReceipt],
			claimHistory: [],
			laneDag: [
				{
					index: 0,
					laneId: laneReceipt.laneId,
					dependsOn: [],
					state: "sealed",
					agentId: "audit",
					executionMode: "read_only",
				},
			],
			replayArtifact: swarmEnvelopeToReplayArtifact(envelope),
		})

		assert.equal(gate.passed, true)
		assert.equal(gate.confidenceAwareConvergence?.decision, "converge_with_uncertainty")
		assert.equal(gate.retryDisposition, "not_needed")
		assert.ok(gate.advisoryWarnings?.some((warning) => warning.includes("bounded finding uncertainty")))
	})

	it("hard-blocks when every lane structurally fails", () => {
		const failed = agent("failed", 0, "A claim that cannot rescue invalid execution.", {
			status: "failed",
			phase: "failed",
			executionValidity: "invalid",
			error: "execution failed",
		})
		const result = evaluateConfidenceAwareConvergence({
			agents: [failed],
			laneReceipts: [lane("failed", 0, { status: "failed", executionValidity: "invalid", error: "execution failed" })],
		})
		assert.equal(result.decision, "block_hard_failure")
		assert.equal(result.gateDecision.kind === "block_hard_failure" ? result.gateDecision.reason : "", "every_lane_failed")
	})

	it("does not let a completed status override invalid execution validity", () => {
		const invalid = agent("invalid-completed", 0, "A confident claim from an invalid envelope.", {
			executionValidity: "invalid",
		})
		const invalidLane = lane("invalid-completed", 0, { executionValidity: "invalid" })
		const result = evaluateConfidenceAwareConvergence({ agents: [invalid], laneReceipts: [invalidLane] })
		assert.equal(result.decision, "block_hard_failure")
		assert.equal(result.acceptedFindings.length, 0)
		assert.equal(result.rejectedFindings.length, 1)
	})
})
