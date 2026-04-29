import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { SovereignDoctor } from "@core/policy/SovereignDoctor"
import { SovereignOptimizer } from "@core/policy/SovereignOptimizer"
import { SovereignPolicy } from "@core/policy/SovereignPolicy"
import { SpiderNode } from "@core/policy/spider/SpiderEngine"
import {
	JoyZoningAuditRequest,
	JoyZoningAuditResponse,
	JoyZoningOptimization,
	JoyZoningViolation,
} from "@shared/proto/dietcode/joyzoning"
import * as fs from "fs"
import * as path from "path"
import { getRequestRegistry, StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { Logger } from "@/shared/services/Logger"
import { SafeNumber } from "@/shared/utils/SafeNumber"

const finiteNumber = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback

const finitePercent = (value: unknown, fallback = 0): number => Math.max(0, Math.min(100, finiteNumber(value, fallback)))

const safeString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)

const safeTrimmedString = (value: unknown, fallback = ""): string => {
	const text = safeString(value, fallback).trim()
	return text.length > 0 ? text : fallback
}

const safeArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

const boundedArray = <T>(value: unknown, maxItems: number): T[] => safeArray<T>(value).slice(0, maxItems)

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value)

const isAuditCancelledError = (error: unknown): boolean =>
	error instanceof Error && error.message.toLowerCase().includes("joyzoning audit cancelled")

const MAX_HOTSPOT_BYTES = 750_000

const safeRecord = (value: unknown): Record<string, number> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {}
	const out: Record<string, number> = {}
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		out[key] = finiteNumber(raw, 0)
	}
	return out
}

const normalizeProgress = (value: unknown): JoyZoningAuditResponse["progress"] => {
	if (!isObjectRecord(value)) return undefined
	return {
		processedFiles: finiteNumber(value.processedFiles, 0),
		totalFiles: finiteNumber(value.totalFiles, 0),
		currentFile: safeString(value.currentFile, ""),
		percentage: finitePercent(value.percentage, 0),
	}
}

const normalizeHistory = (value: unknown): { timestamp: string; health: number; stability: number; maintainability: number }[] =>
	boundedArray<Record<string, unknown>>(value, 20).map((point) => ({
		timestamp: safeString(point.timestamp, new Date().toISOString()),
		health: finitePercent(point.health, 0),
		stability: finitePercent(point.stability, 0),
		maintainability: finitePercent(point.maintainability, 0),
	}))

const normalizeViolation = (value: unknown): JoyZoningViolation => {
	const item = isObjectRecord(value) ? value : {}
	return JoyZoningViolation.create({
		type: safeTrimmedString(item.type, "STRUCTURAL"),
		message: safeTrimmedString(item.message, "Structural issue detected."),
		path: safeTrimmedString(item.path, ""),
		remediation: safeTrimmedString(item.remediation, "Review this file and apply the smallest safe structural fix."),
		severity: safeTrimmedString(item.severity, "WARN"),
		riskLevel: safeTrimmedString(item.riskLevel, "MEDIUM"),
		impactArea: safeTrimmedString(item.impactArea, "STABILITY"),
	})
}

const normalizeOptimization = (value: unknown): JoyZoningOptimization => {
	const item = isObjectRecord(value) ? value : {}
	const action = safeTrimmedString(item.action, "")
	const pathValue = safeTrimmedString(item.path, "")
	const title = safeTrimmedString(
		item.title,
		action && pathValue ? `${action}: ${path.basename(pathValue)}` : "Optimization opportunity",
	)

	return JoyZoningOptimization.create({
		title,
		description: safeTrimmedString(item.description, "Review this opportunity before queuing a refactor."),
		path: pathValue,
		action,
		projectedHealthGain: finiteNumber(item.projectedHealthGain, 0),
		boilerplate: safeString(item.boilerplate, ""),
		impact: safeTrimmedString(item.impact, "LOW"),
		effort: safeTrimmedString(item.effort, "MEDIUM"),
		category: safeTrimmedString(item.category, "STABILITY"),
	})
}

const normalizeViolations = (value: unknown): JoyZoningViolation[] => boundedArray<unknown>(value, 500).map(normalizeViolation)

const normalizeOptimizations = (value: unknown, maxItems = 250): JoyZoningOptimization[] =>
	boundedArray<unknown>(value, maxItems).map(normalizeOptimization)

function normalizeAuditResponse(input: Partial<JoyZoningAuditResponse> | Record<string, unknown>): JoyZoningAuditResponse {
	return JoyZoningAuditResponse.create({
		buildHealth: finitePercent(input.buildHealth, 0),
		totalFiles: finiteNumber(input.totalFiles, 0),
		structuralEntropy: finiteNumber(input.structuralEntropy, 0),
		violations: normalizeViolations(input.violations),
		optimizations: normalizeOptimizations(input.optimizations, 250),
		timestamp: safeString(input.timestamp, new Date().toISOString()),
		projectedHealth: finitePercent(input.projectedHealth, finiteNumber(input.buildHealth, 0)),
		integrityScore: finitePercent(input.integrityScore, 0),
		progress: normalizeProgress(input.progress),
		metabolicPressure: finiteNumber(input.metabolicPressure, 0),
		driftDetected: Boolean(input.driftDetected),
		driftCount: finiteNumber(input.driftCount, 0),
		metabolicSinks: safeArray<string>(input.metabolicSinks),
		grade: safeString(input.grade, "C"),
		totalTechnicalDebt: safeString(input.totalTechnicalDebt, "0m"),
		stabilityScore: finitePercent(input.stabilityScore, 0),
		maintainabilityScore: finitePercent(input.maintainabilityScore, 0),
		history: normalizeHistory(input.history),
		qualityGateStatus: safeString(input.qualityGateStatus, "UNKNOWN"),
		complianceScore: finitePercent(input.complianceScore, 0),
		toxicModule: safeString(input.toxicModule, "None detected"),
		layerScores: safeRecord(input.layerScores),
		topRecommendations: normalizeOptimizations(input.topRecommendations, 3),
		healthDelta: finiteNumber(input.healthDelta, 0),
		violationDelta: finiteNumber(input.violationDelta, 0),
		riskProfile: { LOW: 0, MEDIUM: 0, HIGH: 0, ...safeRecord(input.riskProfile) },
	})
}

/**
 * [HANDLING: JoyZoning Audit]
 * Triggers a deep forensic scan of the codebase to identify metabolic pressure,
 * substrate drift, and decomposition opportunities.
 */
export async function triggerAudit(
	controller: IController,
	request: JoyZoningAuditRequest,
	responseStream: StreamingResponseHandler<JoyZoningAuditResponse>,
	requestId?: string,
): Promise<void> {
	const registry = getRequestRegistry()
	let timedOut = false
	let terminal = false
	const unregister = () => {
		if (requestId && registry.hasRequest(requestId)) registry.unregisterRequest(requestId)
	}
	const isCancelled = () => timedOut || (!!requestId && !registry.hasRequest(requestId))
	const safeSend = async (response: JoyZoningAuditResponse, isLast = false): Promise<boolean> => {
		if (terminal || isCancelled()) return false
		try {
			await responseStream(response, isLast)
			if (isLast) terminal = true
			return true
		} catch (error) {
			terminal = true
			Logger.warn("[Audit] Failed to stream JoyZoning audit response:", error)
			return false
		}
	}

	// V205: Hardening - 10-minute industrial timeout to prevent zombie audits
	const timeout = setTimeout(() => {
		timedOut = true
		Logger.error(`[Audit] Audit TIMEOUT after 10 minutes. Forcefully terminating requestId: ${requestId}`)
		if (requestId) registry.unregisterRequest(requestId)
	}, 600000)
	timeout.unref?.()

	let doctor: SovereignDoctor | null = null
	let decomposer: SovereignDecomposer | null = null
	let optimizer: SovereignOptimizer | null = null

	try {
		// 1. Initialize Engines (V215: Inside try block for safe cleanup)
		const spider = await controller.getSpiderEngine()
		const { MetabolicMonitor } = await import("@core/integrity/MetabolicMonitor")
		const monitor = new MetabolicMonitor(spider.cwd) // managed instance

		doctor = new SovereignDoctor(spider.cwd)
		decomposer = new SovereignDecomposer()
		optimizer = new SovereignOptimizer()

		const { useCache } = request

		// V200: Intent Persistence / Rapid Recovery
		if (useCache) {
			const cached = controller.stateManager.getGlobalStateKey("lastJoyZoningReport")
			// V200 Hardening: Forensic Validation of Cache Substrate
			if (isObjectRecord(cached) && Array.isArray(cached.violations) && typeof cached.integrityScore === "number") {
				Logger.info("[JoyZoning] Restoring audit from persistent cache.")
				clearTimeout(timeout)
				const restored = normalizeAuditResponse({
					...cached,
					progress: { processedFiles: 100, totalFiles: 100, currentFile: "Restored from Cache", percentage: 100 },
					totalFiles: finiteNumber(cached.totalFiles, spider.nodes.size),
				})
				await safeSend(restored, true)
				return
			}
			if (cached) {
				Logger.warn("[JoyZoning] Cached report substrate corrupted or partial. Triggering fresh audit.")
			}
		}

		// 2. Start Audit - Send initial progress
		await safeSend(
			JoyZoningAuditResponse.create({
				progress: { processedFiles: 0, totalFiles: 100, currentFile: "Preparing Health Scan...", percentage: 0 },
			}),
		)

		// 3. Rebuild Registry with Streaming Progress
		// PRODUCTION HARDENING: We skip verifySubstrateIntegrity here because rebuildRegistry performs
		// a fresh scan anyway. This eliminates redundant I/O and Merkle computation at startup.
		if (isCancelled()) return
		let lastSentPercentage = 0
		await spider.rebuildRegistry(
			async (processed: number, total: number, currentFile: string) => {
				if (isCancelled()) return

				const percentage = total > 0 ? (processed / total) * 100 : 100
				if (percentage - lastSentPercentage >= 5 || processed === total) {
					lastSentPercentage = percentage
					await safeSend(
						JoyZoningAuditResponse.create({
							progress: { processedFiles: processed, totalFiles: total, currentFile, percentage },
						}),
					)
				}
			},
			{ isCancelled },
		)

		// 4. Generate Doctor Report (Architectural Violations)
		if (isCancelled()) return
		const doctorReport = await doctor.diagnose(spider, {}, monitor)

		// 5. Generate Decomposition Plan (Optimizations)
		const optimizations: JoyZoningOptimization[] = []
		const violations: JoyZoningViolation[] = []

		// ... (Mapping doctor violations code)
		for (const v of doctorReport.violations) {
			violations.push({
				type: v.type,
				message: v.message,
				path: v.path,
				remediation: v.remediation,
				severity: "ERROR",
				riskLevel: v.type === "STRUCTURAL" ? "HIGH" : "MEDIUM",
				impactArea: v.type === "STRUCTURAL" ? "STABILITY" : "MAINTAINABILITY",
			})
		}

		// V205: Forensic Depth - Identifying the Gravity Center
		const nodes = Array.from(spider.nodes.values())
		if (nodes.length > 0) {
			const gravityCenter = nodes.reduce<SpiderNode | undefined>((max, node) => {
				if (!max || (node.blastRadius || 0) > (max.blastRadius || 0)) return node
				return max
			}, undefined)
			if (gravityCenter && (gravityCenter.blastRadius || 0) > 0.4) {
				violations.push({
					type: "STRUCTURAL",
					severity: "WARN",
					path: gravityCenter.path,
					message: `CRITICAL COMPONENT IDENTIFIED: This file has a high systemic impact risk (${SafeNumber.formatPercent(gravityCenter.blastRadius, 0)}%). Changes here affect many other parts of the project.`,
					remediation: "Consider decoupling or extracting stable interfaces to reduce ripple effects.",
					riskLevel: "HIGH",
					impactArea: "STABILITY",
				})
			}
		}

		// Map Decomposer Optimizations for Hotspots/God Modules
		// V215: Hardened Hotspot Selection
		// Focuses on large modules (> 1000 nodes) or high coupling (> 15 dependents).
		const hotspots = nodes
			.filter((n: SpiderNode) => (n.astComplexity || 0) > 1000 || (n.afferentCoupling || 0) > 15)
			.sort(
				(a, b) =>
					(b.astComplexity || 0) + (b.afferentCoupling || 0) - ((a.astComplexity || 0) + (a.afferentCoupling || 0)),
			)
			.slice(0, 25)
		const snapshots = spider.getSnapshotHistory()
		const projectStats = spider.metrics.getProjectStatistics(spider.nodes)

		for (const node of hotspots) {
			if (isCancelled()) return
			try {
				const absPath = path.resolve(spider.cwd, node.path)
				if (fs.existsSync(absPath)) {
					const stats = fs.statSync(absPath)
					if (stats.size > MAX_HOTSPOT_BYTES) {
						Logger.warn(`[Audit] Skipping oversized hotspot ${node.path} (${stats.size} bytes).`)
						continue
					}
					const content = fs.readFileSync(absPath, "utf-8")
					const plan = decomposer.analyze(node.path, content, node, projectStats)

					// V300: Unused Import Sensing
					const unusedImports = spider.forensic.findUnusedImports(node, content)
					for (const ui of unusedImports) {
						optimizations.push({
							title: `HARDEN: Clean up imports`,
							description: ui,
							path: node.path,
							action: "HARDEN",
							projectedHealthGain: 2,
							boilerplate: "",
							impact: "",
							effort: "",
							category: "",
						})
					}

					// V400: Security Substrate Sensing
					const securitySignals = spider.forensic.detectSecurityAntipatterns(node, content)
					for (const sig of securitySignals) {
						violations.push({
							type: "POLICY",
							message: sig,
							path: node.path,
							remediation: "Replace unsafe patterns with robust architectural primitives.",
							severity: "ERROR",
							riskLevel: "HIGH",
							impactArea: "STABILITY",
						})
					}

					// V400: Hotspot Heat Sensing
					const heat = spider.forensic.calculateHotspotHeat(node, snapshots)
					if (heat > 0.7) {
						violations.push({
							type: "STRUCTURAL",
							message: `HOTSPOT HEAT: ${path.basename(node.path)} is a toxic hotspot (Heat: ${Math.round(heat * 100)}%). Complexity is rising faster than the substrate can absorb.`,
							path: node.path,
							remediation:
								"Immediate architectural cooldown required: Decompose this module to dissipate complexity.",
							severity: "ERROR",
							riskLevel: "HIGH",
							impactArea: "STABILITY",
						})
					}

					if (plan.steps.length > 0) {
						for (const step of plan.steps) {
							optimizations.push({
								title: `${step.action}: ${step.target}`,
								description: step.reason,
								path: node.path,
								action: step.action,
								projectedHealthGain: (plan.projectedHealth || 0) - plan.buildHealth,
								boilerplate: step.boilerplate || "",
								impact: "", // Enriched below
								effort: "", // Enriched below
								category: "", // Enriched below
							})
						}
					}
				}
			} catch (e) {
				Logger.warn(`[Audit] Failed to analyze hotspot ${node.path}:`, e)
			}
		}

		// V220: Structural Optimization Integration
		const structuralOpts = optimizer ? optimizer.findOptimizations(spider) : []
		for (const o of structuralOpts) {
			let action = "MOVE"
			if (o.type === "DEADWOOD") action = "PRUNE"
			if (o.type === "COHESION") action = "DECOMPOSE"
			if (o.type === "CYCLE_BREAK") action = "EXTRACT"

			optimizations.push({
				title: `${action}: ${path.basename(o.file)}`,
				description: o.reason,
				path: o.file,
				action,
				projectedHealthGain: o.integrityGain,
				boilerplate: "",
				impact: "", // Enriched below
				effort: "", // Enriched below
				category: "", // Enriched below
			})
		}

		if (nodes.length === 0) {
			Logger.warn("[JoyZoning] Audit completed with 0 files. Check if CWD/src exists and is not excluded.")
		}

		// V206: Advanced Forensic Heuristics - Mapping technical signals to approachable industry standards
		const computeGrade = (health: number) => {
			if (health >= 90) return "A"
			if (health >= 80) return "B"
			if (health >= 70) return "C"
			if (health >= 60) return "D"
			return "F"
		}

		const totalViolations = violations.length
		const techDebtMinutes = totalViolations * 15 + optimizations.length * 10
		const techDebtStr =
			techDebtMinutes > 60 ? `${Math.floor(techDebtMinutes / 60)}h ${techDebtMinutes % 60}m` : `${techDebtMinutes}m`

		const sanitizeScore = (v: unknown) => finitePercent(typeof v === "number" && !Number.isNaN(v) ? Math.round(v) : 0)
		const entropyReport = spider.computeEntropy()
		const structuralEntropy = finiteNumber(entropyReport?.score, 0)
		const metabolicPressure = finiteNumber(spider.computeMetabolicPressure(monitor), 0)

		const stabilityScore = sanitizeScore(doctorReport.integrityScore)
		const maintainabilityScore = sanitizeScore((1 - structuralEntropy) * 100)

		// Enrich Optimizations with Impact/Effort/Category
		for (const opt of optimizations) {
			opt.impact = opt.projectedHealthGain > 12 ? "HIGH" : opt.projectedHealthGain > 6 ? "MEDIUM" : "LOW"
			const node = spider.nodes.get(spider.normalizePath(opt.path))
			const complexity = node?.astComplexity || 0

			// V300: Forensic Effort Calibration
			if (opt.action === "HARDEN" || opt.action === "PRUNE") {
				opt.effort = "LOW"
			} else if (opt.action === "EXTRACT" || opt.action === "MOVE") {
				opt.effort = complexity > 800 ? "HIGH" : "MEDIUM"
			} else {
				opt.effort = complexity > 1200 ? "HIGH" : complexity > 600 ? "MEDIUM" : "LOW"
			}

			// V300: Forensic Categorization
			if (opt.action === "EXTRACT" || opt.action === "DECOMPOSE" || opt.action === "SPLIT") {
				opt.category = "MAINTAINABILITY"
			} else if (
				opt.action === "MOVE" ||
				opt.action === "ALIGN_TAGS" ||
				opt.action === "HARDEN" ||
				opt.action === "INTERFACE"
			) {
				opt.category = "STABILITY"
			} else if (opt.action === "PRUNE") {
				opt.category = "PERFORMANCE"
			} else {
				opt.category = "STABILITY"
			}
		}

		// V206: Evolution Tracking - Appending to historical substrate timeline
		const rawHistory = controller.stateManager.getGlobalStateKey("joyZoningHistory")
		const history = normalizeHistory(rawHistory)

		const newPoint = {
			timestamp: new Date().toISOString(),
			health: doctorReport.buildHealth,
			stability: stabilityScore,
			maintainability: maintainabilityScore,
		}

		const updatedHistory = [...history, newPoint].slice(-20) // Keep last 20 points
		controller.stateManager.setGlobalState("joyZoningHistory", updatedHistory)

		// V210: Governance Metrics - Quality Gates and Compliance
		const policyConfig = SovereignPolicy.getInstance(spider.cwd).getGlobalConfig()
		const buildHealth = sanitizeScore(doctorReport.buildHealth)
		const qualityGateStatus = buildHealth >= (policyConfig.integrityAlertThreshold || 70) ? "PASSED" : "FAILED"
		const complianceScore = sanitizeScore(Math.max(0, 100 - (violations.length / (nodes.length || 1)) * 100))

		// V450: Sentient Hazard Tracking
		const hazardNodes = nodes.filter((n) => (n.hazardScore || 0) > 0.5)
		const toxicHeatmap = hazardNodes
			.sort((a, b) => (b.hazardScore || 0) - (a.hazardScore || 0))
			.slice(0, 5)
			.map((n) => `${path.basename(n.path)}: Hazard ${(n.hazardScore * 100).toFixed(1)}%`)

		const mostToxic = [...nodes].sort((a, b) => (b.hazardScore || 0) - (a.hazardScore || 0))[0]
		const toxicModuleLabel =
			mostToxic && (mostToxic.hazardScore || 0) > 0.6
				? `${path.basename(mostToxic.path)} (${mostToxic.layer.toUpperCase()})`
				: "None detected"

		// V220: Executive Strategy - Layer Scores and Quick Wins
		const layerHealthMap: Record<string, { total: number; count: number }> = {}
		const violationCountsByPath = new Map<string, number>()
		for (const violation of violations) {
			violationCountsByPath.set(violation.path, (violationCountsByPath.get(violation.path) || 0) + 1)
		}
		for (const node of nodes) {
			const layer = node.layer || "unassigned"
			if (!layerHealthMap[layer]) layerHealthMap[layer] = { total: 0, count: 0 }
			// Heuristic: start with 100 and subtract violations related to this node
			const nodeViolations = violationCountsByPath.get(node.path) || 0
			const nodeHealth = Math.max(0, 100 - nodeViolations * 20)
			layerHealthMap[layer].total += nodeHealth
			layerHealthMap[layer].count++
		}
		const layerScores: Record<string, number> = {}
		for (const [layer, data] of Object.entries(layerHealthMap)) {
			layerScores[layer] = sanitizeScore(data.total / (data.count || 1))
		}

		const topRecommendations = [...optimizations].sort((a, b) => b.projectedHealthGain - a.projectedHealthGain).slice(0, 5) // V215: Increased slightly to 5, but capped at elite recommendations.

		// V230: Forensic Evolution - Delta Analysis and Risk Profiling
		const lastPoint = history[history.length - 1]
		const healthDelta = lastPoint ? doctorReport.buildHealth - lastPoint.health : 0
		const lastViolationCount = finiteNumber(
			controller.stateManager.getGlobalStateKey("lastViolationCount"),
			violations.length,
		)
		const violationDelta = violations.length - lastViolationCount
		controller.stateManager.setGlobalState("lastViolationCount", violations.length)

		const riskProfile: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 }
		for (const node of nodes) {
			if (node.blastRadius > 0.7) riskProfile.HIGH++
			else if (node.blastRadius > 0.3) riskProfile.MEDIUM++
			else riskProfile.LOW++
		}

		const finalResponse = normalizeAuditResponse({
			buildHealth,
			totalFiles: nodes.length,
			structuralEntropy,
			violations,
			optimizations,
			timestamp: new Date().toISOString(),
			projectedHealth: buildHealth,
			integrityScore: sanitizeScore(doctorReport.integrityScore),
			driftDetected: false, // Default if not computed
			driftCount: 0,
			metabolicPressure,
			metabolicSinks: toxicHeatmap.length > 0 ? toxicHeatmap : monitor.getStabilityStats().hotspots.map((h) => h.path),
			grade: computeGrade(buildHealth),
			totalTechnicalDebt: techDebtStr,
			stabilityScore,
			maintainabilityScore,
			history: updatedHistory,
			qualityGateStatus,
			complianceScore,
			toxicModule: toxicModuleLabel,
			layerScores,
			topRecommendations,
			healthDelta,
			violationDelta,
			riskProfile,
			progress: { processedFiles: nodes.length, totalFiles: nodes.length, currentFile: "Complete", percentage: 100 },
		})

		// 6. Send Final Report
		if (isCancelled()) return
		await safeSend(finalResponse, true)

		// V200: Persistence for rapid UI recovery
		controller.stateManager.setGlobalState("lastJoyZoningReport", {
			violations: finalResponse.violations,
			optimizations: finalResponse.optimizations,
			integrityScore: finalResponse.integrityScore,
			metabolicPressure: finalResponse.metabolicPressure,
			metabolicSinks: finalResponse.metabolicSinks,
			buildHealth: finalResponse.buildHealth,
			totalFiles: finalResponse.totalFiles,
			timestamp: finalResponse.timestamp,
			grade: finalResponse.grade,
			totalTechnicalDebt: finalResponse.totalTechnicalDebt,
			stabilityScore: finalResponse.stabilityScore,
			maintainabilityScore: finalResponse.maintainabilityScore,
			history: updatedHistory,
		})

		Logger.info("[JoyZoning] Audit Complete. Report persisted.")
	} catch (error: unknown) {
		if (isAuditCancelledError(error as Error) || isCancelled()) {
			Logger.info(`[Audit] JoyZoning audit cancelled for requestId: ${requestId}`)
			terminal = true
			return
		}
		Logger.error("[Audit] Critical failure during JoyZoning audit:", error)

		// V215: Graceful UI Recovery - Stream a terminal error response
		await safeSend(
			normalizeAuditResponse({
				grade: "F",
				timestamp: new Date().toISOString(),
				progress: {
					processedFiles: 0,
					totalFiles: 100,
					currentFile: `Critical Failure: ${error instanceof Error ? error.message : String(error)}`,
					percentage: 100,
				},
			}),
			true,
		)
	} finally {
		clearTimeout(timeout)
		unregister()
		if (doctor) doctor.dispose()
		if (decomposer) decomposer.dispose()
		if (optimizer) optimizer.dispose()
	}
}
