import { ToolUse } from "../assistant-message"
import { StateManager } from "../storage/StateManager"
import { FluidPolicyEngine, PolicyResult } from "./FluidPolicyEngine"

/**
 * UniversalGuard: A unified, singleton authority for all architectural,
 * concurrency, and stability enforcement. Use this instead of direct
 * FluidPolicyEngine calls.
 */
export class UniversalGuard {
	private readonly engine: FluidPolicyEngine
	private currentMode: "plan" | "act" = "act"

	constructor(cwd: string, taskId: string, stateManager: StateManager) {
		this.engine = new FluidPolicyEngine(cwd, taskId, stateManager)
	}

	/**
	 * Sets the current agent mode. This affects enforcement behavior:
	 * - PLAN mode: enforcement is relaxed (guidance only, no blocking)
	 * - ACT mode: full enforcement with progressive strike tracking
	 */
	public setMode(mode: "plan" | "act") {
		this.currentMode = mode
		this.engine.setMode(mode)
	}

	public getMode(): "plan" | "act" {
		return this.currentMode
	}

	/**
	 * Single "Execute" call that performs all pre-flight audits.
	 */
	public async guardPreExecution(block: ToolUse): Promise<PolicyResult> {
		return this.engine.validatePreExecution(block)
	}

	/**
	 * Performs all post-execution audits including AST-audit, health-check, and entropy.
	 */
	public async guardPostExecution(block: ToolUse, toolOutput: unknown, prevHash?: string): Promise<PolicyResult> {
		return this.engine.validatePostExecution(block, toolOutput, prevHash)
	}

	/**
	 * Returns the localized layer context for the AI prompt.
	 */
	public getLayerContext(filePath: string): string {
		return this.engine.getFileLayerContext(filePath)
	}

	/**
	 * Performs read-time AST auditing.
	 */
	public async onRead(
		filePath: string,
		content: string,
		totalReadCount = 0,
		perFileReadCount = 0,
		globalFileReadCount = 0,
	): Promise<string> {
		return this.engine.onRead(filePath, content, totalReadCount, perFileReadCount, globalFileReadCount)
	}

	/**
	 * Performs the final architectural audit before a database commit.
	 */
	public async validateCommit(
		files: Set<string>,
		ops: import("../../infrastructure/db/BufferedDbPool").WriteOp[],
	): Promise<{ success: boolean; errors: string[] }> {
		return this.engine.validateCommit(files, ops)
	}

	/**
	 * Returns the layer classification for a given file path.
	 * Useful for injecting layer confirmations into tool results.
	 */
	public getLayerForPath(filePath: string): string {
		const { getLayer } = require("@/utils/joy-zoning")
		return getLayer(filePath)
	}
}
