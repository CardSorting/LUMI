import { createHash } from "node:crypto"
import type {
	EvidenceReference,
	StructuredFinding,
	SubagentExecutionEnvelope,
	TaskAmbiguityProfile,
} from "@shared/subagent/executionEnvelope"
import type {
	ConfidenceAwareConvergenceDiagnostics,
	ConfidenceAwareConvergenceResult,
	ConfidenceProbeHistoryEntry,
	ConfidenceProbeReason,
	GovernedContradiction,
	GovernedFinding,
	HardFailureReason,
	LaneExecutionReceipt,
	MergeGateFinding,
	RejectedFinding,
	UncertaintySummary,
} from "@shared/subagent/governedExecution"

export const MAX_PROBES_PER_CRITICAL_CLAIM = 1
export const MAX_TOTAL_CONFIDENCE_PROBES = 2

const HARD_BLOCKING_CODES = new Set([
	"mutation_write_overlap",
	"mutation_without_lock",
	"undeclared_mutation",
	"duplicate_claim",
	"duplicate_claim_id",
	"split_brain",
	"orphaned_claim",
	"stale_lease",
	"unreleased_claim",
	"sealed_supersession",
	"replay_integrity",
	"replay_checksum_mismatch",
	"roadmap_merge_safety",
	"roadmap_projection_conflict",
	"roadmap_seal_integrity",
])

const STRUCTURAL_RESTART_CODES = new Set(["failed_lanes", "incomplete_lane_dag", "lane_status_mismatch"])

export interface ConfidenceAwareConvergenceInput {
	agents: SubagentExecutionEnvelope[]
	laneReceipts: LaneExecutionReceipt[]
	mergeFindings?: MergeGateFinding[]
	taskAmbiguityProfile?: TaskAmbiguityProfile
	contradictions?: GovernedContradiction[]
	probeHistory?: ConfidenceProbeHistoryEntry[]
	hardFailureReason?: HardFailureReason
	maxProbesPerCriticalClaim?: number
	maxTotalConfidenceProbes?: number
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)]
}

function normalizeClaim(claim: string): { base: string; negated: boolean } {
	const normalized = claim
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
	const negated = /\b(?:not|no|never|cannot|doesnt|isnt|without)\b/.test(normalized)
	return {
		base: normalized
			.replace(/\b(?:not|no|never|cannot|doesnt|isnt|without)\b/g, "")
			.replace(/\s+/g, " ")
			.trim(),
		negated,
	}
}

function claimMarkers(claim: string, pattern: RegExp): string[] {
	return unique([...claim.toLowerCase().matchAll(pattern)].map((match) => match[0]))
}

function classifyContradiction(findings: GovernedFinding[]): GovernedContradiction["kind"] {
	const assumptionSets = findings.map((finding) => JSON.stringify(finding.assumptions.slice().sort()))
	if (new Set(assumptionSets).size > 1 && findings.some((finding) => finding.assumptions.length > 0)) {
		return "different_assumption"
	}
	const timeframeSets = findings.map((finding) =>
		claimMarkers(
			finding.claim,
			/\b(?:current(?:ly)?|present|today|now|historical(?:ly)?|previous(?:ly)?|past|future|planned|20\d{2})\b/g,
		),
	)
	if (
		timeframeSets.every((markers) => markers.length > 0) &&
		new Set(timeframeSets.map((markers) => markers.join("|"))).size > 1
	) {
		return "different_timeframe"
	}
	const scopeSets = findings.map((finding) =>
		claimMarkers(
			finding.claim,
			/\b(?:api|backend|server|runtime|ui|frontend|client|tests?|production|development|mobile|desktop)\b/g,
		),
	)
	if (scopeSets.every((markers) => markers.length > 0) && new Set(scopeSets.map((markers) => markers.join("|"))).size > 1) {
		return "different_scope"
	}
	if (findings.some((finding) => finding.confidenceReason === "conflicting_evidence")) return "evidence_conflict"
	return "mutually_exclusive_claim"
}

function contradictionSummary(kind: GovernedContradiction["kind"]): string {
	switch (kind) {
		case "different_assumption":
			return "Findings diverge under different stated assumptions."
		case "different_timeframe":
			return "Findings refer to different timeframes and remain scoped to those timeframes."
		case "different_scope":
			return "Findings refer to different scopes and remain scoped to those surfaces."
		case "evidence_conflict":
			return "The attached evidence supports conflicting conclusions."
		default:
			return "Findings make mutually exclusive claims."
	}
}

function findingFromStructured(laneId: string, agent: SubagentExecutionEnvelope, finding: StructuredFinding): GovernedFinding {
	const evidenceById = new Map(agent.evidenceRefs.map((evidence) => [evidence.id, evidence]))
	return {
		id: `${laneId}:${finding.id}`,
		laneId,
		claim: finding.summary,
		confidence: finding.confidence,
		confidenceReason: finding.confidenceReason ?? "other",
		evidenceRefs: finding.evidenceIds.map((id) => evidenceById.get(id)).filter((value) => value !== undefined),
		assumptions: finding.assumptions ?? [],
		decisionCriticality: finding.decisionCriticality ?? (finding.severity === "critical" ? "critical" : "advisory"),
	}
}

function syntheticFinding(laneId: string, agent: SubagentExecutionEnvelope): GovernedFinding {
	return {
		id: `${laneId}:synthetic_completion`,
		laneId,
		claim: agent.verbatimOutput?.trim() || "No definitive finding was produced.",
		confidence: agent.confidence ?? "unknown",
		confidenceReason: "model_uncertainty",
		evidenceRefs: agent.evidenceRefs ?? [],
		assumptions: [],
		decisionCriticality: "advisory",
	}
}

function detectContradictions(
	agents: SubagentExecutionEnvelope[],
	findings: GovernedFinding[],
	explicit: GovernedContradiction[] = [],
): GovernedContradiction[] {
	const contradictions = [...explicit]
	const byId = new Map(findings.map((finding) => [finding.id, finding]))

	for (const agent of agents) {
		const laneId = findings.find((finding) => finding.laneId.endsWith(`:${agent.lineage.index}`))?.laneId
		if (!laneId) continue
		for (const finding of agent.structuredFindings ?? []) {
			if (!finding.contradictsFindingIds?.length) continue
			const sourceId = `${laneId}:${finding.id}`
			const targetIds = finding.contradictsFindingIds
				.map((targetId) => findings.find((candidate) => candidate.id.endsWith(`:${targetId}`))?.id)
				.filter((value): value is string => Boolean(value))
			const source = byId.get(sourceId)
			const targets = targetIds.map((id) => byId.get(id)).filter((value): value is GovernedFinding => Boolean(value))
			const participatingFindings = [source, ...targets].filter((candidate): candidate is GovernedFinding =>
				Boolean(candidate),
			)
			const kind = classifyContradiction(participatingFindings)
			contradictions.push({
				id: `contradiction:${sourceId}:${targetIds.join(":")}`,
				kind,
				findingIds: [sourceId, ...targetIds],
				summary: contradictionSummary(kind),
				critical: [source, ...targets].some((candidate) => candidate?.decisionCriticality === "critical"),
				resolved: false,
			})
		}
	}

	for (let left = 0; left < findings.length; left++) {
		for (let right = left + 1; right < findings.length; right++) {
			const a = findings[left]
			const b = findings[right]
			if (a.laneId === b.laneId) continue
			const normalizedA = normalizeClaim(a.claim)
			const normalizedB = normalizeClaim(b.claim)
			if (!normalizedA.base || normalizedA.base !== normalizedB.base || normalizedA.negated === normalizedB.negated)
				continue
			const kind = classifyContradiction([a, b])
			contradictions.push({
				id: `contradiction:${a.id}:${b.id}`,
				kind,
				findingIds: [a.id, b.id],
				summary: contradictionSummary(kind),
				critical: a.decisionCriticality === "critical" || b.decisionCriticality === "critical",
				resolved: false,
			})
		}
	}

	const seen = new Set<string>()
	return contradictions.filter((contradiction) => {
		const key = `${contradiction.kind}:${contradiction.findingIds.slice().sort().join("|")}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export function detectTaskAmbiguityProfile(
	agents: SubagentExecutionEnvelope[],
	findings: GovernedFinding[],
	contradictions: GovernedContradiction[],
): TaskAmbiguityProfile {
	const prompts = agents.map((agent) => agent.prompt).join("\n")
	const reasons: TaskAmbiguityProfile["reasons"] = []
	if (contradictions.some((contradiction) => contradiction.kind === "different_assumption")) {
		reasons.push("multiple_valid_interpretations")
	}
	if (
		/\b(?:improve|assess|evaluate|review|analy[sz]e)\b/i.test(prompts) &&
		!/\b(?:must|expected|success|criteria)\b/i.test(prompts)
	) {
		reasons.push("missing_success_criteria")
	}
	if (/\b(?:broadly|overall|anything|wherever|as needed)\b/i.test(prompts)) {
		reasons.push("missing_scope_boundary")
	}
	if (
		findings.length > 0 &&
		findings.every((finding) => finding.confidence === "unknown" || finding.evidenceRefs.length === 0)
	) {
		reasons.push("insufficient_source_material")
	}
	if (/\b(?:best|prefer|subjective|taste|quality|elegant)\b/i.test(prompts)) {
		reasons.push("subjective_judgment")
	}
	if (/\b(?:explore|brainstorm|hypothes|investigate possibilities|open[- ]ended)\b/i.test(prompts)) {
		reasons.push("open_ended_exploration")
	}
	if (/\bconflicting constraints?\b/i.test(prompts)) {
		reasons.push("conflicting_constraints")
	}
	if (findings.some((finding) => finding.confidenceReason === "underspecified_goal")) {
		reasons.push("missing_success_criteria")
	}

	return {
		detected: reasons.length > 0,
		reasons: unique(reasons),
		assumptionsAllowed: !agents.some((agent) => /\b(?:do not assume|no assumptions)\b/i.test(agent.prompt)),
	}
}

export function buildConfidenceRetryFingerprint(input: {
	assignment: string
	evidenceRefs: Array<Pick<EvidenceReference, "id"> & Partial<Omit<EvidenceReference, "id">>>
	principalClaims: string[]
	confidenceReason: string
	toolSequence: string[]
}): string {
	const stable = JSON.stringify({
		assignment: input.assignment.trim(),
		evidenceRefs: input.evidenceRefs.map(evidenceIdentity).sort(),
		principalClaims: input.principalClaims.map((claim) => claim.trim()).sort(),
		confidenceReason: input.confidenceReason,
		toolSequence: input.toolSequence,
	})
	return createHash("sha256").update(stable).digest("hex").slice(0, 24)
}

/** Generated evidence IDs are execution-local, so plateau detection compares the evidence itself. */
export function evidenceIdentity(evidence: Pick<EvidenceReference, "id"> & Partial<Omit<EvidenceReference, "id">>): string {
	if (!evidence.kind && !evidence.path && !evidence.label && !evidence.excerpt) return evidence.id
	return [evidence.kind ?? "unknown", evidence.path ?? "", evidence.label ?? "", evidence.excerpt?.trim() ?? ""].join(":")
}

export function computeEvidenceDelta(source: EvidenceReference[], probe: EvidenceReference[]): EvidenceReference[] {
	const sourceEvidence = new Set(source.map(evidenceIdentity))
	return probe.filter((evidence) => !sourceEvidence.has(evidenceIdentity(evidence)))
}

export function isConfidencePlateau(history: ConfidenceProbeHistoryEntry[]): boolean {
	if (history.some((entry) => entry.confidencePlateau)) return true
	const fingerprints = new Map<string, number>()
	for (const entry of history) {
		const next = (fingerprints.get(entry.fingerprint) ?? 0) + 1
		fingerprints.set(entry.fingerprint, next)
		if (next > 1 && entry.evidenceDelta.length === 0) return true
	}
	return false
}

export function shouldSuppressConfidenceOnlyRetry(input: {
	executionValidity: "valid" | "invalid"
	findingConfidence: "high" | "medium" | "low" | "unknown"
	requiresCriticalVerification: boolean
	evidenceDelta?: string[]
	confidencePlateau?: boolean
}): boolean {
	if (input.executionValidity !== "valid") return false
	if (input.confidencePlateau) return true
	return (
		(input.findingConfidence === "low" || input.findingConfidence === "unknown") &&
		!input.requiresCriticalVerification &&
		(input.evidenceDelta?.length ?? 0) === 0
	)
}

function hardReasonForCodes(codes: Set<string>): HardFailureReason {
	if (codes.has("mutation_without_lock") || codes.has("undeclared_mutation")) return "mutation_authority_violation"
	if (
		codes.has("mutation_write_overlap") ||
		codes.has("split_brain") ||
		codes.has("roadmap_merge_safety") ||
		codes.has("roadmap_projection_conflict")
	) {
		return "unreconciled_mutation_conflict"
	}
	if (codes.has("replay_integrity") || codes.has("replay_checksum_mismatch")) {
		return "execution_provenance_corrupt"
	}
	if (codes.has("sealed_supersession")) return "receipt_integrity_violation"
	return "required_invariant_violated"
}

function buildProbeQuestion(finding: GovernedFinding): string {
	const evidenceNeeded =
		finding.evidenceRefs.length === 0
			? "Locate direct file or tool-output evidence."
			: "Check the existing evidence against the authoritative implementation and identify any contradiction."
	return `Verify this single critical claim: "${finding.claim}" ${evidenceNeeded} Return concrete evidence references; do not repeat the original assignment or merely restate an opinion.`
}

function hasUnsafeUnresolvedMutation(finding: GovernedFinding, lanes: LaneExecutionReceipt[]): boolean {
	const lane = lanes.find((candidate) => candidate.laneId === finding.laneId)
	if (!lane || lane.executionMode !== "mutation") return false
	return (lane.writeSet?.length ?? 0) > 0 || lane.touchedFiles.length > 0
}

function emptyDiagnostics(): ConfidenceAwareConvergenceDiagnostics {
	return {
		events: [],
		lowConfidenceLanesAccepted: 0,
		confidenceOnlyRetriesSuppressed: 0,
		targetedProbesLaunched: 0,
		probeBudgetsExhausted: 0,
		convergedWithBoundedUncertainty: 0,
		trueHardBlocks: 0,
		contradictionClassifications: {},
		confidenceChanges: [],
	}
}

export function evaluateConfidenceAwareConvergence(input: ConfidenceAwareConvergenceInput): ConfidenceAwareConvergenceResult {
	const diagnostics = emptyDiagnostics()
	const probeHistory = input.probeHistory ?? []
	diagnostics.targetedProbesLaunched = probeHistory.length
	const laneByAgent = new Map(input.laneReceipts.map((lane) => [lane.agentId, lane]))
	const allFindings: Array<{ finding: GovernedFinding; valid: boolean }> = []

	for (const agent of input.agents) {
		const lane = laneByAgent.get(agent.agentId)
		const laneId = lane?.laneId ?? `swarm-lane:${agent.parentSwarmId}:${agent.lineage.index}`
		const agentValidity = agent.executionValidity ?? (agent.status === "completed" ? "valid" : "invalid")
		const laneValidity = lane?.executionValidity ?? agentValidity
		const valid =
			agentValidity === "valid" &&
			laneValidity === "valid" &&
			agent.status === "completed" &&
			lane?.status !== "failed" &&
			lane?.status !== "blocked" &&
			lane?.status !== "collision_rejected"
		const findings =
			agent.structuredFindings?.length > 0
				? agent.structuredFindings.map((finding) => findingFromStructured(laneId, agent, finding))
				: [syntheticFinding(laneId, agent)]
		for (const finding of findings) allFindings.push({ finding, valid })
	}
	for (const lane of input.laneReceipts) {
		if (input.agents.some((agent) => agent.agentId === lane.agentId)) continue
		const valid = lane.executionValidity === "valid" && (lane.status === "completed" || lane.status === "skipped")
		allFindings.push({
			valid,
			finding: {
				id: `${lane.laneId}:missing_envelope`,
				laneId: lane.laneId,
				claim: lane.error || "Lane has no verifiable execution envelope.",
				confidence: lane.findingConfidence ?? "unknown",
				confidenceReason: lane.confidenceReason ?? "missing_context",
				evidenceRefs: [],
				assumptions: [],
				decisionCriticality: valid ? "advisory" : "critical",
			},
		})
	}

	const sourceValidFindings = allFindings.filter((entry) => entry.valid).map((entry) => entry.finding)
	const sourceFindingById = new Map(sourceValidFindings.map((finding) => [finding.id, finding]))
	const probeFindings: GovernedFinding[] = probeHistory
		.filter((probe) => probe.status === "completed" && probe.evidenceDelta.length > 0)
		.flatMap((probe) => {
			const source = sourceFindingById.get(probe.claimId)
			return probe.principalClaims.map((claim, index) => ({
				id: `${probe.claimId}:probe:${probe.probeId}:${index}`,
				laneId: probe.sourceLaneIds[0] ?? source?.laneId ?? "confidence-probe",
				claim,
				confidence: probe.findingConfidence,
				confidenceReason: probe.confidenceReason,
				evidenceRefs: probe.evidenceRefs,
				assumptions: [],
				decisionCriticality: source?.decisionCriticality ?? "important",
			}))
		})
	const validFindings = [...sourceValidFindings, ...probeFindings]
	const rejectedFindings: RejectedFinding[] = allFindings
		.filter((entry) => !entry.valid)
		.map((entry) => ({ finding: entry.finding, reason: "source lane execution is structurally invalid" }))
	const acceptedFindings = validFindings.filter((finding) => finding.confidence === "high" || finding.confidence === "medium")
	const tentativeFindings = validFindings.filter((finding) => finding.confidence === "low" || finding.confidence === "unknown")
	const contradictions = detectContradictions(input.agents, validFindings, input.contradictions).filter(
		(contradiction) => !contradiction.resolved,
	)
	for (const contradiction of contradictions) {
		if (contradiction.kind === "evidence_conflict" && !contradiction.preferredFindingId) {
			contradiction.preferredFindingId = contradiction.findingIds
				.map((id) => validFindings.find((finding) => finding.id === id))
				.filter((finding): finding is GovernedFinding => Boolean(finding))
				.sort((left, right) => right.evidenceRefs.length - left.evidenceRefs.length)[0]?.id
		}
		diagnostics.contradictionClassifications[contradiction.kind] =
			(diagnostics.contradictionClassifications[contradiction.kind] ?? 0) + 1
	}
	const ambiguity = input.taskAmbiguityProfile ?? detectTaskAmbiguityProfile(input.agents, validFindings, contradictions)
	const assumptions = unique(validFindings.flatMap((finding) => finding.assumptions))
	const evidence = {
		acceptedFindingIds: acceptedFindings.map((finding) => finding.id),
		tentativeFindingIds: tentativeFindings.map((finding) => finding.id),
		rejectedFindingIds: rejectedFindings.map((finding) => finding.finding.id),
		usableLaneIds: unique(validFindings.map((finding) => finding.laneId)),
	}
	const invalidLaneIds = unique(rejectedFindings.map((finding) => finding.finding.laneId))
	const lowConfidenceLaneIds = unique(tentativeFindings.map((finding) => finding.laneId))
	diagnostics.lowConfidenceLanesAccepted = lowConfidenceLaneIds.length
	if (lowConfidenceLaneIds.length > 0) diagnostics.events.push("finding_low_confidence")
	if (ambiguity.detected) diagnostics.events.push("task_ambiguous")
	if (invalidLaneIds.length > 0) diagnostics.events.push("execution_invalid")

	const blockingCodes = new Set(
		(input.mergeFindings ?? []).filter((finding) => finding.severity === "blocking").map((finding) => finding.code),
	)
	const everyLaneFailed = allFindings.length === 0 || sourceValidFindings.length === 0
	const unresolvedMutationConflict = contradictions.some((contradiction) => contradiction.kind === "mutation_conflict")
	if (
		input.hardFailureReason ||
		everyLaneFailed ||
		unresolvedMutationConflict ||
		[...blockingCodes].some((code) => HARD_BLOCKING_CODES.has(code))
	) {
		const reason =
			input.hardFailureReason ??
			(everyLaneFailed
				? "every_lane_failed"
				: unresolvedMutationConflict
					? "unreconciled_mutation_conflict"
					: hardReasonForCodes(blockingCodes))
		diagnostics.events.push("hard_blocked")
		diagnostics.trueHardBlocks = 1
		return {
			decision: "block_hard_failure",
			gateDecision: { kind: "block_hard_failure", reason },
			acceptedFindings,
			tentativeFindings,
			rejectedFindings,
			unresolvedContradictions: contradictions,
			assumptions,
			taskAmbiguityProfile: ambiguity,
			probeHistory,
			confidencePlateau: isConfidencePlateau(probeHistory),
			diagnostics,
		}
	}

	if ([...blockingCodes].some((code) => STRUCTURAL_RESTART_CODES.has(code)) && invalidLaneIds.length > 0) {
		return {
			decision: "restart_invalid_lane",
			gateDecision: {
				kind: "restart_invalid_lane",
				laneId: invalidLaneIds[0],
				reason: blockingCodes.has("lane_status_mismatch")
					? "structurally_invalid_result_envelope"
					: "lane_execution_failed",
			},
			acceptedFindings,
			tentativeFindings,
			rejectedFindings,
			unresolvedContradictions: contradictions,
			assumptions,
			taskAmbiguityProfile: ambiguity,
			probeHistory,
			confidencePlateau: isConfidencePlateau(probeHistory),
			diagnostics,
		}
	}

	const confidencePlateau = isConfidencePlateau(probeHistory)
	if (confidencePlateau) diagnostics.events.push("confidence_plateau")
	const resolvedCriticalClaimIds = new Set(
		probeHistory
			.filter(
				(probe) =>
					probe.status === "completed" &&
					probe.evidenceDelta.length > 0 &&
					(probe.findingConfidence === "high" || probe.findingConfidence === "medium"),
			)
			.map((probe) => probe.claimId),
	)
	const unresolvedCritical = tentativeFindings.filter(
		(finding) => finding.decisionCriticality === "critical" && !resolvedCriticalClaimIds.has(finding.id),
	)
	const criticalContradictionFindings = contradictions
		.filter(
			(contradiction) =>
				contradiction.critical &&
				(contradiction.kind === "mutually_exclusive_claim" || contradiction.kind === "evidence_conflict"),
		)
		.flatMap((contradiction) => contradiction.findingIds)
	const maxPerClaim = input.maxProbesPerCriticalClaim ?? MAX_PROBES_PER_CRITICAL_CLAIM
	const maxTotal = input.maxTotalConfidenceProbes ?? MAX_TOTAL_CONFIDENCE_PROBES
	const criticalCandidates = unique([
		...unresolvedCritical,
		...validFindings.filter((finding) => criticalContradictionFindings.includes(finding.id)),
	])
	const criticalCandidate =
		criticalCandidates.find((finding) => probeHistory.filter((probe) => probe.claimId === finding.id).length < maxPerClaim) ??
		criticalCandidates[0]
	if (criticalCandidate) {
		diagnostics.events.push("critical_claim_unverified")
		const claimProbes = probeHistory.filter((probe) => probe.claimId === criticalCandidate.id)
		const canProbe = !confidencePlateau && claimProbes.length < maxPerClaim && probeHistory.length < maxTotal
		if (canProbe) {
			const candidateContradiction = contradictions.find(
				(contradiction) => contradiction.critical && contradiction.findingIds.includes(criticalCandidate.id),
			)
			const reason: ConfidenceProbeReason =
				candidateContradiction?.kind === "evidence_conflict"
					? "evidence_conflict"
					: criticalContradictionFindings.includes(criticalCandidate.id)
						? "mutually_exclusive_critical_claim"
						: "critical_claim_unverified"
			return {
				decision: "targeted_probe",
				gateDecision: {
					kind: "targeted_probe",
					question: buildProbeQuestion(criticalCandidate),
					sourceLaneIds: [criticalCandidate.laneId],
					reason,
				},
				acceptedFindings,
				tentativeFindings,
				rejectedFindings,
				unresolvedContradictions: contradictions,
				assumptions,
				taskAmbiguityProfile: ambiguity,
				probeHistory,
				confidencePlateau,
				diagnostics,
			}
		}
		diagnostics.probeBudgetsExhausted = 1
		if (hasUnsafeUnresolvedMutation(criticalCandidate, input.laneReceipts)) {
			diagnostics.events.push("hard_blocked")
			diagnostics.trueHardBlocks = 1
			return {
				decision: "block_hard_failure",
				gateDecision: { kind: "block_hard_failure", reason: "unsafe_under_all_interpretations" },
				acceptedFindings,
				tentativeFindings,
				rejectedFindings,
				unresolvedContradictions: contradictions,
				assumptions,
				taskAmbiguityProfile: ambiguity,
				probeHistory,
				confidencePlateau,
				diagnostics,
			}
		}
	}

	const hasUncertainty =
		tentativeFindings.length > 0 ||
		contradictions.length > 0 ||
		ambiguity.detected ||
		(validFindings.length > 0 && acceptedFindings.length === 0)
	diagnostics.confidenceOnlyRetriesSuppressed = unique(
		tentativeFindings
			.filter((finding) =>
				shouldSuppressConfidenceOnlyRetry({
					executionValidity: "valid",
					findingConfidence: finding.confidence,
					requiresCriticalVerification: finding.decisionCriticality === "critical",
					confidencePlateau,
				}),
			)
			.map((finding) => finding.laneId),
	).length

	if (hasUncertainty) {
		const uncertaintySummary: UncertaintySummary = {
			causes: unique([
				...ambiguity.reasons,
				...tentativeFindings.map((finding) => finding.confidenceReason),
				...contradictions.map((contradiction) => contradiction.kind),
			]),
			affectedClaims: unique([
				...tentativeFindings.map((finding) => finding.id),
				...contradictions.flatMap((contradiction) => contradiction.findingIds),
			]),
			safeToProceed: true,
			resolutionEvidenceNeeded: unique(
				tentativeFindings.map((finding) =>
					finding.evidenceRefs.length === 0
						? `Direct evidence for ${finding.id}`
						: `Evidence resolving ${finding.confidenceReason} for ${finding.id}`,
				),
			),
		}
		diagnostics.events.push("converged_with_uncertainty")
		diagnostics.convergedWithBoundedUncertainty = 1
		return {
			decision: "converge_with_uncertainty",
			gateDecision: { kind: "converge_with_uncertainty", evidence, uncertainty: uncertaintySummary },
			acceptedFindings,
			tentativeFindings,
			rejectedFindings,
			unresolvedContradictions: contradictions,
			assumptions,
			taskAmbiguityProfile: ambiguity,
			probeHistory,
			confidencePlateau,
			uncertaintySummary,
			diagnostics,
		}
	}

	return {
		decision: "converge",
		gateDecision: { kind: "converge", evidence },
		acceptedFindings,
		tentativeFindings,
		rejectedFindings,
		unresolvedContradictions: contradictions,
		assumptions,
		taskAmbiguityProfile: ambiguity,
		probeHistory,
		confidencePlateau,
		diagnostics,
	}
}
