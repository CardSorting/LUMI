import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { expect } from "chai"
import sinon from "sinon"
import { TaskLatencyTracker } from "@/core/task/latency/TaskLatencyTracker"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { runCompletionAudit, scheduleCompletionAuditPersistence } from "../completionAudit"

describe("completion audit infrastructure resilience", () => {
	const metadata = {
		hardening_grade: "A",
		hardening_score: 95,
		violations: [],
		result_checksum: "checksum",
	} as TaskAuditMetadata

	afterEach(() => {
		sinon.restore()
	})

	it("uses task-local context when stream focus lookup is unavailable", async () => {
		sinon.stub(orchestrator, "resolveStreamFocus").rejects(new Error("service unavailable"))
		const audit = sinon.stub(orchestrator, "auditTask").resolves(metadata)
		sinon.stub(orchestrator, "persistTaskAudit").resolves()

		const result = await runCompletionAudit("task-1", "Fix registration", "Implemented and verified registration")

		expect(result).to.equal(metadata)
		expect(
			audit.calledOnceWith("task-1", "Fix registration", "Implemented and verified registration", "Fix registration"),
		).to.equal(true)
	})

	it("returns a valid local audit when durable persistence is unavailable", async () => {
		sinon.stub(orchestrator, "resolveStreamFocus").resolves("registration flow")
		sinon.stub(orchestrator, "auditTask").resolves(metadata)
		sinon.stub(orchestrator, "persistTaskAudit").rejects(new Error("database unavailable"))

		const result = await runCompletionAudit("task-2", "Fix registration", "Implemented and verified registration")

		expect(result).to.equal(metadata)
	})

	it("uses supplied grounded context and does not await durable persistence", async () => {
		const focus = sinon.stub(orchestrator, "resolveStreamFocus").rejects(new Error("should not read persistence"))
		const audit = sinon.stub(orchestrator, "auditTask").resolves(metadata)
		let finishPersistence!: () => void
		let persistenceFinished = false
		const persistence = new Promise<void>((resolve) => {
			finishPersistence = () => {
				persistenceFinished = true
				resolve()
			}
		})
		sinon.stub(orchestrator, "persistTaskAudit").returns(persistence)
		let now = 0
		const tracker = new TaskLatencyTracker(() => now)

		const result = await runCompletionAudit(
			"task-fast-path",
			"Fix registration",
			"Implemented and verified registration",
			"grounded registration task",
			tracker,
		)

		expect(result).to.equal(metadata)
		expect(persistenceFinished).to.equal(false)
		expect(tracker.snapshot().events.some((event) => event.name === "persistence_scheduled")).to.equal(true)
		expect(focus.called).to.equal(false)
		expect(
			audit.calledOnceWith(
				"task-fast-path",
				"Fix registration",
				"Implemented and verified registration",
				"grounded registration task",
			),
		).to.equal(true)

		now = 8
		finishPersistence()
		await persistence
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(tracker.snapshot().postResultPersistenceDurationMs).to.equal(8)
	})

	it("remains fail-closed when the authoritative local audit fails", async () => {
		sinon.stub(orchestrator, "resolveStreamFocus").resolves("registration flow")
		sinon.stub(orchestrator, "auditTask").rejects(new Error("audit calculation failed"))

		let error: unknown
		try {
			await runCompletionAudit("task-3", "Fix registration", "Implemented and verified registration")
		} catch (caught) {
			error = caught
		}

		expect(error).to.be.instanceOf(Error)
		expect((error as Error).message).to.equal("audit calculation failed")
	})

	it("can defer durable audit scheduling until after authoritative result presentation", async () => {
		sinon.stub(orchestrator, "auditTask").resolves(metadata)
		const persist = sinon.stub(orchestrator, "persistTaskAudit").resolves()
		const tracker = new TaskLatencyTracker()

		const result = await runCompletionAudit(
			"task-post-result",
			"Fix registration",
			"Implemented and verified registration",
			"grounded registration task",
			tracker,
			false,
		)
		expect(result).to.equal(metadata)
		expect(persist.called).to.equal(false)
		expect(tracker.snapshot().events.some((event) => event.name === "persistence_scheduled")).to.equal(false)

		scheduleCompletionAuditPersistence("task-post-result", metadata, tracker)
		expect(persist.calledOnce).to.equal(true)
		expect(tracker.snapshot().events.some((event) => event.name === "persistence_scheduled")).to.equal(true)
	})
})
