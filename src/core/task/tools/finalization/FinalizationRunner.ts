import { isTaskHarnessTerminal } from "../completion/CompletionFunnel"
import type { TaskConfig } from "../types/TaskConfig"
import { AutonomousDocumentationFinalizer } from "./AutonomousDocumentationFinalizer"

export interface FinalizationRunnerResult {
	success: boolean
	message: string
	evidenceJson?: string
	receiptJson?: string
	accessDenied?: boolean
}

/**
 * Post-completion documentation maintenance.
 *
 * This class deliberately has no completion-gate, lifecycle, publication, or
 * terminalization authority. The central CompletionFunnel has already decided
 * and committed the outcome before this optional maintenance can run.
 */
export class FinalizationRunner {
	constructor(private readonly config: TaskConfig) {}

	async run(): Promise<FinalizationRunnerResult> {
		if (!isTaskHarnessTerminal(this.config.taskState)) {
			return {
				success: false,
				message: "Documentation maintenance is available only after the central completion funnel commits.",
			}
		}

		const existing = await AutonomousDocumentationFinalizer.readExistingEvidence(this.config)
		if (existing?.status === "passed") {
			const checksum = AutonomousDocumentationFinalizer.evidenceChecksum(existing)
			if (this.config.taskState.finalizationRunId === checksum) {
				return {
					success: true,
					message: "Post-completion documentation is already current (idempotent replay).",
					evidenceJson: this.config.taskState.finalizationEvidenceJson,
				}
			}
		}

		this.config.finalizationMode = true
		this.config.taskState.finalizationPhase = "running"
		try {
			const finalizer = new AutonomousDocumentationFinalizer(this.config)
			const result = await finalizer.run(this.config.taskState.finalizationRunId)
			if (result.accessDenied) {
				this.config.taskState.finalizationPhase = "failed"
				return {
					success: false,
					message: `Documentation maintenance access denied: ${result.accessDeniedReason ?? "permission denied"}`,
					accessDenied: true,
					evidenceJson: JSON.stringify(result.evidence),
				}
			}

			const validation = await finalizer.validate(result.evidence)
			if (!validation.valid) {
				this.config.taskState.finalizationPhase = "failed"
				return {
					success: false,
					message: `Documentation maintenance validation failed: ${validation.reason}`,
					evidenceJson: JSON.stringify(result.evidence),
				}
			}

			this.config.taskState.finalizationPhase = "completed"
			this.config.taskState.finalizationRunId = AutonomousDocumentationFinalizer.evidenceChecksum(result.evidence)
			this.config.taskState.finalizationEvidenceJson = JSON.stringify(result.evidence)
			return {
				success: true,
				message: "Post-completion documentation maintenance completed.",
				evidenceJson: JSON.stringify(result.evidence),
			}
		} finally {
			this.config.finalizationMode = false
		}
	}

	async sealSession(): Promise<FinalizationRunnerResult> {
		if (!isTaskHarnessTerminal(this.config.taskState)) {
			return { success: false, message: "The central completion funnel has not committed this task." }
		}
		return {
			success: true,
			message: "Completion is already sealed by the central completion funnel.",
			receiptJson: this.config.taskState.completionFunnelEventJson,
			evidenceJson: this.config.taskState.finalizationEvidenceJson,
		}
	}
}
