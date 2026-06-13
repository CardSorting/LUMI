import { expect } from "chai"
import { dbPool } from "../../db/BufferedDbPool"
import { AgentOrchestrator } from "../Orchestrator"

describe("AgentOrchestrator audit ergonomics", () => {
	const orchestrator = new AgentOrchestrator()

	type DbPoolPatch = {
		selectOne: (table: string, where: unknown, agentId?: string) => Promise<unknown>
		push: (op: unknown, agentId?: string, affectedFile?: string) => Promise<unknown>
		pushBatch: (ops: unknown[], agentId?: string, affectedFile?: string) => Promise<unknown>
		commitWork: (agentId: string, validator?: unknown) => Promise<unknown>
	}

	const withPatchedDbPool = async <T>(patch: Partial<DbPoolPatch>, callback: () => Promise<T>): Promise<T> => {
		const target = dbPool as unknown as DbPoolPatch
		const original: DbPoolPatch = {
			selectOne: target.selectOne,
			push: target.push,
			pushBatch: target.pushBatch,
			commitWork: target.commitWork,
		}

		if (patch.selectOne) target.selectOne = patch.selectOne
		if (patch.push) target.push = patch.push
		if (patch.pushBatch) target.pushBatch = patch.pushBatch
		if (patch.commitWork) target.commitWork = patch.commitWork

		try {
			return await callback()
		} finally {
			target.selectOne = original.selectOne
			target.push = original.push
			target.pushBatch = original.pushBatch
			target.commitWork = original.commitWork
		}
	}

	it("returns deterministic production audit metadata for completed work", async () => {
		const metadata = await orchestrator.auditTask(
			"task-audit",
			"Deeply audit improved agent ergonomics and production harden unresolved placeholders.",
			"Implemented deterministic audit metadata in src/infrastructure/ai/Orchestrator.ts. Ran tsc and validated the focused file.",
			"agent ergonomics production hardening",
		)

		expect(metadata.result_checksum).to.match(/^[a-f0-9]{64}$/)
		expect(metadata.intent_classification).to.equal("INVESTIGATE")
		expect(metadata.entropy_score).to.be.a("number")
		expect(metadata.intent_coverage).to.be.a("number")
		expect(metadata.violations).to.not.include("missing_validation_evidence")
	})

	it("flags unresolved markers and missing verification evidence", async () => {
		const metadata = await orchestrator.auditTask(
			"task-unresolved",
			"Fix the production auth flow and verify the hardening pass.",
			"TODO: replace the fake auth stub. Not implemented.",
			"production auth",
		)

		expect(metadata.divergence_detected).to.equal(true)
		expect(metadata.violations).to.include("unresolved_work_marker:todo")
		expect(metadata.violations).to.include("unresolved_work_marker:not_implemented")
		expect(metadata.violations).to.include("unresolved_work_marker:stub")
		expect(metadata.violations).to.include("missing_validation_evidence")
	})

	it("pre-audits validation-oriented requests as test intent", async () => {
		const intent = await orchestrator.preAuditIntent("Run the smoke tests, verify the build, and validate coverage.")
		expect(intent).to.equal("TEST")
	})

	it("automatically attaches audit metadata to completed task status updates", async () => {
		let pushedUpdate: { values?: Record<string, unknown> } | undefined

		await withPatchedDbPool(
			{
				selectOne: async (table) => {
					if (table === "agent_tasks") {
						return {
							id: "task-lifecycle",
							streamId: "stream-lifecycle",
							description: "Fix the lifecycle audit path and verify it with tests.",
						}
					}
					if (table === "agent_streams") {
						return { id: "stream-lifecycle", focus: "agent ergonomics production hardening" }
					}
					return null
				},
				push: async (op) => {
					pushedUpdate = op as { values?: Record<string, unknown> }
				},
			},
			async () => {
				await orchestrator.updateTaskStatus(
					"task-lifecycle",
					"completed",
					"Implemented lifecycle audit metadata and ran tests.",
				)
			},
		)

		expect(pushedUpdate?.values?.metadata).to.be.a("string")
		const metadata = JSON.parse(String(pushedUpdate?.values?.metadata ?? "{}"))
		expect(metadata.result_checksum).to.match(/^[a-f0-9]{64}$/)
		expect(metadata.intent_classification).to.equal("FIX")
		expect(metadata.violations).to.not.include("missing_validation_evidence")
	})

	it("escapes stream completion summaries before building coordination XML", async () => {
		const notification = await withPatchedDbPool(
			{
				commitWork: async () => undefined,
				pushBatch: async () => undefined,
			},
			() => orchestrator.completeStream("stream-xml", `Use <xml> & "quotes" safely.`),
		)

		expect(notification).to.contain("&lt;xml&gt;")
		expect(notification).to.contain("&amp;")
		expect(notification).to.contain("&quot;quotes&quot;")
		expect(notification).not.to.contain("<result>Use <xml>")
	})
})
