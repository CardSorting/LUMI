import type { IController as Controller } from "@core/controller/types"
import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.dietcode"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"

export async function explainWithDietCode(
	controller: Controller,
	request: CommandContext,
	notebookContext?: string,
): Promise<Empty> {
	if (!request.selectedText?.trim() && !notebookContext) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to explain.",
		})
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	let prompt = `Explain the following code from ${fileMention}:
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

	// Add notebook context if provided (includes cell JSON)
	if (notebookContext) {
		Logger.log("Adding notebook context to explainWithDietCode task")
		prompt += notebookContext
	}

	await controller.initTask(prompt)
	telemetryService.captureButtonClick("codeAction_explainCode", controller.task?.ulid)

	return {}
}
