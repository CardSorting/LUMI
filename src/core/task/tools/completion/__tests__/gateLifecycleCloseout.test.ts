import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, it } from "mocha"
import "should"
import { MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import type { CompletionReceipt } from "@shared/completion/finalizationEvidence"
import {
	buildContinuityMarker,
	validateCompletionReceipt,
	validateFinalizationEvidenceForReceipt,
} from "@shared/completion/receiptValidation"
import { TaskState } from "../../../TaskState"
import { buildCompletionPreflightRecoveryHint } from "../../attemptCompletionUtils"
import { FinalizationRunner } from "../../finalization/FinalizationRunner"
import { SubagentEnvelopeBuilder } from "../../subagent/SubagentEnvelopeBuilder"
import { validateSubagentCompletionGates } from "../../subagentCompletionGates"
import type { TaskConfig } from "../../types/TaskConfig"
import { shouldRejectFakeFollowupQuestion } from "../fakeFollowupGuard"
import {
	buildRetryLockedDecision,
	cacheGateLifecycleDecision,
	canRunFinalization,
	evaluateGateLifecycle,
	isTaskHarnessTerminal,
	latchEngineeringVerified,
} from "../GateLifecycleEvaluator"

const SUBSTANTIVE_RESULT =
	"Implemented the authentication module with JWT refresh rotation, updated tests, and verified login flows end-to-end."

function configWithState(taskState: TaskState, cwd = "/tmp"): TaskConfig {
	return {
		taskId: "trap-closeout-task",
		ulid: "ulid-trap",
		cwd,
		taskState,
		finalizationMode: false,
		isSubagentExecution: false,
		auditCompletionGateEnabled: false,
	} as TaskConfig
}

describe("gate lifecycle closeout — legacy trap reproduction", () => {
	let taskState: TaskState

	beforeEach(() => {
		taskState = new TaskState()
	})

	it("retry-locked verified engineering cannot trap — same-session finalization remains available", async () => {
		taskState.engineeringVerifiedAt = Date.now()
		taskState.engineeringVerifiedCheckpointHash = "chk-trap"
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT

		const config = configWithState(taskState)
		const decision = buildRetryLockedDecision(config)
		cacheGateLifecycleDecision(config, decision)

		decision.lifecycleState.should.equal("finalization_ready")
		decision.allowedActions.should.containEql("run_finalization")
		decision.forbiddenActions.should.containEql("attempt_completion")
		decision.engineering.should.equal("passed")
		decision.documentation.should.equal("pending")
		decision.ledger.should.equal("pending")

		decision.operatorMessage.should.not.match(/new task/i)
		decision.operatorMessage.should.not.match(/new session/i)
		buildCompletionPreflightRecoveryHint("circuit_breaker").should.not.match(/new task/i)

		canRunFinalization(config).should.be.true()
		isTaskHarnessTerminal(taskState).should.be.false()

		const fakeFollowup = shouldRejectFakeFollowupQuestion(config)
		fakeFollowup?.should.match(/run_finalization/i)

		const tmpDir = path.join("/tmp", `trap-closeout-${Date.now()}`)
		await mkdir(tmpDir, { recursive: true })
		const finalizeConfig = {
			...config,
			cwd: tmpDir,
			universalGuard: {
				getSessionImpactSummary: () => "- `src/auth.ts` (2 writes, +40/-0 lines)",
				checkForensicCompliance: async () => ({ compliant: true }),
			},
			callbacks: { say: async () => undefined },
		} as unknown as TaskConfig

		try {
			const runner = new FinalizationRunner(finalizeConfig)
			const runResult = await runner.run()
			runResult.success.should.be.true()

			const sealed = await runner.sealSession("Trap closeout sealed")
			sealed.success.should.be.true()

			const receipt = JSON.parse(sealed.receiptJson!) as CompletionReceipt
			validateCompletionReceipt(receipt).valid.should.be.true()
			receipt.engineeringVerifiedAt.should.be.a.Number()
			receipt.gateReasonCode.should.equal("receipt.sealed")
			receipt.continuityMarker.should.containEql("trap-closeout-task")
			receipt.lifecycleTransitionHistory.length.should.be.greaterThan(0)
			validateFinalizationEvidenceForReceipt(receipt.finalizationEvidence).valid.should.be.true()
			receipt.finalizationEvidence.docsUpdated.should.containEql(".wiki/changelog.md")
			receipt.finalizationEvidence.ledgerStamped.should.be.true()

			const changelog = await readFile(path.join(tmpDir, ".wiki/changelog.md"), "utf-8")
			changelog.should.containEql("Session Finalization")
		} finally {
			await rm(tmpDir, { recursive: true, force: true })
		}
	})

	it("rejects summary-only receipt shapes", () => {
		const receipt = {
			receiptId: "r-summary",
			taskId: "t1",
			outcome: "completed_without_retry_completion" as const,
			engineeringVerifiedAt: Date.now(),
			finalizationEvidence: {
				finalizationRunId: "x",
				status: "passed" as const,
				docsUpdated: [],
				ledgerStamped: false,
				roadmapValidated: false,
				schemaValidationPassed: false,
				artifactPaths: [],
				changelogEntryPreview: "Summary only — no artifacts",
			},
			gateReasonCode: "receipt.sealed" as const,
			lifecycleTransitionHistory: [],
			continuityMarker: buildContinuityMarker("t1", "r-summary", Date.now()),
			sealedAt: Date.now(),
			operatorVisible: true as const,
		}
		validateCompletionReceipt(receipt).valid.should.be.false()
	})

	it("subagent completion-gate evaluation persists gateLifecycleStatus", async () => {
		taskState.engineeringVerifiedAt = Date.now()
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT

		const config = configWithState(taskState)
		const gateResult = await validateSubagentCompletionGates(config, SUBSTANTIVE_RESULT)

		gateResult.lifecycle.lifecycleState.should.equal("finalization_ready")
		gateResult.lifecycle.allowedActions.should.containEql("run_finalization")

		const builder = new SubagentEnvelopeBuilder(
			"agent-trap",
			"exec-trap",
			"researcher",
			"swarm-trap",
			"trap-closeout-task",
			SUBSTANTIVE_RESULT,
			{ swarmId: "swarm-trap", index: 1, depth: 1 },
		)
		builder.setPhase("completion_gate")
		builder.recordGateLifecycle(gateResult.lifecycle)
		if (gateResult.error) {
			builder.recordBlocker(gateResult.error)
		}

		const envelope = builder.build()
		envelope.gateLifecycleStatus?.lifecycleState.should.equal("finalization_ready")
		envelope.gateLifecycleStatus?.engineering.should.equal("passed")
	})

	it("engineering latch survives repeated gate evaluation under retry-lock", () => {
		latchEngineeringVerified(configWithState(taskState), "chk-persist")
		const latchedAt = taskState.engineeringVerifiedAt
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT

		for (let i = 0; i < 3; i++) {
			evaluateGateLifecycle(configWithState(taskState))
		}

		taskState.engineeringVerifiedAt?.should.equal(latchedAt)
		canRunFinalization(configWithState(taskState)).should.be.true()
	})
})
