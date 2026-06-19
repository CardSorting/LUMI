import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { COMPLETION_RESULT_MAX_LENGTH, MAX_COMPLETION_GATE_BLOCK_COUNT } from "@shared/audit/gatePolicy"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { TaskState } from "../../TaskState"
import {
	COMPLETION_PREFLIGHT_STAGES,
	recordCompletionPreflightFailure,
	validateCompletionResultQuality,
} from "../attemptCompletionUtils"
import {
	evaluateCompletionGateReadiness,
	evaluateCompletionGateReadinessAsync,
	PREFLIGHT_STAGE_RUNNERS,
	runCompletionGateFlow,
	runCompletionPreflightChecks,
} from "../completionGatePipeline"
import type { TaskConfig } from "../types/TaskConfig"

const VALID_RESULT =
	"Implemented retry logic with exponential backoff across the completion gate pipeline. " +
	"All unit tests pass and the handler now wraps errors consistently."

function configWithState(taskState: TaskState): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => [],
		},
	} as unknown as TaskConfig
}

describe("completionGatePipeline", () => {
	let taskState: TaskState
	let tmpDir = ""

	beforeEach(async () => {
		taskState = new TaskState()
		setRoadmapConfigOverride({ enabled: false })
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "completion-gate-"))
	})

	afterEach(async () => {
		setRoadmapConfigOverride(null)
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true })
		}
	})

	it("fail-fast circuit breaker before quality checks", async () => {
		taskState.completionGateBlockCount = MAX_COMPLETION_GATE_BLOCK_COUNT
		const error = await runCompletionPreflightChecks(configWithState(taskState), { result: VALID_RESULT }, "Test", {
			validateQuality: validateCompletionResultQuality,
			onFailure: recordCompletionPreflightFailure,
		})
		should.exist(error)
		if (error === null) {
			throw new Error("expected circuit breaker error")
		}
		error.should.containEql("maximum completion gate retries")
		error.should.containEql("<completion_gate_recovery")
	})

	it("rejects non-demo commands like echo in preflight", async () => {
		const error = await runCompletionPreflightChecks(
			configWithState(taskState),
			{ result: VALID_RESULT, command: "echo hello world" },
			"Test",
			{
				validateQuality: validateCompletionResultQuality,
				onFailure: recordCompletionPreflightFailure,
			},
		)
		should.exist(error)
		if (error === null) {
			throw new Error("expected demo command error")
		}
		error.should.containEql("demo command")
		error.should.containEql('reason="invalid_demo_command"')
	})

	it("rejects result summaries exceeding max length in preflight", async () => {
		const tooLong = "x".repeat(COMPLETION_RESULT_MAX_LENGTH + 1)
		const error = await runCompletionPreflightChecks(configWithState(taskState), { result: tooLong }, "Test", {
			validateQuality: validateCompletionResultQuality,
			onFailure: recordCompletionPreflightFailure,
		})
		should.exist(error)
		if (error === null) {
			throw new Error("expected max length error")
		}
		error.should.containEql("exceeds maximum length")
		error.should.containEql('reason="result_too_long"')
	})

	it("increments block count on preflight quality failure", async () => {
		const error = await runCompletionPreflightChecks(configWithState(taskState), { result: "   " }, "Test", {
			validateQuality: validateCompletionResultQuality,
			onFailure: recordCompletionPreflightFailure,
		})
		should.exist(error)
		if (error === null) {
			throw new Error("expected preflight quality failure")
		}
		;(taskState.completionGateBlockCount ?? 0).should.equal(1)
		taskState.lastCompletionBlockReason?.should.equal("empty_result")
		;(taskState.completionAttemptCount ?? 0).should.equal(1)
		error.should.containEql("<completion_gate_envelope")
	})

	it("runCompletionGateFlow passes when audit gate is disabled", async () => {
		const flow = await runCompletionGateFlow(configWithState(taskState), { result: VALID_RESULT }, "Test")
		flow.status.should.equal("passed")
	})

	it("preflight registry stages align with COMPLETION_PREFLIGHT_STAGES order", () => {
		const registryStages = PREFLIGHT_STAGE_RUNNERS.map((runner) => runner.stage)
		const expectedSlice = COMPLETION_PREFLIGHT_STAGES.slice(
			COMPLETION_PREFLIGHT_STAGES.indexOf("quality"),
			COMPLETION_PREFLIGHT_STAGES.indexOf("roadmap"),
		)
		registryStages.should.deepEqual(Array.from(expectedSlice))
	})

	it("evaluateCompletionGateReadiness returns dry-run issues without mutating state", () => {
		const issues = evaluateCompletionGateReadiness(configWithState(taskState), { result: "   " })
		issues.length.should.be.greaterThan(0)
		issues[0].stage.should.equal("quality")
		;(taskState.completionGateBlockCount ?? 0).should.equal(0)
	})

	it("evaluateCompletionGateReadinessAsync emits info advisory for auto-clearable roadmap governance", async () => {
		setRoadmapConfigOverride({ enabled: true, block_kanban_on_bootstrap_incomplete: false })
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "README.md"), "# Preflight dry-run\n", "utf8")
		const { bootstrapSkeleton } = await import("@/services/roadmap/RoadmapSchema")
		const skeleton = bootstrapSkeleton({
			project_hint: "Preflight dry-run test",
			anti_goals: "What This Project Must Not Become: drift.",
		})
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), skeleton, "utf8")

		const issues = await evaluateCompletionGateReadinessAsync({ ...configWithState(taskState), cwd: tmpDir } as TaskConfig, {
			result: VALID_RESULT,
		})
		const roadmap = issues.find((issue) => issue.stage === "roadmap")
		should.exist(roadmap)
		roadmap!.severity!.should.equal("info")
		setRoadmapConfigOverride(null)
	})

	it("evaluateCompletionGateReadinessAsync includes roadmap stage when governance blocks", async () => {
		setRoadmapConfigOverride({ enabled: true })
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), "# Roadmap\n", "utf8")

		const issues = await evaluateCompletionGateReadinessAsync({ ...configWithState(taskState), cwd: tmpDir } as TaskConfig, {
			result: VALID_RESULT,
		})
		issues.some((issue) => issue.stage === "roadmap").should.be.true()
		;(taskState.completionGateBlockCount ?? 0).should.equal(0)
		taskState.consecutiveMistakeCount.should.equal(0)
	})

	it("evaluateCompletionGateReadinessAsync skips roadmap when disabled", async () => {
		const issues = await evaluateCompletionGateReadinessAsync({ ...configWithState(taskState), cwd: tmpDir } as TaskConfig, {
			result: VALID_RESULT,
		})
		issues.some((issue) => issue.stage === "roadmap").should.be.false()
	})
})
