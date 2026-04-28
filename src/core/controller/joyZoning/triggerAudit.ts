import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { SovereignDoctor } from "@core/policy/SovereignDoctor"
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
	const isCancelled = () => requestId && !registry.hasRequest(requestId)
	const spider = await controller.getSpiderEngine()
	const doctor = new SovereignDoctor(spider.cwd)
	const decomposer = new SovereignDecomposer()

	const { useCache } = request

	// V205: Hardening - 10-minute industrial timeout to prevent zombie audits
	const timeout = setTimeout(() => {
		Logger.error(`[Audit] Audit TIMEOUT after 10 minutes. Forcefully terminating requestId: ${requestId}`)
		if (requestId) registry.unregisterRequest(requestId)
	}, 600000)

	try {
		// V200: Intent Persistence / Rapid Recovery
		if (useCache) {
			const cached = controller.stateManager.getGlobalStateKey("lastJoyZoningReport")
			if (cached) {
				Logger.info("[JoyZoning] Restoring audit from persistent cache.")
				clearTimeout(timeout)
				await responseStream(
					JoyZoningAuditResponse.create({
						violations: cached.violations,
						optimizations: cached.optimizations, // V206: Restore optimizations from cache
						integrityScore: cached.integrityScore,
						driftCount: cached.driftCount,
						metabolicPressure: cached.metabolicPressure,
						metabolicSinks: cached.metabolicSinks,
						buildHealth: cached.buildHealth || 100,
						totalFiles: cached.totalFiles || spider.nodes.size,
						timestamp: cached.timestamp,
						progress: { processedFiles: 100, totalFiles: 100, currentFile: "Restored from Cache", percentage: 100 },
					}),
					true,
				)
				return
			}
		}

		// 1. Start Audit - Send initial progress
		await responseStream(
			JoyZoningAuditResponse.create({
				progress: { processedFiles: 0, totalFiles: 100, currentFile: "Preparing Health Scan...", percentage: 0 },
			}),
		)

		// 2. Perform Physical Integrity Verification (Hardening: Detect Drift)
		if (isCancelled()) return
		const { synchronized, drift } = await spider.verifySubstrateIntegrity()
		if (!synchronized) {
			Logger.warn(`[Audit] Substrate drift detected (${drift} files). Re-indexing required.`)
		}

		// 3. Rebuild Registry with Streaming Progress
		if (isCancelled()) return
		let lastSentPercentage = 0
		await spider.rebuildRegistry(async (processed: number, total: number, currentFile: string) => {
			if (isCancelled()) return

			const percentage = (processed / total) * 100
			if (percentage - lastSentPercentage >= 5 || processed === total) {
				lastSentPercentage = percentage
				await responseStream(
					JoyZoningAuditResponse.create({
						progress: { processedFiles: processed, totalFiles: total, currentFile, percentage },
					}),
				)
			}
		})

		// 4. Generate Doctor Report (Architectural Violations)
		if (isCancelled()) return
		const doctorReport = await doctor.diagnose(spider)

		// 5. Generate Decomposition Plan (Optimizations)
		const optimizations: JoyZoningOptimization[] = []
		const violations: JoyZoningViolation[] = []

		// Map doctor violations
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
			const gravityCenter = nodes.sort((a, b) => b.blastRadius - a.blastRadius)[0]
			if (gravityCenter && gravityCenter.blastRadius > 5) {
				violations.push({
					type: "STRUCTURAL",
					severity: "WARN",
					path: gravityCenter.path,
					message: `CRITICAL COMPONENT IDENTIFIED: This file has a high impact risk (${gravityCenter.blastRadius.toFixed(1)}). Changes here affect many other parts of the project.`,
					remediation: "Consider decoupling or extracting stable interfaces to reduce ripple effects.",
					riskLevel: "HIGH",
					impactArea: "STABILITY",
				})
			}
		}

		// V206: Automatic Structural Fixes - REMOVED to prevent cascading agent spirals.
		// User now manually triggers fixes from the JoyZoning view.

		// Map Decomposer Optimizations for Hotspots/God Modules
		const hotspots = nodes.filter((n: SpiderNode) => (n.astComplexity || 0) > 1000 || n.afferentCoupling > 10)

		for (const node of hotspots) {
			if (isCancelled()) return
			try {
				const absPath = path.resolve(spider.cwd, node.path)
				if (fs.existsSync(absPath)) {
					const content = fs.readFileSync(absPath, "utf-8")
					const plan = decomposer.analyze(node.path, content, node)

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

		const stabilityScore = Math.round(doctorReport.integrityScore * (synchronized ? 1 : 0.8))
		const maintainabilityScore = Math.round((1 - spider.computeEntropy().score) * 100)

		// Enrich Optimizations with Impact/Effort/Category
		for (const opt of optimizations) {
			opt.impact = opt.projectedHealthGain > 10 ? "HIGH" : opt.projectedHealthGain > 5 ? "MEDIUM" : "LOW"
			const node = spider.nodes.get(spider.normalizePath(opt.path))
			const complexity = node?.astComplexity || 0
			opt.effort = complexity > 1000 ? "HIGH" : complexity > 500 ? "MEDIUM" : "LOW"

			if (opt.action === "EXTRACT" || opt.action === "DECOMPOSE") {
				opt.category = "MAINTAINABILITY"
			} else if (opt.action === "MOVE" || opt.action === "ALIGN_TAGS") {
				opt.category = "STABILITY"
			} else {
				opt.category = "PERFORMANCE"
			}
		}

		// V206: Evolution Tracking - Appending to historical substrate timeline
		const history = (controller.stateManager.getGlobalStateKey("joyZoningHistory") || []) as Array<{
			timestamp: string
			health: number
			stability: number
			maintainability: number
		}>

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
		const qualityGateStatus = doctorReport.buildHealth >= (policyConfig.integrityAlertThreshold || 70) ? "PASSED" : "FAILED"
		const complianceScore = Math.max(0, 100 - (violations.length / (nodes.length || 1)) * 100)

		// Find Toxic Module
		const dirViolationCounts: Record<string, number> = {}
		for (const v of violations) {
			const parts = v.path.split("/")
			const module = parts.length > 1 ? parts.slice(0, 2).join("/") : "root"
			dirViolationCounts[module] = (dirViolationCounts[module] || 0) + 1
		}
		const toxicModule = Object.entries(dirViolationCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "None detected"

		// V220: Executive Strategy - Layer Scores and Quick Wins
		const layerHealthMap: Record<string, { total: number; count: number }> = {}
		for (const node of nodes) {
			const layer = node.layer || "unassigned"
			if (!layerHealthMap[layer]) layerHealthMap[layer] = { total: 0, count: 0 }
			// Heuristic: start with 100 and subtract violations related to this node
			const nodeViolations = violations.filter((v) => v.path === node.path).length
			const nodeHealth = Math.max(0, 100 - nodeViolations * 20)
			layerHealthMap[layer].total += nodeHealth
			layerHealthMap[layer].count++
		}
		const layerScores: Record<string, number> = {}
		for (const [layer, data] of Object.entries(layerHealthMap)) {
			layerScores[layer] = Math.round(data.total / (data.count || 1))
		}

		const topRecommendations = [...optimizations].sort((a, b) => b.projectedHealthGain - a.projectedHealthGain).slice(0, 3)

		// V230: Forensic Evolution - Delta Analysis and Risk Profiling
		const lastPoint = history[history.length - 1]
		const healthDelta = lastPoint ? doctorReport.buildHealth - lastPoint.health : 0
		const lastViolationCount =
			(controller.stateManager.getGlobalStateKey("lastViolationCount") as number) || violations.length
		const violationDelta = violations.length - lastViolationCount
		controller.stateManager.setGlobalState("lastViolationCount", violations.length)

		const riskProfile: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 }
		for (const node of nodes) {
			if (node.blastRadius > 10) riskProfile.HIGH++
			else if (node.blastRadius > 5) riskProfile.MEDIUM++
			else riskProfile.LOW++
		}

		const finalResponse = JoyZoningAuditResponse.create({
			buildHealth: doctorReport.buildHealth,
			totalFiles: nodes.length,
			structuralEntropy: spider.computeEntropy().score,
			violations,
			optimizations,
			timestamp: new Date().toISOString(),
			projectedHealth: doctorReport.buildHealth,
			integrityScore: doctorReport.integrityScore,
			driftDetected: !synchronized,
			driftCount: drift,
			metabolicPressure: spider.computeMetabolicPressure(),
			metabolicSinks: doctorReport.environmentContext.metabolicSinks,
			grade: computeGrade(doctorReport.buildHealth),
			totalTechnicalDebt: techDebtStr,
			stabilityScore,
			maintainabilityScore,
			history: updatedHistory, // V206: Return evolution data
			qualityGateStatus,
			complianceScore: Math.round(complianceScore),
			toxicModule,
			layerScores,
			topRecommendations,
			healthDelta,
			violationDelta,
			riskProfile,
			progress: { processedFiles: nodes.length, totalFiles: nodes.length, currentFile: "Complete", percentage: 100 },
		})

		// 6. Send Final Report
		if (isCancelled()) return
		await responseStream(finalResponse, true)

		// V200: Persistence for rapid UI recovery
		controller.stateManager.setGlobalState("lastJoyZoningReport", {
			violations: finalResponse.violations,
			optimizations: finalResponse.optimizations, // V206: Cache optimizations
			integrityScore: finalResponse.integrityScore,
			driftCount: drift,
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
	} catch (error) {
		Logger.error("[Audit] Critical failure during JoyZoning audit:", error)
		throw error
	} finally {
		clearTimeout(timeout)
	}
}
