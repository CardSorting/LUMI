import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { TaskState } from "../../../TaskState"
import { AutonomousDocumentationFinalizer } from "../../finalization/AutonomousDocumentationFinalizer"
import { FinalizationRunner } from "../../finalization/FinalizationRunner"
import type { TaskConfig } from "../../types/TaskConfig"

describe("FinalizationRunner", () => {
	let tmpDir: string
	let config: TaskConfig

	beforeEach(async () => {
		tmpDir = path.join("/tmp", `finalization-test-${Date.now()}`)
		await mkdir(tmpDir, { recursive: true })
		const taskState = new TaskState()
		taskState.engineeringVerifiedAt = Date.now()
		config = {
			taskId: "task-finalize",
			ulid: "ulid-finalize",
			cwd: tmpDir,
			taskState,
			finalizationMode: false,
			isSubagentExecution: false,
			universalGuard: {
				getSessionImpactSummary: () => "- `src/foo.ts` (1 writes, +10/-0 lines)",
				checkForensicCompliance: async () => ({ compliant: true }),
			},
			callbacks: {
				say: async () => undefined,
			},
		} as unknown as TaskConfig
	})

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true })
	})

	it("same-session finalization updates changelog", async () => {
		const runner = new FinalizationRunner(config)
		const result = await runner.run()
		result.success.should.be.true()
		const changelog = await readFile(path.join(tmpDir, ".wiki/changelog.md"), "utf-8")
		changelog.should.containEql("Session Finalization")
	})

	it("finalization is idempotent on replay", async () => {
		const runner = new FinalizationRunner(config)
		await runner.run()
		const second = await runner.run()
		second.success.should.be.true()
		second.message.should.match(/idempotent/i)
	})

	it("sealed receipt emitted without attempt_completion", async () => {
		const runner = new FinalizationRunner(config)
		await runner.run()
		const sealed = await runner.sealSession("done")
		sealed.success.should.be.true()
		sealed.receiptJson?.should.containEql("completed_without_retry_completion")
		sealed.receiptJson?.should.containEql("continuityMarker")
		sealed.receiptJson?.should.containEql("lifecycleTransitionHistory")
		config.taskState.completionLifecycleState?.should.equal("completed_without_retry_completion")
	})

	it("rejects seal without finalization evidence", async () => {
		const runner = new FinalizationRunner(config)
		const sealed = await runner.sealSession("done")
		sealed.success.should.be.false()
		sealed.message.should.match(/finalization/i)
	})

	it("validate rejects success without artifacts", async () => {
		const finalizer = new AutonomousDocumentationFinalizer(config)
		const validation = await finalizer.validate({
			finalizationRunId: "x",
			status: "passed",
			docsUpdated: [],
			ledgerStamped: false,
			roadmapValidated: false,
			schemaValidationPassed: false,
			artifactPaths: [],
		})
		validation.valid.should.be.false()
	})
})
