import { IController } from "@core/controller/types"
import { SovereignDecomposer } from "@core/policy/SovereignDecomposer"
import { JoyZoningRefactorRequest, JoyZoningRefactorResponse } from "@shared/proto/dietcode/joyzoning"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

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

		if (!step && request.action !== "ALIGN_TAGS" && request.action !== "HEAL_STATELESSNESS") {
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
		let taskPrompt = `Refactor task: ${request.action} on ${request.path}\n\n`
		taskPrompt += `[FORENSIC_SIGNAL] Afferent Coupling: ${node?.afferentCoupling || 0}\n`
		taskPrompt += `[FORENSIC_SIGNAL] Cognitive Complexity: ${node?.cognitiveComplexity.toFixed(2) || 0}\n`
		taskPrompt += `[FORENSIC_SIGNAL] Structural Entropy: ${spider.computeEntropy().score.toFixed(2)}\n\n`

		taskPrompt += `Context from SovereignDecomposer:\n`
		if (step) {
			taskPrompt += `- Reason: ${step.reason}\n`
			taskPrompt += `- Destination: ${step.destination}\n`
			if (step.boilerplate) {
				taskPrompt += `\nRecommended Boilerplate for new module:\n\`\`\`typescript\n${step.boilerplate}\n\`\`\`\n`
			}
		}

		taskPrompt += `\nInstructions:\n`
		taskPrompt += `1. Analyze the file and its dependents.\n`
		taskPrompt += `2. Perform the refactoring as suggested.\n`
		taskPrompt += `3. Ensure all imports are updated project-wide.\n`
		taskPrompt += `4. Verify build health after completion.\n`

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
