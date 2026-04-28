import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { JoyZoningRefactorRequest, JoyZoningRefactorResponse } from "@shared/proto/dietcode/joyzoning"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

interface CachedJoyZoningViolation {
	type?: string
	message?: string
	path?: string
	remediation?: string
}

interface CachedJoyZoningReport {
	violations?: CachedJoyZoningViolation[]
}

export async function executeRefactor(
	controller: IController,
	request: JoyZoningRefactorRequest,
): Promise<JoyZoningRefactorResponse> {
	const spider = await controller.getSpiderEngine()
	const decomposer = new SovereignDecomposer()

	try {
		const absolutePath = path.resolve(spider.cwd, request.path)
		if (!fs.existsSync(absolutePath)) {
			return JoyZoningRefactorResponse.create({ success: false, message: "File not found" })
		}

		const content = fs.readFileSync(absolutePath, "utf-8")
		const node = spider.nodes.get(spider.normalizePath(request.path))
		const plan = decomposer.analyze(request.path, content, node)

		// 1. Validate the requested action exists in the decomposition plan
		const step = plan.steps.find((s) => s.action === request.action || `${s.action}: ${s.target}`.includes(request.action))

		let violationToFix: CachedJoyZoningViolation | undefined
		if (request.action === "FIX_STRUCTURAL_VIOLATION") {
			const report = controller.stateManager.getGlobalStateKey("lastJoyZoningReport") as CachedJoyZoningReport | undefined
			if (report?.violations) {
				violationToFix = report.violations.find((v) => v.path === request.path && v.type === "STRUCTURAL")
			}
			if (!violationToFix) {
				return JoyZoningRefactorResponse.create({
					success: false,
					message: `No structural violation found for ${request.path} to fix.`,
				})
			}
		} else if (!step && request.action !== "ALIGN_TAGS" && request.action !== "HEAL_STATELESSNESS") {
			return JoyZoningRefactorResponse.create({
				success: false,
				message: `Action ${request.action} not found in decomposition plan for this file.`,
			})
		}

		// 2. Handle Dry Run
		if (request.dryRun) {
			return JoyZoningRefactorResponse.create({
				success: true,
				message: "Dry run successful",
				planSummary: step
					? `Would perform ${step.action} on ${step.target}. Reason: ${step.reason}`
					: `Would perform ${request.action}.`,
			})
		}

		// 3. Construct a high-fidelity agentic task
		let taskPrompt = ""
		if (violationToFix) {
			taskPrompt = `JOY_ZONING FIX: Correct the following structural violation in ${request.path} to maintain substrate integrity:\n\n`
			taskPrompt += `- VIOLATION: ${violationToFix.message}\n`
			taskPrompt += `- REMEDIATION: ${violationToFix.remediation}\n\n`
			taskPrompt += `Instructions:\n1. Apply the remediation listed above.\n2. Verify structural integrity after fixes.\n3. Do not modify business logic unless necessary for the structural fix.`
		} else {
			taskPrompt = `Refactor task: ${request.action} on ${request.path}\n\n`
			taskPrompt += `[SYSTEM_SIGNAL] Component Coupling: ${node?.afferentCoupling || 0}\n`
			taskPrompt += `[SYSTEM_SIGNAL] Code Complexity: ${node?.cognitiveComplexity?.toFixed(2) ?? "0"}\n`
			taskPrompt += `[SYSTEM_SIGNAL] Organization Score: ${(1 - spider.computeEntropy().score).toFixed(2)}\n\n`

			taskPrompt += `Context from Health Analyzer:\n`
			if (step) {
				taskPrompt += `- Reason: ${step.reason}\n`
				taskPrompt += `- Destination: ${step.destination}\n`
				if (step.boilerplate) {
					taskPrompt += `\nRecommended Pattern for new module:\n\`\`\`typescript\n${step.boilerplate}\n\`\`\`\n`
				}
			}

			taskPrompt += `\nInstructions:\n`
			taskPrompt += `1. Analyze the file and its impact on the system.\n`
			taskPrompt += `2. Perform the optimization as suggested.\n`
			taskPrompt += `3. Update all imports project-wide.\n`
			taskPrompt += `4. Ensure the system remains stable after changes.\n`
		}

		const taskId = await controller.createTask(taskPrompt)

		return JoyZoningRefactorResponse.create({
			success: true,
			message: "Refactor task launched successfully",
			taskId: taskId,
		})
	} catch (error) {
		Logger.error("[Refactor] Critical failure during JoyZoning refactor:", error)
		return JoyZoningRefactorResponse.create({
			success: false,
			message: `Internal Error: ${(error as Error).message}`,
		})
	}
}
