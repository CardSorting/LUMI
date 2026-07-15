import type { SubagentStatusItem } from "@shared/ExtensionMessage"
import type { SubagentExecutionEnvelope, SwarmExecutionEnvelope } from "@shared/subagent/executionEnvelope"
import type { GovernedSwarmReceipt } from "@shared/subagent/governedExecution"

const LLM_EXCERPT_CHARS = 300
const LLM_PROMPT_EXCERPT_CHARS = 100

function excerpt(text: string | undefined, maxChars: number): string {
	if (!text) {
		return ""
	}
	const trimmed = text.trim()
	if (trimmed.length <= maxChars) {
		return trimmed
	}
	return `${trimmed.slice(0, maxChars)}...`
}

export function buildSwarmSummaryOverlay(envelope: SwarmExecutionEnvelope, entries: SubagentStatusItem[]): string {
	const successCount = entries.filter((entry) => entry.status === "completed").length
	const failures = entries.filter((entry) => entry.status === "failed").length
	const totalToolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
	const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)
	const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
	const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)

	return [
		"### SWARM EXECUTION SUMMARY (overlay)",
		`Swarm ID: ${envelope.swarmId}`,
		`Artifact: ${envelope.artifactPath}`,
		`Total Agents: ${entries.length} (Success: ${successCount}, Fail: ${failures})`,
		`Total Tool Calls: ${totalToolCalls}`,
		`Peak Context Usage: ${maxContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${maxContextUsagePercentage.toFixed(1)}%)`,
		"",
		"### AGENT DETAILS (excerpted for context window; full verbatim output in artifact)",
		...entries.map((entry) => {
			const header = `[${entry.index}] ${entry.name} - ${entry.status.toUpperCase()}`
			const subPrompt = `Prompt: ${excerpt(entry.prompt, LLM_PROMPT_EXCERPT_CHARS)}`
			const detail =
				entry.status === "completed"
					? `Result: ${excerpt(entry.result, LLM_EXCERPT_CHARS)}`
					: `Error: ${excerpt(entry.error, LLM_EXCERPT_CHARS)}`
			const evidenceNote =
				entry.status === "completed" && entry.result ? ` [full output preserved in artifact agent ${entry.id}]` : ""
			return `${header}\n${subPrompt}\n${detail}${evidenceNote}\n`
		}),
		...(envelope.blackboardSnapshot.length > 0
			? ["", "### SHARED SWARM FINDINGS (Blackboard)", ...envelope.blackboardSnapshot.map((f) => `- ${f}`)]
			: []),
	].join("\n")
}

export function buildParentToolResult(
	envelope: SwarmExecutionEnvelope,
	summaryOverlay: string,
	governedReceipt?: GovernedSwarmReceipt,
): string {
	const invariantNote =
		envelope.invariants.violations.length > 0
			? `\n\n### INVARIANT WARNINGS\n${envelope.invariants.violations.map((v) => `- ${v}`).join("\n")}`
			: ""
	const advisories = [...(governedReceipt?.mergeGate.advisoryWarnings ?? []), ...(envelope.invariants.advisoryWarnings ?? [])]
	const advisoryNote = advisories.length
		? `\n\n### AUDIT ADVISORIES (NO RETRY REQUIRED)\n${[...new Set(advisories)].map((warning) => `- ${warning}`).join("\n")}`
		: ""
	const convergence = governedReceipt?.confidenceAwareConvergence ?? governedReceipt?.mergeGate.confidenceAwareConvergence
	const convergenceNote = convergence
		? [
				"",
				"### CONFIDENCE-AWARE CONVERGENCE",
				`Decision: ${convergence.decision}`,
				`Accepted findings: ${convergence.acceptedFindings.length}`,
				`Tentative findings: ${convergence.tentativeFindings.length}`,
				`Rejected findings: ${convergence.rejectedFindings.length}`,
				...(convergence.acceptedFindings.length > 0
					? [
							"Strongest supported findings:",
							...convergence.acceptedFindings.map(
								(finding) =>
									`- [${finding.confidence}; ${finding.confidenceReason}] ${excerpt(finding.claim, 220)}`,
							),
						]
					: []),
				...(convergence.assumptions.length > 0
					? ["Assumptions:", ...convergence.assumptions.map((assumption) => `- ${assumption}`)]
					: []),
				...(convergence.tentativeFindings.length > 0
					? [
							"Tentative findings (confidence preserved):",
							...convergence.tentativeFindings.map(
								(finding) =>
									`- [${finding.confidence}; ${finding.confidenceReason}] ${excerpt(finding.claim, 220)}`,
							),
						]
					: []),
				...(convergence.unresolvedContradictions.length > 0
					? [
							"Plausible alternatives / unresolved contradictions:",
							...convergence.unresolvedContradictions.map(
								(contradiction) => `- [${contradiction.kind}] ${contradiction.summary}`,
							),
						]
					: []),
				...(convergence.uncertaintySummary
					? [
							`Safe to proceed: ${convergence.uncertaintySummary.safeToProceed}`,
							`Uncertainty causes: ${convergence.uncertaintySummary.causes.join(", ") || "unspecified"}`,
							`Resolution evidence: ${convergence.uncertaintySummary.resolutionEvidenceNeeded.join("; ") || "none required"}`,
						]
					: []),
			].join("\n")
		: ""

	const governedNote = governedReceipt
		? [
				"",
				"### GOVERNED EXECUTION RECEIPT",
				`Governed artifact: ${governedReceipt.governedArtifactPath}`,
				`Merge gate passed: ${governedReceipt.mergeGate.passed}`,
				`Sealed: ${governedReceipt.sealed}`,
				`Lanes: ${governedReceipt.laneReceipts.length} (sealed DAG: ${governedReceipt.laneDag.filter((l) => l.state === "sealed").length})`,
				`Integrity valid: ${governedReceipt.integrity.valid}`,
				`Retry disposition: ${governedReceipt.mergeGate.retryDisposition ?? "targeted_repair"}`,
				`Continuation: ${governedReceipt.continuationDecision?.action ?? "legacy"}`,
				...(governedReceipt.mergeGate.mergeAudit.overlappingPaths.length > 0
					? [
							`Overlapping paths: ${governedReceipt.mergeGate.mergeAudit.overlappingPaths
								.map((overlap) => `${overlap.path} (${overlap.agents.join(", ")})`)
								.join("; ")}`,
						]
					: []),
			].join("\n")
		: ""

	return [
		summaryOverlay,
		"",
		"### EXECUTION ARTIFACT",
		`Replay artifact: ${envelope.artifactPath}`,
		`Resume token: ${envelope.continuity.resumeToken}`,
		`Continuity status: ${envelope.continuity.status}`,
		invariantNote,
		advisoryNote,
		convergenceNote,
		governedNote,
	].join("\n")
}

export function agentEnvelopeFromEntry(
	entry: SubagentStatusItem,
	agentEnvelope: Partial<SubagentExecutionEnvelope>,
): SubagentExecutionEnvelope {
	return {
		agentId: entry.id,
		executionId: agentEnvelope.executionId || entry.id,
		role: entry.name,
		parentSwarmId: agentEnvelope.parentSwarmId || "",
		parentTaskId: agentEnvelope.parentTaskId || "",
		parentStreamId: agentEnvelope.parentStreamId,
		childStreamId: agentEnvelope.childStreamId,
		lineage: agentEnvelope.lineage || { swarmId: "", index: entry.index, depth: 0 },
		phase: entry.status === "completed" ? "completed" : entry.status === "failed" ? "failed" : "running",
		status: entry.status,
		prompt: entry.prompt,
		verbatimOutput: entry.result,
		structuredFindings: agentEnvelope.structuredFindings || [],
		evidenceRefs: agentEnvelope.evidenceRefs || [],
		touchedFiles: agentEnvelope.touchedFiles || entry.touchedFiles || [],
		toolSteps: agentEnvelope.toolSteps || [],
		compactionEvents: agentEnvelope.compactionEvents || [],
		blockers: agentEnvelope.blockers || entry.blockers || [],
		warnings: agentEnvelope.warnings || entry.warnings || [],
		executionValidity: agentEnvelope.executionValidity || (entry.status === "completed" ? "valid" : "invalid"),
		confidence: agentEnvelope.confidence || entry.confidence || "unknown",
		retryHints: agentEnvelope.retryHints || [],
		timestamps: agentEnvelope.timestamps || { spawned: Date.now() },
		error: entry.error,
	}
}
