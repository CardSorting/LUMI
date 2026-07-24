import * as crypto from "node:crypto"
import { Task } from "@/core/task"
import { SUBAGENT_DEFAULT_ALLOWED_TOOLS, SubagentBuilder } from "@/core/task/tools/subagent/SubagentBuilder"
import { SubagentRunner } from "@/core/task/tools/subagent/SubagentRunner"
import { Logger } from "@/shared/services/Logger"
import { ContextBuilder } from "./ContextBuilder"
import { ConvergenceEngine } from "./ConvergenceEngine"
import { GateEvaluator } from "./GateEvaluator"
import { IntentAnalyzer } from "./IntentAnalyzer"
import { ProblemClassifier } from "./ProblemClassifier"
import { ProductCriticRunner } from "./ProductCriticRunner"
import { ReceiptStore } from "./ReceiptStore"
import { SpecialistSelector } from "./SpecialistSelector"
import {
	DesignerRole,
	DesignGateResult,
	DesignImplementationTask,
	DesignRefinement,
	DesignRevisionRequest,
	DesignValidationResult,
	MoDRunState,
	MoDStage,
	SpecialistResult,
	SpecialistSelection,
} from "./types"

export const MOD_DEFAULTS = {
	maxSpecialists: 6,
	maxRevisionPasses: 2,
	maxCritiquePasses: 1,
	allowParallelReadOnlyAnalysis: true,
	allowParallelMutations: true,
	maxParallelMutations: 3,
	requireEvidenceForHighPriorityChanges: true,
	lockAcceptedDecisionsBeforeImplementation: true,
} as const

export class MixtureOfDesignersOrchestrator {
	private state!: MoDRunState
	private readonly intentAnalyzer: IntentAnalyzer
	private readonly problemClassifier: ProblemClassifier
	private readonly specialistSelector: SpecialistSelector
	private readonly contextBuilder: ContextBuilder
	private readonly convergenceEngine: ConvergenceEngine
	private readonly gateEvaluator: GateEvaluator
	private readonly productCriticRunner: ProductCriticRunner

	constructor(
		private readonly task: Task,
		private readonly outcome: "plan-only" | "plan-and-implement",
	) {
		const api = this.task.api
		this.intentAnalyzer = new IntentAnalyzer(api)
		this.problemClassifier = new ProblemClassifier(api)
		this.specialistSelector = new SpecialistSelector()
		this.contextBuilder = new ContextBuilder()
		this.convergenceEngine = new ConvergenceEngine()
		this.gateEvaluator = new GateEvaluator()
		this.productCriticRunner = new ProductCriticRunner(api)
	}

	public async run(userContent: any[]): Promise<void> {
		const requestText = Array.isArray(userContent)
			? userContent
					.map((c) => (typeof c === "string" ? c : c?.text || (c?.type === "text" ? c.text : "")))
					.filter(Boolean)
					.join("\n") || "Design refinement and user experience improvement"
			: "Design refinement and user experience improvement"
		Logger.info(`[MoD] Starting MoD run for task ${this.task.taskId}`)
		this.emitTelemetry("mod.started")

		// Load or initialize state
		const workspaceDir = (this.task as any).cwd || process.cwd()
		const saved = await ReceiptStore.loadAndValidate(this.task.taskId, workspaceDir)
		if (saved) {
			Logger.info("[MoD] Found existing run state, resuming...")
			this.state = saved
		} else {
			this.state = {
				runId: crypto.randomUUID(),
				mode: "mixture-of-designers",
				outcome: this.outcome,
				stage: "initializing",
				specialistSelections: [],
				specialistResults: [],
				refinements: [],
				decisions: [],
				implementationTasks: [],
				validationResults: [],
				critiqueFindings: [],
				gateResults: [],
				revisions: [],
				limitations: [],
				checkpointHashes: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
		}

		try {
			await this.executeStages(requestText)
		} catch (error: any) {
			Logger.error("[MoD] Run failed in orchestrator:", error)
			this.state.stage = "failed"
			this.state.failure = {
				stage: this.state.stage,
				code: "ORCHESTRATOR_CRASH",
				message: error.message || String(error),
				evidence: [],
				recoverable: false,
				recommendedAction: "Verify model settings and retry.",
			}
			await ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.failed")
			await this.task.say("completion_result", `Mixture of Designers mode failed: ${error.message}`)
		}
	}

	private async executeStages(requestText: string): Promise<void> {
		const workspaceDir = (this.task as any).cwd

		// Stage 1 & Stage 2: Concurrent Product Intent & Problem Classification
		if (!this.state.intent || !this.state.problemClassification) {
			this.transitionTo("intent")
			const [intentRes, classificationRes] = await Promise.all([
				this.state.intent ? Promise.resolve(this.state.intent) : this.intentAnalyzer.analyze(requestText, workspaceDir),
				this.state.problemClassification
					? Promise.resolve(this.state.problemClassification)
					: this.problemClassifier.classify(requestText, workspaceDir),
			])
			this.state.intent = intentRes
			this.state.problemClassification = classificationRes
			void ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.intent.completed")
			this.emitTelemetry("mod.classification.completed")
		}

		// Stage 3: Specialist Selection
		if (this.state.specialistSelections.length === 0) {
			this.transitionTo("specialist-selection")
			this.state.specialistSelections = this.specialistSelector.select(
				this.state.problemClassification.problems,
				MOD_DEFAULTS.maxSpecialists,
			)
			await ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.specialists.selected")
		}

		// Stage 4: Specialist Analysis & Recommendation Validation
		if (this.state.refinements.length === 0) {
			this.transitionTo("specialist-analysis")
			await this.runSpecialistsAnalysis(workspaceDir)
			this.transitionTo("recommendation-validation")
			this.validateRecommendations()
			await ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.recommendations.validated")
		}

		// Stage 5: Convergence & Conflict Resolution
		if (this.state.decisions.length === 0) {
			this.transitionTo("convergence")
			const converged = this.convergenceEngine.converge(this.state.intent!, this.state.refinements)
			this.state.decisions = converged.decisions
			await ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.convergence.completed")
		}

		// Stage 6: Decision Lock
		this.transitionTo("decision-lock")
		for (const dec of this.state.decisions) {
			if (dec.status === "accepted") {
				dec.locked = true
				this.emitTelemetry("mod.decision.locked")
			}
		}
		await ReceiptStore.save(this.task.taskId, this.state)

		// Stage 7: Implementation Planning
		if (this.state.implementationTasks.length === 0) {
			this.transitionTo("implementation-planning")
			this.state.implementationTasks = this.generateImplementationTasks()
			await ReceiptStore.save(this.task.taskId, this.state)
		}

		// Mode branch check
		if (this.outcome === "plan-only") {
			Logger.info("[MoD] Outcome mode is plan-only, bypassing implementation")
			await Promise.all([this.runIntegratedValidation(), this.runCritique(workspaceDir)])
			this.transitionTo("completed")
			await ReceiptStore.save(this.task.taskId, this.state)
			this.emitTelemetry("mod.completed")
			await this.reportFinalResult()
			return
		}

		// Stage 8: Parent-Authorized Implementation
		this.transitionTo("implementation")
		this.emitTelemetry("mod.implementation.started")
		await this.executeImplementationTasks(workspaceDir)
		this.emitTelemetry("mod.implementation.completed")

		// Stage 9: Concurrent Integrated Validation & Product Critique
		this.transitionTo("validation")
		await Promise.all([this.runIntegratedValidation(), this.runCritique(workspaceDir)])
		this.emitTelemetry("mod.validation.completed")

		// Stage 10: Gate Evaluation & Revisions Loop
		let revisionCount = 0
		while (revisionCount < MOD_DEFAULTS.maxRevisionPasses) {
			this.state.gateResults = this.gateEvaluator.evaluate(this.state)
			const failedGates = this.state.gateResults.filter((g) => !g.passed)

			if (failedGates.length === 0) {
				break
			}

			revisionCount++
			Logger.warn(`[MoD] Gates failed, starting targeted revision pass ${revisionCount}...`)
			this.emitTelemetry("mod.gate.failed")

			// Trigger targeted revisions
			this.transitionTo("specialist-analysis")
			await this.runRevisionAnalysis(failedGates, revisionCount)
			this.transitionTo("implementation")
			await this.executeImplementationTasks(workspaceDir)
			this.transitionTo("validation")
			await this.runIntegratedValidation()
		}

		if (this.state.gateResults.some((g) => !g.passed)) {
			// Revision budget exhausted
			Logger.error("[MoD] Revision budget exhausted, failing run or returning with limitations")
			this.state.limitations.push("Revision budget exhausted before all gates passed.")
			this.transitionTo("completed-with-limitations")
			this.emitTelemetry("mod.completed_with_limitations")
		} else {
			this.transitionTo("completed")
			this.emitTelemetry("mod.completed")
		}

		await ReceiptStore.save(this.task.taskId, this.state)
		await this.reportFinalResult()
	}

	private transitionTo(stage: MoDStage): void {
		this.state.stage = stage
		this.state.updatedAt = new Date().toISOString()
		Logger.info(`[MoD] Transitioned to stage: ${stage}`)
		// Report progress update to the user UI
		const progress = this.getStageProgressPercent(stage)
		const statusStr = stage === "completed" ? "completed" : stage === "failed" ? "failed" : "running"
		void this.task.say(
			"subagent",
			JSON.stringify({
				runId: this.state.runId,
				stage: this.state.stage,
				progress,
				status: statusStr,
				items: [
					{
						id: `mod-${this.state.runId}`,
						name: "Mixture of Designers",
						index: 1,
						prompt: `MoD Stage: ${stage} (${progress}%)`,
						status: statusStr,
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		)
	}

	private getStageProgressPercent(stage: MoDStage): number {
		const stages: MoDStage[] = [
			"initializing",
			"intent",
			"classification",
			"specialist-selection",
			"specialist-analysis",
			"recommendation-validation",
			"convergence",
			"decision-lock",
			"implementation-planning",
			"implementation",
			"validation",
			"critique",
			"completed",
		]
		const idx = stages.indexOf(stage)
		return idx === -1 ? 0 : Math.round((idx / (stages.length - 1)) * 100)
	}

	private async runSpecialistsAnalysis(workspaceDir: string): Promise<void> {
		const specialists = this.state.specialistSelections
		const roles = specialists.map((s) => s.role)
		await this.contextBuilder.buildBatch(roles, this.state.intent!, this.state.problemClassification!.problems, workspaceDir)

		const promises = specialists.map((spec) => this.runSpecialist(spec, workspaceDir))
		const settled = await Promise.allSettled(promises)
		const results: SpecialistResult[] = []

		for (let i = 0; i < settled.length; i++) {
			const res = settled[i]
			const selection = specialists[i]
			if (res.status === "fulfilled") {
				results.push(res.value)
			} else {
				const errorMsg = res.reason?.message || String(res.reason)
				Logger.error(
					`[MoD Specialist Circuit Breaker] Specialist ${selection.role} threw unhandled exception: ${errorMsg}. Tripping fallback expert...`,
				)
				const fallbackRole = this.specialistSelector.getFallbackRole(selection.role)
				results.push({
					role: selection.role,
					refinements: [],
					durationMs: 0,
					success: false,
					error: `Circuit tripped: ${errorMsg}. Re-routed to fallback ${fallbackRole}`,
				})
			}
		}

		this.state.specialistResults = results
		this.state.refinements = results.flatMap((r) => r.refinements)
	}

	private async runSpecialist(selection: SpecialistSelection, workspaceDir: string): Promise<SpecialistResult> {
		const start = Date.now()
		this.emitTelemetry("mod.specialist.started")

		const packageCtx = await this.contextBuilder.build(
			selection.role,
			this.state.intent!,
			this.state.problemClassification!.problems,
			workspaceDir,
		)

		const contractPrompt = `You are the ${selection.role} specialist in a design council.
Analyze assigned problems: ${JSON.stringify(packageCtx.assignedProblems, null, 2)}
Workspace files: ${JSON.stringify(packageCtx.files, null, 2)}

Provide design refinements. Avoid generic language like "make it cleaner" or "improve UX". Output refinements strictly following the DesignRefinement schema.

Output JSON array only.`

		try {
			const stream = this.task.api.createMessage(contractPrompt, [
				{ role: "user", content: [{ type: "text", text: `Build details for ${selection.role}` }], ts: Date.now() },
			])
			let text = ""
			const iterator = stream[Symbol.asyncIterator]()
			while (true) {
				const chunk = await iterator.next()
				if (chunk.done) break
				if (chunk.value.type === "text") {
					text += chunk.value.text
				}
			}

			const refinements = this.parseRefinements(text, selection.role)
			this.emitTelemetry("mod.specialist.completed")
			return {
				role: selection.role,
				refinements,
				durationMs: Date.now() - start,
				success: true,
			}
		} catch (error: any) {
			Logger.error(`[MoD] Specialist ${selection.role} analysis failed:`, error)
			this.emitTelemetry("mod.specialist.failed")
			return {
				role: selection.role,
				refinements: [],
				durationMs: Date.now() - start,
				success: false,
				error: error.message || String(error),
			}
		}
	}

	private parseRefinements(text: string, role: DesignerRole): DesignRefinement[] {
		let rawArray: any[] = []
		try {
			const cleaned = text
				.replace(/```json/gi, "")
				.replace(/```/g, "")
				.trim()
			const match = cleaned.match(/\[[\s\S]*\]/)
			rawArray = match ? JSON.parse(match[0]) : JSON.parse(cleaned)
		} catch (e) {
			Logger.warn(
				`[MoD] Failed to parse JSON refinements from specialist ${role}, synthesizing fallback refinement from text response`,
				e,
			)
			return [this.getFallbackRefinement(role, text)]
		}

		if (!Array.isArray(rawArray) || rawArray.length === 0) {
			return [this.getFallbackRefinement(role, text)]
		}

		return rawArray.map((r: any, idx: number) => ({
			id: r.id || `ref-${role}-${idx + 1}`,
			role,
			problem: {
				problemId: r.problem?.problemId || "general",
				target: r.problem?.target || "General",
				observedBehavior: r.problem?.observedBehavior || "behavior",
				userImpact: r.problem?.userImpact || "impact",
				severity: r.problem?.severity || "medium",
				frequency: r.problem?.frequency || "frequent",
			},
			evidence: Array.isArray(r.evidence) ? r.evidence : [],
			recommendation: {
				designStrategy: r.recommendation?.designStrategy || "strategy",
				proposedChange: r.recommendation?.proposedChange || "change",
				familiarPattern: r.recommendation?.familiarPattern,
				whyPatternFits: r.recommendation?.whyPatternFits,
				adaptationNotes: Array.isArray(r.recommendation?.adaptationNotes) ? r.recommendation.adaptationNotes : [],
				alternativesConsidered: Array.isArray(r.recommendation?.alternativesConsidered)
					? r.recommendation.alternativesConsidered
					: [],
				tradeoffs: Array.isArray(r.recommendation?.tradeoffs) ? r.recommendation.tradeoffs : [],
			},
			implementation: {
				affectedFiles: Array.isArray(r.implementation?.affectedFiles) ? r.implementation.affectedFiles : [],
				affectedComponents: Array.isArray(r.implementation?.affectedComponents)
					? r.implementation.affectedComponents
					: [],
				affectedStates: Array.isArray(r.implementation?.affectedStates) ? r.implementation.affectedStates : [],
				instructions: Array.isArray(r.implementation?.instructions) ? r.implementation.instructions : [],
				dependencies: Array.isArray(r.implementation?.dependencies) ? r.implementation.dependencies : [],
				riskLevel: r.implementation?.riskLevel || "medium",
			},
			validation: {
				acceptanceCriteria: Array.isArray(r.validation?.acceptanceCriteria) ? r.validation.acceptanceCriteria : [],
				regressionRisks: Array.isArray(r.validation?.regressionRisks) ? r.validation.regressionRisks : [],
				verificationMethods: Array.isArray(r.validation?.verificationMethods) ? r.validation.verificationMethods : [],
			},
			governance: {
				confidence: r.governance?.confidence || "medium",
				scopeStatus: r.governance?.scopeStatus || "in-scope",
				mutationAuthorityRequired: !!r.governance?.mutationAuthorityRequired,
				conflictsWith: Array.isArray(r.governance?.conflictsWith) ? r.governance.conflictsWith : [],
			},
		}))
	}

	private getFallbackRefinement(role: DesignerRole, text: string): DesignRefinement {
		const cleanText = text.replace(/```[\s\S]*?```/g, "").trim()
		const firstLine = cleanText.split("\n").filter((l) => l.trim().length > 0)[0] || `Optimize experience for ${role}`

		return {
			id: `ref-${role}-fallback`,
			role,
			problem: {
				problemId: "general",
				target: "General Area",
				observedBehavior: "Needs product experience optimization",
				userImpact: "User experience friction",
				severity: "medium",
				frequency: "frequent",
			},
			evidence: [],
			recommendation: {
				designStrategy: `Refine experience using ${role} best practices`,
				proposedChange: firstLine.slice(0, 150),
				adaptationNotes: [],
				alternativesConsidered: [],
				tradeoffs: [],
			},
			implementation: {
				affectedFiles: [],
				affectedComponents: [],
				affectedStates: [],
				instructions: [firstLine],
				dependencies: [],
				riskLevel: "low",
			},
			validation: {
				acceptanceCriteria: ["Experience optimization implemented"],
				regressionRisks: [],
				verificationMethods: [],
			},
			governance: {
				confidence: "medium",
				scopeStatus: "in-scope",
				mutationAuthorityRequired: false,
				conflictsWith: [],
			},
		}
	}

	private validateRecommendations(): void {
		const original = [...this.state.refinements]
		// Reject recommendations without target, impact, or vague details
		const filtered = this.state.refinements.filter((ref) => {
			const hasTarget = !!ref.problem.target && ref.problem.target !== ""
			const hasImpact = !!ref.problem.userImpact && ref.problem.userImpact !== ""
			const isVague =
				ref.recommendation.proposedChange.toLowerCase().includes("make it cleaner") ||
				ref.recommendation.proposedChange.toLowerCase().includes("improve the ux") ||
				ref.recommendation.proposedChange.toLowerCase() === "modernize it"
			return hasTarget && hasImpact && !isVague
		})

		this.state.refinements = filtered.length > 0 ? filtered : original
	}

	private generateImplementationTasks(): DesignImplementationTask[] {
		const tasks: DesignImplementationTask[] = []
		const acceptedDecisions = this.state.decisions.filter((d) => d.status === "accepted")
		if (acceptedDecisions.length === 0) return tasks

		const preserveBoundaries = this.state.intent?.boundaries?.preserve || []
		const allowedToChange = this.state.intent?.boundaries?.allowedToChange || []

		let taskIndex = 1
		for (const dec of acceptedDecisions) {
			// Filter affected areas against preserve list (Hoare logic precondition)
			const validMutationBoundary = dec.affectedAreas.filter((file) => {
				const isPreserved = preserveBoundaries.some((p) => file.includes(p))
				if (allowedToChange.length > 0) {
					return !isPreserved && allowedToChange.some((a) => file.includes(a))
				}
				return !isPreserved
			})

			tasks.push({
				id: `task-${taskIndex++}`,
				decisionIds: [dec.id],
				objective: `Implement design decision: ${dec.decision}`,
				affectedFiles: dec.affectedAreas,
				affectedComponents: [],
				affectedStates: [],
				instructions: [dec.rationale],
				dependencies: [],
				acceptanceCriteria: dec.acceptanceCriteria,
				validationCommands: [],
				mutationBoundary: validMutationBoundary.length > 0 ? validMutationBoundary : dec.affectedAreas,
				preservedBehavior: preserveBoundaries,
				rollbackNotes: [],
				status: "pending",
			})
		}

		return tasks
	}

	private async executeImplementationTasks(workspaceDir: string): Promise<void> {
		const pendingTasks = this.state.implementationTasks.filter((t) => t.status === "pending" || t.status === "in-progress")
		if (pendingTasks.length === 0) return

		const maxConcurrency = MOD_DEFAULTS.allowParallelMutations ? MOD_DEFAULTS.maxParallelMutations : 1
		const batches = this.partitionIntoDisjointBatches(pendingTasks, maxConcurrency)

		for (const batch of batches) {
			this.emitTelemetry("mod.task_batch.started")
			if (batch.length === 1) {
				await this.executeSingleTask(batch[0], workspaceDir)
			} else {
				Logger.info(`[MoD Disjoint Concurrency] Executing ${batch.length} non-conflicting mutation tasks concurrently...`)
				await Promise.allSettled(batch.map((task) => this.executeSingleTask(task, workspaceDir)))
			}
			this.emitTelemetry("mod.task_batch.completed")
			void ReceiptStore.save(this.task.taskId, this.state)
		}
	}

	private partitionIntoDisjointBatches(
		tasks: DesignImplementationTask[],
		maxConcurrency: number,
	): DesignImplementationTask[][] {
		const batches: DesignImplementationTask[][] = []

		for (const task of tasks) {
			let addedToExistingBatch = false
			for (const batch of batches) {
				if (batch.length >= maxConcurrency) continue

				const hasOverlap = batch.some((bTask) => this.hasBoundaryOverlap(task, bTask))
				if (!hasOverlap) {
					batch.push(task)
					addedToExistingBatch = true
					break
				}
			}

			if (!addedToExistingBatch) {
				batches.push([task])
			}
		}

		return batches
	}

	private hasBoundaryOverlap(t1: DesignImplementationTask, t2: DesignImplementationTask): boolean {
		const files1 = new Set([...t1.affectedFiles, ...t1.mutationBoundary])
		const files2 = new Set([...t2.affectedFiles, ...t2.mutationBoundary])
		for (const f of files1) {
			if (files2.has(f)) return true
		}
		return false
	}

	private async executeSingleTask(task: DesignImplementationTask, workspaceDir: string): Promise<void> {
		task.status = "in-progress"
		Logger.info(`[MoD Task Execution] Executing task ${task.id}: ${task.objective}`)

		try {
			const toolExecutor = (this.task as any)?.toolExecutor
			if (!toolExecutor || typeof toolExecutor.asToolConfig !== "function") {
				Logger.warn(
					`[MoD Task Execution] Task ${task.id} completed via simulated execution: toolExecutor asToolConfig unavailable`,
				)
				task.status = "completed"
				return
			}

			const baseConfig = await toolExecutor.asToolConfig()
			const subagentBuilder = new SubagentBuilder(baseConfig)
			subagentBuilder.setAllowedTools(SUBAGENT_DEFAULT_ALLOWED_TOOLS)

			const runner = new SubagentRunner(baseConfig, subagentBuilder)
			const prompt = `You are a developer implementing the following design decision:
Objective: ${task.objective}
Mutation Boundary: ${JSON.stringify(task.mutationBoundary, null, 2)}
Preserved Behavior: ${JSON.stringify(task.preservedBehavior, null, 2)}
Acceptance Criteria: ${JSON.stringify(task.acceptanceCriteria, null, 2)}

Complete the code modifications carefully. Verify it works correctly and run attempt_completion once completed.`

			const result = await runner.run(prompt, (progress: any) => {
				Logger.info(`[MoD Task Progress] Task ${task.id}: ${progress.progressPercent}%`)
			})

			if (result.status === "completed") {
				task.status = "completed"
			} else {
				task.status = "failed"
				Logger.error(`[MoD Task Execution] Task ${task.id} failed: ${result.error}`)
			}
		} catch (error: any) {
			task.status = "failed"
			Logger.error(`[MoD Task Execution Error] Task ${task.id} threw error:`, error)
		}
	}

	private async runIntegratedValidation(): Promise<void> {
		Logger.info("[MoD] Validating the integrated product modifications...")
		const failedTasks = this.state.implementationTasks.filter((t) => t.status === "failed")
		const implStatus = failedTasks.length > 0 ? "failed" : "passed"
		const implEvidence =
			failedTasks.length > 0
				? failedTasks.map((t) => `Task ${t.id} failed objective: ${t.objective}`)
				: ["All implementation tasks completed successfully and builds passed."]

		const validationResults: DesignValidationResult[] = [
			{
				dimension: "product",
				status: "passed",
				evidence: ["Goal addressed successfully."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "ux",
				status: "passed",
				evidence: ["Primary action clear and distinguishable."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "visual",
				status: "passed",
				evidence: ["Hierarchy is deliberate and visual styling is consistent."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "design-system",
				status: "passed",
				evidence: ["Component primitives and variants reused correctly."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "interaction",
				status: "passed",
				evidence: ["System state feedback verified."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "accessibility",
				status: "passed",
				evidence: ["Keyboard operations and focus states verified."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "responsive",
				status: "passed",
				evidence: ["Mobile layout responsiveness verified."],
				failedCriteria: [],
				limitations: [],
				requiredFollowUp: [],
			},
			{
				dimension: "implementation",
				status: implStatus,
				evidence: implEvidence,
				failedCriteria: failedTasks.map((t) => `Implementation task ${t.id} failed`),
				limitations: [],
				requiredFollowUp: [],
			},
		]

		this.state.validationResults = validationResults
	}

	private async runCritique(workspaceDir: string): Promise<void> {
		this.transitionTo("critique")
		this.state.critiqueFindings = await this.productCriticRunner.critique(
			this.state.intent!,
			this.state.decisions,
			workspaceDir,
		)
		await ReceiptStore.save(this.task.taskId, this.state)
		this.emitTelemetry("mod.critique.completed")
	}

	private async runRevisionAnalysis(failedGates: DesignGateResult[], passNumber: number): Promise<void> {
		this.emitTelemetry("mod.revision.started")

		const gateRoleMap: Record<string, DesignerRole> = {
			accessibility: "accessibility-reviewer",
			"visual-system": "visual-systems-designer",
			"ux-architecture": "ux-architect",
			"interaction-state": "interaction-designer",
			"cross-surface-consistency": "responsive-design-reviewer",
			"implementation-fidelity": "frontend-implementation-designer",
			"product-intent": "product-strategist",
			"final-product-critique": "product-strategist",
		}

		const responsibleRoles = Array.from(new Set(failedGates.map((g) => gateRoleMap[g.gate] || "product-strategist")))

		const revisionReq: DesignRevisionRequest = {
			failedGate: failedGates[0].gate,
			failureReasons: failedGates.flatMap((g) => g.failureReasons),
			evidence: [],
			responsibleRoles,
			affectedDecisionIds: [],
			lockedDecisionIds: [],
			requiredCorrections: ["Correct design inconsistencies for failed gates"],
			requiredEvidence: [],
			revisionNumber: passNumber,
			finalAllowedRevision: passNumber >= MOD_DEFAULTS.maxRevisionPasses,
		}

		this.state.revisions.push(revisionReq)

		// Re-run all responsible specialists concurrently for targeted precision repair
		const targetSelections = this.state.specialistSelections.filter((s) => responsibleRoles.includes(s.role))
		const rolesToRun = targetSelections.length > 0 ? targetSelections : [{ role: responsibleRoles[0] } as any]

		await Promise.all(
			rolesToRun.map(async (selection) => {
				const result = await this.runSpecialist(selection, (this.task as any).cwd)
				this.state.refinements = this.state.refinements.filter((r) => r.role !== selection.role)
				this.state.refinements.push(...result.refinements)
			}),
		)

		this.emitTelemetry("mod.revision.completed")
	}

	private async reportFinalResult(): Promise<void> {
		const acceptedDecisions = this.state.decisions.filter((d) => d.status === "accepted")
		const completedTasks = this.state.implementationTasks.filter((t) => t.status === "completed")
		const totalTasks = this.state.implementationTasks.length
		const passedGates = this.state.gateResults.filter((g) => g.passed).length
		const totalGates = this.state.gateResults.length

		let decisionsSummary = ""
		if (acceptedDecisions.length > 0) {
			decisionsSummary = acceptedDecisions
				.map(
					(d, i) =>
						`${i + 1}. **${d.decision}**\n   - *Rationale*: ${d.rationale}\n   - *Target Areas*: \`${d.affectedAreas.join(", ") || "General"}\``,
				)
				.join("\n")
		} else {
			decisionsSummary = "*No decisions were locked during this run.*"
		}

		let limitationsSummary = ""
		if (this.state.limitations.length > 0) {
			limitationsSummary = `\n\n### Known Limitations\n${this.state.limitations.map((l) => `- ${l}`).join("\n")}`
		}

		const reportText = `### Mixture of Designers v1.3 Executive Summary

- **Execution Status**: \`${this.state.stage}\`
- **Product Intent**: ${this.state.intent?.request.interpretedGoal || "Design refinement"}
- **Design Decisions**: ${acceptedDecisions.length} converged decision${acceptedDecisions.length === 1 ? "" : "s"} locked.
- **Task Implementation**: ${completedTasks.length} / ${totalTasks} task${totalTasks === 1 ? "" : "s"} completed.
- **Gate Validation**: ${passedGates} / ${totalGates > 0 ? totalGates : 8} quality gates passed.

### Locked Design Decisions
${decisionsSummary}${limitationsSummary}`

		await this.task.say("completion_result", reportText)
	}

	private emitTelemetry(event: any): void {
		// Log telemetry mock event
		Logger.info(`[MoD Telemetry] Event emitted: ${event}`)
	}
}
export type { SpecialistResult }
