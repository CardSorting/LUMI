import { IController } from "@core/controller/types"
import { JoyZoningRefactorRequest, JoyZoningRefactorResponse } from "@shared/proto/dietcode/joyzoning"
import { Logger } from "@/shared/services/Logger"

/**
 * V400: Standard Single-File Refactor.
 * Executes a specific refactor action on a single file.
 */
export async function executeRefactor(
	controller: IController,
	request: JoyZoningRefactorRequest,
): Promise<JoyZoningRefactorResponse> {
	try {
		const manifest = `JOY_ZONING REFACTOR ACTION: ${request.action} on ${request.path}\n`

		if (request.dryRun) {
			return JoyZoningRefactorResponse.create({
				success: true,
				message: "Dry run successful",
				planSummary: manifest + "\n[DRY RUN] Plan would be executed by the agent.",
			})
		}

		Logger.info(`[JoyZoning] Launching single-file refactor: ${request.action} on ${request.path}`)

		const taskId = await controller.createTask(manifest)

		return JoyZoningRefactorResponse.create({
			success: true,
			message: `Refactor launched successfully with Task ID: ${taskId}`,
			planSummary: manifest,
		})
	} catch (error) {
		Logger.error("[JoyZoning] Refactor failure:", error)
		return JoyZoningRefactorResponse.create({
			success: false,
			message: `Internal Error: ${(error as Error).message}`,
		})
	}
}
