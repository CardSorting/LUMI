import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { SovereignDoctor } from "@core/policy/SovereignDoctor"
import { SpiderNode } from "@core/policy/spider/SpiderEngine"
import {
	JoyZoningAuditRequest,
	JoyZoningAuditResponse,
	JoyZoningOptimization,
	JoyZoningViolation,
} from "@shared/proto/dietcode/joyzoning"
import * as fs from "fs"
import * as path from "path"
import { StreamingResponseHandler } from "@/core/controller/grpc-handler"
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
): Promise<void> {
	const spider = controller.getSpiderEngine()
	const doctor = new SovereignDoctor(spider.cwd)
	const decomposer = new SovereignDecomposer()

	const { useCache } = request

	try {
		// V200: Intent Persistence / Rapid Recovery
		if (useCache) {
			const cached = controller.stateManager.getGlobalStateKey("lastJoyZoningReport")
			if (cached) {
				Logger.info("[JoyZoning] Restoring audit from persistent cache.")
				await responseStream(
					JoyZoningAuditResponse.create({
						violations: cached.violations,
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
				progress: { processedFiles: 0, totalFiles: 100, currentFile: "Initializing Forensic Scan...", percentage: 0 },
			}),
		)

		// 2. Perform Physical Integrity Verification (Hardening: Detect Drift)
		const { synchronized, drift } = await spider.verifySubstrateIntegrity()
		if (!synchronized) {
			Logger.warn(`[Audit] Substrate drift detected (${drift} files). Re-indexing required.`)
		}

		// 3. Rebuild Registry with Streaming Progress
		let lastSentPercentage = 0
		await spider.rebuildRegistry((processed: number, total: number, currentFile: string) => {
			const percentage = (processed / total) * 100
			if (percentage - lastSentPercentage >= 5 || processed === total) {
				lastSentPercentage = percentage
				responseStream(
					JoyZoningAuditResponse.create({
						progress: { processedFiles: processed, totalFiles: total, currentFile, percentage },
					}),
				)
			}
		})

		// 4. Generate Doctor Report (Architectural Violations)
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
			})
		}

		// Map Decomposer Optimizations for Hotspots/God Modules
		const nodes = Array.from(spider.nodes.values())
		const hotspots = nodes.filter((n: SpiderNode) => (n.astComplexity || 0) > 1000 || n.afferentCoupling > 10)

		for (const node of hotspots) {
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
							})
						}
					}
				}
			} catch (e) {
				Logger.warn(`[Audit] Failed to analyze hotspot ${node.path}:`, e)
			}
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
			progress: { processedFiles: nodes.length, totalFiles: nodes.length, currentFile: "Complete", percentage: 100 },
		})

		// 6. Send Final Report
		await responseStream(finalResponse, true)

		// V200: Persistence for rapid UI recovery
		controller.stateManager.setGlobalState("lastJoyZoningReport", {
			violations: finalResponse.violations,
			integrityScore: finalResponse.integrityScore,
			driftCount: drift,
			metabolicPressure: finalResponse.metabolicPressure,
			metabolicSinks: finalResponse.metabolicSinks,
			buildHealth: finalResponse.buildHealth,
			totalFiles: finalResponse.totalFiles,
			timestamp: finalResponse.timestamp,
		})

		Logger.info("[JoyZoning] Audit Complete. Report persisted.")
	} catch (error) {
		Logger.error("[Audit] Critical failure during JoyZoning audit:", error)
		throw error
	}
}
