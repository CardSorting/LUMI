import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as completionAudit from "@shared/audit/completionAudit"
import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import sinon from "sinon"
import { setRoadmapConfigOverride } from "@/services/roadmap/RoadmapConfig"
import { TaskState } from "../../TaskState"
import { evaluateCompletionAuditGate, recordAdvisoryAuditCache } from "../completionGatePipeline"
import type { TaskConfig } from "../types/TaskConfig"

const VALID_RESULT =
	"Implemented retry logic with exponential backoff across the completion gate pipeline. " +
	"All unit tests pass and the handler now wraps errors consistently."

function configWithState(taskState: TaskState, cwd = "/tmp"): TaskConfig {
	return {
		taskState,
		focusChainSettings: { enabled: false },
		messageState: {
			getDietCodeMessages: () => [],
		},
		cwd,
	} as unknown as TaskConfig
}

describe("audit invalidation and false-positive prevention", () => {
	let taskState: TaskState
	let tmpDir = ""

	beforeEach(async () => {
		taskState = new TaskState()
		setRoadmapConfigOverride({ enabled: false })
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-invalidation-"))
	})

	afterEach(async () => {
		sinon.restore()
		setRoadmapConfigOverride(null)
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true })
		}
	})

	it("audit cache reuses result for same params within TTL", async () => {
		const config = {
			...configWithState(taskState, tmpDir),
			auditCompletionGateEnabled: true,
			auditCompletionGateThreshold: 70,
			taskId: "cache-reuse-test",
			ulid: "ulid-test",
		} as TaskConfig

		// Use advisory cache to verify reuse pattern
		const advisory = {
			hardening_score: 95,
			violations: [],
			blockCount: 0,
		} as TaskAuditMetadata
		recordAdvisoryAuditCache(config, VALID_RESULT, "task preview", advisory)

		// Stub to ensure it's NOT called (cache hit)
		const auditStub = sinon.stub(completionAudit, "runCompletionAudit").rejects(new Error("should not run"))

		const result = await evaluateCompletionAuditGate(config, {
			result: VALID_RESULT,
			taskDescription: "task preview",
			logPrefix: "Test",
		})

		auditStub.called.should.be.false()
		result.status.should.equal("passed")
		if (result.status === "passed") {
			result.auditMetadata.hardening_score?.should.equal(95)
		}
	})

	it("does not use hidden fallback path when audit infra fails", async () => {
		const config = {
			...configWithState(taskState, tmpDir),
			auditCompletionGateEnabled: true,
			auditCompletionGateThreshold: 70,
			taskId: "no-fallback-test",
			ulid: "ulid-test",
		} as TaskConfig

		// Set up a cached audit that would pass if used as fallback
		const cachedAudit = {
			hardening_score: 90,
			violations: [],
			blockCount: 0,
		} as TaskAuditMetadata
		taskState.lastCompletionAudit = cachedAudit
		taskState.lastCompletionAuditCacheKey = "some-key"
		taskState.lastCompletionAuditCachedAt = Date.now()

		// Stub the audit to throw — simulating infra failure
		const auditStub = sinon.stub(completionAudit, "runCompletionAudit").rejects(new Error("infra down"))

		const result = await evaluateCompletionAuditGate(config, {
			result: VALID_RESULT,
			taskDescription: "task preview",
			logPrefix: "Test",
		})

		// Must NOT return "passed" from the cached fallback
		result.status.should.equal("error")
		result.status.should.not.equal("passed")
		if (result.status === "error") {
			result.message.should.containEql("hardening audit evaluation failed")
		}

		auditStub.called.should.be.true()
	})

	it("advisory audit cache includes checkpoint hash", async () => {
		const config = {
			...configWithState(taskState, tmpDir),
			auditCompletionGateEnabled: true,
			taskId: "advisory-cache-test",
			ulid: "ulid-test",
		} as TaskConfig

		const advisory = {
			hardening_score: 92,
			violations: [],
			blockCount: 0,
		} as TaskAuditMetadata

		// Record advisory with no checkpoint hash
		;(config as unknown as { messageState: { getDietCodeMessages: () => unknown[] } }).messageState = {
			getDietCodeMessages: () => [],
		}
		recordAdvisoryAuditCache(config, VALID_RESULT, "task preview", advisory)
		const keyWithoutHash = taskState.lastAdvisoryAuditCacheKey

		// Record advisory with a checkpoint hash
		;(config as unknown as { messageState: { getDietCodeMessages: () => unknown[] } }).messageState = {
			getDietCodeMessages: () => [{ lastCheckpointHash: "chk-1" }],
		}
		recordAdvisoryAuditCache(config, VALID_RESULT, "task preview", advisory)
		const keyWithHash = taskState.lastAdvisoryAuditCacheKey

		// Keys should differ — checkpoint hash is part of the cache key
		keyWithoutHash?.should.not.equal(keyWithHash)
	})
})
