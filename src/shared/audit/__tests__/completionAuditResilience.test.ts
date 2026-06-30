import type { TaskAuditMetadata } from "@shared/ExtensionMessage"
import { expect } from "chai"
import sinon from "sinon"
import { orchestrator } from "@/infrastructure/ai/Orchestrator"
import { runCompletionAudit } from "../completionAudit"

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
})
