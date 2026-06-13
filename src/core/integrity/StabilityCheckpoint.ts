import { SafeNumber } from "../../shared/utils/SafeNumber"
import { SpiderSnapshot } from "../policy/spider/SpiderEngine"

/**
 * StabilityCheckpoint: The architectural safety net.
 * Manages a rolling buffer of structural snapshots and proposes rollbacks
 * if the project integrity decays significantly.
 */
export class StabilityCheckpoint {
	private buffer: SpiderSnapshot[] = []
	private readonly MAX_BUFFER_SIZE = 5

	/**
	 * Adds a new snapshot to the safety buffer.
	 */
	public push(snapshot: SpiderSnapshot) {
		this.buffer.unshift(snapshot)
		if (this.buffer.length > this.MAX_BUFFER_SIZE) {
			this.buffer.pop()
		}
	}

	/**
	 * Analyzes the decay trend in the current session.
	 * Returns a rollback proposal if decay > 20 points.
	 */
	public getRollbackProposal(currentScore: number): { recommended: boolean; message?: string; targetTimestamp?: string } {
		if (this.buffer.length === 0) return { recommended: false }

		const initialSnapshot = this.buffer[this.buffer.length - 1]
		if (!initialSnapshot) return { recommended: false }

		const decay = (initialSnapshot.entropyScore - (1 - currentScore / 100)) * 100

		if (decay > 20) {
			return {
				recommended: true,
				message: `🚨 ARCHITECTURAL DECAY DETECTED: Integrity has dropped by ${SafeNumber.format(decay, 1)}% in this session.\nIt is STRONGLY RECOMMENDED to evaluate a structural rollback to the state from ${initialSnapshot.timestamp}.`,
				targetTimestamp: initialSnapshot.timestamp,
			}
		}

		return { recommended: false }
	}

	public getLatestHealthy(): SpiderSnapshot | null {
		return this.buffer.find((s) => s.entropyScore < 0.2) || null
	}
}
