import { DietCodeDefaultTool } from "../../../../shared/tools"
import { ToolUse } from "../../../assistant-message"
import { createGovernedLockAuthority, registerMemClaim } from "../../../governance/governLock"
import { TaskConfig } from "../types/TaskConfig"
import { IToolHandler } from "../types/ToolContracts"

export class CognitiveMemoryClaimHandler implements IToolHandler {
	readonly name = DietCodeDefaultTool.MEM_CLAIM
	private readonly lockAuthority = createGovernedLockAuthority({
		inMemory: process.env.TS_NODE_PROJECT?.includes("unit-test") ?? false,
	})

	getDescription(_block: ToolUse): string {
		return "Claim exclusive access to a resource (file or concept) to prevent swarm conflicts."
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<any> {
		const { resource, timeoutMs } = block.params as { resource: string; timeoutMs?: number }
		if (!resource) {
			return `Resource name is required for claim.`
		}

		const result = await this.lockAuthority.acquire(resource, config.taskId, {
			workspace: config.cwd,
			roadmapLeaseTaskId: `mem-claim-${resource}`,
			timeoutMs: timeoutMs ?? 300_000,
			roadmapEnabled: false,
			crossProcess: false,
		})

		if (!result.ok) {
			return `Failed to claim resource '${resource}': ${result.error}`
		}

		registerMemClaim(result.claim)
		return `Resource '${resource}' successfully claimed (claim ${result.claim.claimId}, fencing token ${result.claim.fencingToken}).`
	}
}
