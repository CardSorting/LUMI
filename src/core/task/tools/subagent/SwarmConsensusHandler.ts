import { Logger } from "@/shared/services/Logger"
import { TaskConfig } from "../types/TaskConfig"

/**
 * Handles Swarm Consensus signaling and verification loops.
 * Phase 3 addition to the Swarm Hardening strategy.
 */
export class SwarmConsensusHandler {
	private static signaledConsensus = new Set<string>()

	/**
	 * Processes a result string for consensus markers and critical findings.
	 * Phase 4: Cross-Agent Intelligence (Blackboard)
	 */
	static async handleSignal(config: TaskConfig, result: string): Promise<void> {
		const upperResult = result.toUpperCase()

		// Consensus Logic
		if (upperResult.includes("SIGNAL: CONSENSUS_REACHED")) {
			Logger.info("[SwarmConsensus] Peer consensus reached for task.")
		}

		if (upperResult.includes("SIGNAL: CONFLICT_DETECTED")) {
			Logger.warn("[SwarmConsensus] Conflict detected in swarm output!")
		}

		// Blackboard Logic: Extract findings between [SIGNAL: ...] markers or CRITICAL keywords
		const findings: string[] = []

		// Regex for [SIGNAL: KEYWORD] message
		const signalRegex = /\[SIGNAL:\s*(.*?)\]/g
		let match: RegExpExecArray | null
		while (true) {
			match = signalRegex.exec(result)
			if (match === null) break
			findings.push(match[0])
		}

		// Detect standard keywords
		const keywords = ["CRITICAL:", "SECURITY RISK:", "ARCHITECTURE VIOLATION:", "JOY-ZONING VIOLATION:"]
		for (const keyword of keywords) {
			if (upperResult.includes(keyword)) {
				// Extract the line containing the keyword
				const lines = result.split("\n")
				const matchingLine = lines.find((l) => l.toUpperCase().includes(keyword))
				if (matchingLine) findings.push(matchingLine.trim())
			}
		}

		if (findings.length > 0) {
			const blackboard = config.taskState.swarmBlackboard
			for (const finding of findings) {
				if (!blackboard.includes(finding)) {
					blackboard.push(finding)
					Logger.info(`[SwarmBlackboard] New finding registered: ${finding}`)
				}
			}

			// Keep blackboard lean (max 20 entries)
			if (blackboard.length > 20) {
				blackboard.splice(0, blackboard.length - 20)
			}
		}
	}

	/**
	 * Clears the consensus state for a new session.
	 */
	static clearState(): void {
		SwarmConsensusHandler.signaledConsensus.clear()
	}
}
