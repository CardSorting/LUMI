import { DietCodeDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import {
	createGovernedLockAuthority,
	lookupMemClaim,
	releaseGovernedClaim,
	unregisterMemClaim,
} from "../../../governance/governLock"
import { TaskConfig } from "../types/TaskConfig"
import { declareInternalStateIntent, IToolHandler } from "../types/ToolContracts"

export class CognitiveMemoryReleaseHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_RELEASE
	private readonly lockAuthority = createGovernedLockAuthority({
		inMemory: process.env.TS_NODE_PROJECT?.includes("unit-test") ?? false,
	})

	getApprovalIntent(block: ToolUse) {
		const resource = (block.params as unknown as { resource?: string }).resource
		return declareInternalStateIntent(block, `Release the durable claim for ${resource ?? "a resource"}`)
	}

	getDescription(_block: ToolUse): string {
		return "Release a previously claimed resource."
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { resource } = block.params as { resource: string }
		if (!resource) {
			return `Resource name is required for release.`
		}

		const claim = lookupMemClaim(resource, config.taskId)
		if (!claim) {
			return `No active claim found for resource '${resource}'.`
		}

		const result = await releaseGovernedClaim(this.lockAuthority, claim)
		if (!result.ok) {
			return `Failed to release resource '${resource}': ${result.error}`
		}

		unregisterMemClaim(resource, config.taskId)
		return `Resource '${resource}' has been released (claim ${claim.claimId}).`
	}
}
