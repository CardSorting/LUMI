import { createHash } from "node:crypto"
import {
	applyWorkspaceAuditPolicy,
	type GatePolicyProvenance,
	resolveCompletionGateContext,
} from "@shared/audit/auditGatePolicyLoader"
import { type AuditGateDecision, evaluateAuditGate } from "@shared/audit/auditGateReport"
import { resolvePlanBaselineMetadata } from "@shared/audit/auditMessages"
import { buildPreCompletionChecklistBlock, buildPreCompletionChecklistSummary } from "@shared/audit/auditPreCompletionChecklist"
import { buildCompletionGateMessage, runCompletionAudit } from "@shared/audit/completionAudit"
import {
	COMPLETION_AUDIT_CACHE_TTL_MS,
	parseIntentThresholdOverrides,
	SUBAGENT_IO_LANE_RESULT_MIN_LENGTH,
} from "@shared/audit/gatePolicy"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import type { LaneExecutionMode } from "@shared/subagent/governedExecution"
import { formatAutoRemediationSummary } from "@/services/roadmap/RoadmapAutoGovernance"
import {
	evaluateRoadmapCompletionBlock,
	failClosedCompletionMessage,
	roadmapPreflightReadinessFromDryRun,
} from "@/services/roadmap/RoadmapCompletionGate"
import { getRoadmapConfig } from "@/services/roadmap/RoadmapConfig"
import { RoadmapService } from "@/services/roadmap/RoadmapService"
import {
	type CompletionPreflightStage,
	detectDuplicateCompletionSubmission,
	getCompletionGraphRevision,
	getLatestCheckpointHashFromMessages,
	validateCompletionAttemptCooldown,
	validateCompletionDemoCommand,
	validateCompletionResultExcludesChecklist,
	validateCompletionResultMaxLength,
	validateCompletionResultMinLength,
	validateCompletionResultQuality,
	validateCompletionTaskProgress,
	validateCompletionTaskProgressRequired,
	validateFocusChainComplete,
	validateTaskProgressAlignsWithFocusChain,
	validateWorkspaceProgressSinceGateBlock,
} from "./attemptCompletionUtils"
import { isNonMutatingMode } from "./subagent/LockNecessity"
import type { TaskConfig } from "./types/TaskConfig"

export type CompletionAuditGateResult =
	| {
			status: "advisory_passed"
			auditMetadata: TaskAuditMetadata
			planBaseline?: TaskAuditMetadata
			gateDecision: AuditGateDecision
			gateOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"]
			policyProvenance: GatePolicyProvenance
	  }
	| {
			status: "advisory_failed"
			diagnostics: string
			auditMetadata: TaskAuditMetadata
			gateDecision: AuditGateDecision
			gateOptions: Awaited<ReturnType<typeof resolveCompletionGateContext>>["options"]
			policyProvenance: GatePolicyProvenance
	  }
	| { status: "skipped" }
	| { status: "diagnostic_error"; diagnostics: string }

type PreflightCheckContext = {
	config: TaskConfig
	params: {
		result: string
		taskProgress?: string
		command?: string
	}
	checkpointHash?: string
	validateQuality: (result: string) => string | null
}

/** Declarative preflight stage registry — order mirrors COMPLETION_PREFLIGHT_STAGES. */
export const PREFLIGHT_STAGE_RUNNERS: ReadonlyArray<{
	stage: CompletionPreflightStage
	validate: (ctx: PreflightCheckContext) => string | null
	soft?: boolean
}> = [
	{
		stage: "quality",
		validate: (ctx) => ctx.validateQuality(ctx.params.result),
	},
	{
		stage: "checklist_in_result",
		validate: (ctx) => validateCompletionResultExcludesChecklist(ctx.params.result),
	},
	{
		stage: "min_length",
		validate: (ctx) => validateCompletionResultMinLength(ctx.params.result),
	},
	{
		stage: "max_length",
		validate: (ctx) => validateCompletionResultMaxLength(ctx.params.result),
	},
	{
		stage: "task_progress_required",
		validate: (ctx) => validateCompletionTaskProgressRequired(ctx.config, ctx.params.taskProgress),
	},
	{
		stage: "task_progress_complete",
		validate: (ctx) => validateCompletionTaskProgress(ctx.params.taskProgress),
	},
	{
		stage: "task_progress_align",
		validate: (ctx) => validateTaskProgressAlignsWithFocusChain(ctx.config, ctx.params.taskProgress),
	},
	{
		stage: "focus_chain",
		validate: (ctx) => validateFocusChainComplete(ctx.config),
	},
	{
		stage: "cooldown",
		validate: (ctx) => validateCompletionAttemptCooldown(ctx.config),
		soft: true,
	},
	{
		stage: "duplicate",
		validate: (ctx) =>
			detectDuplicateCompletionSubmission(ctx.config, ctx.params.result, {
				currentCheckpointHash: ctx.checkpointHash,
			}),
		soft: true,
	},
	{
		stage: "workspace_progress",
		validate: (ctx) => validateWorkspaceProgressSinceGateBlock(ctx.config, ctx.checkpointHash),
		soft: true,
	},
	{
		stage: "demo_command",
		validate: (ctx) => validateCompletionDemoCommand(ctx.params.command),
	},
]

export type GatePreflightReadinessIssue = {
	stage: CompletionPreflightStage
	message: string
	/** Completion-gate findings are diagnostics only and never execution blockers. */
	severity: "warning" | "info"
}

/** Lane-local blocking stages only — parent-only checks deferred to seal barrier (ADR-013). */
export const SUBAGENT_LANE_PREFLIGHT_STAGES = new Set<CompletionPreflightStage>([
	"quality",
	"min_length",
	"max_length",
	"demo_command",
])

/** Non-mutating preflight dry-run — surfaces blockers before attempt_completion (mirrors CI dry-run). */
export function evaluateGatePreflightReadiness(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
): GatePreflightReadinessIssue[] {
	const preflightContext: PreflightCheckContext = {
		config,
		params,
		checkpointHash: getLatestCheckpointHashFromMessages(config),
		validateQuality,
	}

	const issues: GatePreflightReadinessIssue[] = []
	for (const runner of PREFLIGHT_STAGE_RUNNERS) {
		const stageError = runner.validate(preflightContext)
		if (stageError) {
			issues.push({ stage: runner.stage, message: stageError, severity: runner.soft ? "info" : "warning" })
		}
	}
	return issues
}

/** Async dry-run — includes roadmap governance stage (mirrors full preflight minus audit). */
export async function evaluateGatePreflightReadinessAsync(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
	logPrefix = "GatePreflightReadiness",
): Promise<GatePreflightReadinessIssue[]> {
	const issues = evaluateGatePreflightReadiness(config, params, validateQuality)

	const roadmapError = await evaluateRoadmapCompletionGateError(config, logPrefix, { dryRun: true })
	if (roadmapError) {
		issues.push({ stage: "roadmap", message: roadmapError, severity: "warning" })
	} else if (getRoadmapConfig().enabled) {
		try {
			const block = await evaluateRoadmapCompletionBlock(config.cwd, { dryRun: true })
			const advisory = roadmapPreflightReadinessFromDryRun(block)
			if (advisory) {
				issues.push({ stage: advisory.stage, message: advisory.message, severity: "info" })
			}
		} catch {
			// non-fatal — readiness hint must not block completion attempt
		}
	}

	return issues
}

export async function runCompletionPreflightChecks(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
	},
	logPrefix: string,
	_checks: {
		validateQuality: (result: string) => string | null
		onFailure: (config: TaskConfig) => void
	},
): Promise<GatePreflightReadinessIssue[]> {
	return evaluateGatePreflightReadinessAsync(config, params, _checks.validateQuality, logPrefix)
}

export function hashCompletionAuditInput(result: string, taskDescription: string, checkpointHash?: string): string {
	return createHash("sha256")
		.update(result.trim())
		.update("|")
		.update(taskDescription.slice(0, 500))
		.update("|")
		.update(checkpointHash ?? "")
		.digest("hex")
}

/** Record advisory audit for completion cache reuse (act-mode, deferred command audit). */
export function recordAdvisoryAuditCache(
	config: TaskConfig,
	result: string,
	taskDescription: string,
	metadata: TaskAuditMetadata,
): void {
	config.taskState.lastAdvisoryAudit = metadata
	config.taskState.lastAdvisoryAuditCacheKey = hashCompletionAuditInput(
		result,
		taskDescription,
		getLatestCheckpointHashFromMessages(config),
	)
	config.taskState.lastAdvisoryAuditCachedAt = Date.now()
}

async function resolveCompletionAuditMetadata(
	config: TaskConfig,
	params: { result: string; taskDescription: string },
): Promise<TaskAuditMetadata> {
	const checkpointHash = getLatestCheckpointHashFromMessages(config)
	const cacheKey = hashCompletionAuditInput(params.result, params.taskDescription, checkpointHash)
	const cachedAt = config.taskState.lastCompletionAuditCachedAt
	const cachedKey = config.taskState.lastCompletionAuditCacheKey
	const cached = config.taskState.lastCompletionAudit
	const currentRevision = getCompletionGraphRevision(config)

	// Cache reuse requires BOTH cache key match AND graph revision match.
	// The cache key includes the checkpoint hash (workspace fingerprint), and
	// the graph revision tracks meaningful state transitions.  Requiring both
	// prevents false-positive "passed" audits when the workspace changed but
	// the checkpoint hash didn't (e.g. edits without a checkpoint save).
	// TTL alone is insufficient — it only prevents redundant audit runs within
	// the same stable state, not across state transitions.
	if (
		cached &&
		cachedKey === cacheKey &&
		config.taskState.lastCompletionAuditGraphRevision === currentRevision &&
		cachedAt &&
		Date.now() - cachedAt < COMPLETION_AUDIT_CACHE_TTL_MS
	) {
		return cached
	}
	// Secondary cache: same graph revision + key match without TTL check.
	// This handles the edge case where the TTL expired but no meaningful
	// state changed — the audit is still authoritative for this revision.
	if (cached && cachedKey === cacheKey && config.taskState.lastCompletionAuditGraphRevision === currentRevision) {
		// Refresh the timestamp to extend the TTL window — the audit is still valid.
		config.taskState.lastCompletionAuditCachedAt = Date.now()
		return cached
	}

	const advisoryKey = config.taskState.lastAdvisoryAuditCacheKey
	const advisoryAt = config.taskState.lastAdvisoryAuditCachedAt
	const advisory = config.taskState.lastAdvisoryAudit
	if (advisory && advisoryKey === cacheKey && advisoryAt && Date.now() - advisoryAt < COMPLETION_AUDIT_CACHE_TTL_MS) {
		config.taskState.lastCompletionAuditCacheKey = cacheKey
		config.taskState.lastCompletionAuditCachedAt = Date.now()
		config.taskState.lastCompletionAuditGraphRevision = currentRevision
		return advisory
	}

	let auditMetadata = await runCompletionAudit(config.taskId, params.taskDescription, params.result, params.taskDescription)
	auditMetadata = await applyWorkspaceAuditPolicy(config.cwd, auditMetadata, config)
	config.taskState.lastCompletionAuditCacheKey = cacheKey
	config.taskState.lastCompletionAuditCachedAt = Date.now()
	config.taskState.lastCompletionAuditGraphRevision = currentRevision
	return auditMetadata
}

export async function evaluateRoadmapCompletionGateError(
	config: TaskConfig,
	logPrefix: string,
	_options?: { dryRun?: boolean },
): Promise<string | null> {
	const roadmapService = RoadmapService.getInstance()
	if (!roadmapService.isEnabled()) {
		return null
	}

	try {
		const block = await evaluateRoadmapCompletionBlock(config.cwd, { dryRun: true })
		if (block.blocked) {
			const remediated = formatAutoRemediationSummary(block.remediationSteps || [])
			const base = block.message || failClosedCompletionMessage()
			return normalizeAdvisoryDiagnosticCopy(remediated ? `${base}\n\n${remediated}` : base)
		}
		if (block.dryRunAdvisory) {
			return null
		}
	} catch (error) {
		Logger.error(`[${logPrefix}] Failed to evaluate Roadmap Governance Gates:`, error)
		if (roadmapService.getConfig().fail_closed_completion_gates) {
			return `Roadmap diagnostics unavailable: ${normalizeAdvisoryDiagnosticCopy(failClosedCompletionMessage())}`
		}
	}

	return null
}

function normalizeAdvisoryDiagnosticCopy(message: string): string {
	return `Advisory roadmap diagnostic: ${message}`
		.replace(/task completion blocked:?/gi, "quality findings detected:")
		.replace(/attempt_completion blocked/gi, "attempt_completion quality findings")
		.replace(/\bblocked\b/gi, "flagged")
}

export async function evaluateCompletionAuditGate(
	config: TaskConfig,
	params: {
		result: string
		taskDescription: string
		logPrefix: string
	},
): Promise<CompletionAuditGateResult> {
	if (!config.auditCompletionGateEnabled) {
		return { status: "skipped" }
	}

	const checkpointHash = getLatestCheckpointHashFromMessages(config)

	// Fast-path: reuse cached audit ONLY when ALL of the following hold:
	//   1. Cache key matches (includes checkpoint hash — workspace fingerprint)
	//   2. Graph revision matches (meaningful state hasn't changed since cache)
	//   3. Engineering is verified (latch active — finalization lane eligible)
	//
	// The graph revision check is AND'd, not OR'd with TTL.  A TTL-only match
	// is insufficient for the fast-path because the agent may have made edits
	// that didn't trigger a checkpoint save but DID change workspace state.
	// Graph revision increments on every gate block and attempt finish, so it
	// catches all meaningful transitions.
	//
	// Mirrors CDN cache validation: both ETag (cache key) AND Last-Modified
	// (graph revision) must match before serving from cache without revalidation.
	const cacheKey = hashCompletionAuditInput(params.result, params.taskDescription, checkpointHash)
	const cachedAt = config.taskState.lastCompletionAuditCachedAt
	const cachedKey = config.taskState.lastCompletionAuditCacheKey
	const cachedAudit = config.taskState.lastCompletionAudit
	const currentRevision = getCompletionGraphRevision(config)
	const isCacheValid =
		cachedAudit &&
		cachedKey === cacheKey &&
		config.taskState.lastCompletionAuditGraphRevision === currentRevision &&
		cachedAt !== undefined &&
		Date.now() - cachedAt < COMPLETION_AUDIT_CACHE_TTL_MS

	if (isCacheValid && config.taskState.engineeringVerifiedAt) {
		// Re-evaluate the gate decision with the cached metadata to produce a
		// fresh result object, but skip the expensive audit run and policy load.
		try {
			const gateContext = await resolveCompletionGateContext(config, config.cwd, {
				lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
			})
			const gateOptions = gateContext.options
			const gateDecision = evaluateAuditGate(cachedAudit, gateOptions)
			if (!gateDecision.blocked) {
				return {
					status: "advisory_passed",
					auditMetadata: cachedAudit,
					gateDecision,
					gateOptions,
					policyProvenance: gateContext.policyProvenance,
				}
			}
		} catch {
			// Fall through to full evaluation if fast-path fails
		}
	}

	try {
		const messages = config.messageState?.getDietCodeMessages?.() ?? []
		const planBaseline = resolvePlanBaselineMetadata(messages, config.taskState.lastPlanAuditMetadata)
		const auditMetadata = await resolveCompletionAuditMetadata(config, params)

		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			planBaselineMetadata: planBaseline,
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateOptions = gateContext.options
		const gateDecision = evaluateAuditGate(auditMetadata, gateOptions)

		if (gateDecision.blocked) {
			const auditHumanMessage = buildCompletionGateMessage(auditMetadata, {
				scoreThreshold: config.auditCompletionGateThreshold,
				criticalOnly: gateOptions.criticalOnly ?? config.auditCompletionGateCriticalOnly,
				intentAdjustedThreshold: config.auditIntentThresholdAdjustmentsEnabled,
				intentThresholdOverrides: parseIntentThresholdOverrides(config.auditIntentThresholdOverrides),
				advisoryMetadata: config.taskState.lastAdvisoryAudit,
				planBaselineMetadata: planBaseline,
				gateDecision,
			})
			const checklistSummary = buildPreCompletionChecklistSummary(auditMetadata, gateOptions)
			const checklistBlock = checklistSummary ? buildPreCompletionChecklistBlock(checklistSummary) : ""
			const diagnostics = [auditHumanMessage, checklistBlock].filter(Boolean).join("\n\n")

			return {
				status: "advisory_failed",
				diagnostics,
				auditMetadata,
				gateDecision,
				gateOptions,
				policyProvenance: gateContext.policyProvenance,
			}
		}

		return {
			status: "advisory_passed",
			auditMetadata,
			planBaseline,
			gateDecision,
			gateOptions,
			policyProvenance: gateContext.policyProvenance,
		}
	} catch (error) {
		Logger.warn(`[${params.logPrefix}] Completion audit diagnostics unavailable:`, error)
		return {
			status: "diagnostic_error",
			diagnostics:
				"Completion diagnostics are advisory and were unavailable. Follow the canonical next action from the lifecycle decision.",
		}
	}
}

export type CompletionGateFlowResult = {
	status: "diagnostics"
	preflight: GatePreflightReadinessIssue[]
	audit: CompletionAuditGateResult
}

export type SubagentCompletionGateResult = {
	error: string | null
	advisoryAudit?: TaskAuditMetadata
	advisoryWouldBlock?: boolean
}

/** Fast lane preflight — quality/safety only; no parent circuit breaker or gate telemetry. */
export function runSubagentCompletionLanePreflight(
	config: TaskConfig,
	params: {
		result: string
		command?: string
		laneExecutionMode?: LaneExecutionMode
	},
	validateQuality: (result: string) => string | null = validateCompletionResultQuality,
): string[] {
	const preflightContext: PreflightCheckContext = {
		config,
		params,
		validateQuality,
	}
	const ioAuthorityLane = params.laneExecutionMode ? isNonMutatingMode(params.laneExecutionMode) : false
	const diagnostics: string[] = []

	for (const runner of PREFLIGHT_STAGE_RUNNERS) {
		if (!SUBAGENT_LANE_PREFLIGHT_STAGES.has(runner.stage)) {
			continue
		}
		if (runner.stage === "min_length" && ioAuthorityLane) {
			const trimmed = params.result.trim()
			if (trimmed.length < SUBAGENT_IO_LANE_RESULT_MIN_LENGTH) {
				diagnostics.push(
					`Advisory: lane result is brief (${trimmed.length} chars, suggested minimum ${SUBAGENT_IO_LANE_RESULT_MIN_LENGTH} for I/O authority lanes).`,
				)
			}
			continue
		}
		const stageError = runner.validate(preflightContext)
		if (stageError) {
			diagnostics.push(`Advisory (${runner.stage}): ${stageError}`)
		}
	}

	return diagnostics
}

/**
 * Shadow audit for subagent lanes — records findings without blocking throughput.
 * Full enforcement remains at the parent seal barrier and parent attempt_completion.
 */
export async function evaluateSubagentAdvisoryAudit(
	config: TaskConfig,
	params: {
		result: string
		taskDescription: string
		logPrefix: string
	},
): Promise<{ metadata?: TaskAuditMetadata; wouldBlock: boolean }> {
	if (!config.auditCompletionGateEnabled) {
		return { wouldBlock: false }
	}

	try {
		const messages = config.messageState?.getDietCodeMessages?.() ?? []
		const planBaseline = resolvePlanBaselineMetadata(messages, config.taskState.lastPlanAuditMetadata)
		let auditMetadata = await runCompletionAudit(config.taskId, params.taskDescription, params.result, params.taskDescription)
		auditMetadata = await applyWorkspaceAuditPolicy(config.cwd, auditMetadata, config)

		const gateContext = await resolveCompletionGateContext(config, config.cwd, {
			planBaselineMetadata: planBaseline,
			lastAdvisoryAudit: config.taskState.lastAdvisoryAudit,
		})
		const gateDecision = evaluateAuditGate(auditMetadata, gateContext.options)
		if (gateDecision.blocked) {
			config.taskState.lastAdvisoryAudit = auditMetadata
			return { metadata: auditMetadata, wouldBlock: true }
		}

		return { metadata: auditMetadata, wouldBlock: false }
	} catch (error) {
		Logger.warn(`[${params.logPrefix}] Subagent advisory audit skipped (non-blocking):`, error)
		return { wouldBlock: false }
	}
}

/** Parent completion diagnostics — never an execution authority. */
export async function runCompletionGateFlow(
	config: TaskConfig,
	params: {
		result: string
		taskProgress?: string
		command?: string
		taskDescription?: string
	},
	logPrefix: string,
): Promise<CompletionGateFlowResult> {
	const preflight = await runCompletionPreflightChecks(config, params, logPrefix, {
		validateQuality: validateCompletionResultQuality,
		onFailure: () => undefined,
	})

	const auditResult = await evaluateCompletionAuditGate(config, {
		result: params.result,
		taskDescription: params.taskDescription ?? params.result,
		logPrefix,
	})

	return { status: "diagnostics", preflight, audit: auditResult }
}
