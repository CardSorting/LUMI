import { expect } from "chai"
import { dbPool } from "../../db/BufferedDbPool"
import { AgentOrchestrator } from "../Orchestrator"

describe("AgentOrchestrator audit ergonomics", () => {
	const orchestrator = new AgentOrchestrator()

	type DbPoolPatch = {
		selectOne: (table: string, where: any, agentId?: string) => Promise<any>
		selectWhere: (table: string, where: any, agentId?: string) => Promise<any[]>
		selectAllFrom: (table: string, agentId?: string) => Promise<any[]>
		push: (op: any, agentId?: string, affectedFile?: string) => Promise<any>
		pushBatch: (ops: any[], agentId?: string, affectedFile?: string) => Promise<any>
		commitWork: (agentId: string, validator?: unknown) => Promise<unknown>
	}

	const withPatchedDbPool = async <T>(patch: Partial<DbPoolPatch>, callback: () => Promise<T>): Promise<T> => {
		const target = dbPool as any
		const original: Partial<DbPoolPatch> = {
			selectOne: target.selectOne,
			selectWhere: target.selectWhere,
			selectAllFrom: target.selectAllFrom,
			push: target.push,
			pushBatch: target.pushBatch,
			commitWork: target.commitWork,
		}

		if (patch.selectOne) target.selectOne = patch.selectOne
		if (patch.selectWhere) target.selectWhere = patch.selectWhere
		if (patch.selectAllFrom) target.selectAllFrom = patch.selectAllFrom
		if (patch.push) target.push = patch.push
		if (patch.pushBatch) target.pushBatch = patch.pushBatch
		if (patch.commitWork) target.commitWork = patch.commitWork

		try {
			return await callback()
		} finally {
			if (original.selectOne) target.selectOne = original.selectOne
			if (original.selectWhere) target.selectWhere = original.selectWhere
			if (original.selectAllFrom) target.selectAllFrom = original.selectAllFrom
			if (original.push) target.push = original.push
			if (original.pushBatch) target.pushBatch = original.pushBatch
			if (original.commitWork) target.commitWork = original.commitWork
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
		expect(metadata.hardening_score).to.be.a("number")
		expect(metadata.hardening_grade).to.be.oneOf(["A", "B", "C", "D", "F"])
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
		expect(metadata.hardening_grade).to.equal("F")
		expect(metadata.violations).to.include("unresolved_work_marker:todo")
		expect(metadata.violations).to.include("unresolved_work_marker:not_implemented")
		expect(metadata.violations).to.include("unresolved_work_marker:stub")
		expect(metadata.violations).to.include("missing_validation_evidence")
	})

	it("flags potential credential leaks in completion results", async () => {
		const metadata = await orchestrator.auditTask(
			"task-leak",
			"Document the API integration setup.",
			"Configured with api_key=sk-abcdefghijklmnopqrstuvwxyz1234567890 for testing.",
			"api integration",
		)

		expect(metadata.violations).to.include("security_leak")
		expect(metadata.hardening_grade).to.equal("F")
	})

	it("resolves stream focus from stream records and memory fallbacks", async () => {
		const focus = await withPatchedDbPool(
			{
				selectOne: async (table, where) => {
					if (table === "agent_streams" && where.value === "stream-focus") {
						return { id: "stream-focus", focus: "agent ergonomics production hardening" }
					}
					if (table === "agent_memory") {
						return null
					}
					return null
				},
			},
			() => orchestrator.resolveStreamFocus("stream-focus", "fallback focus"),
		)

		expect(focus).to.equal("agent ergonomics production hardening")
	})

	it("resolves stream focus from pre-audited intent memory when stream focus is absent", async () => {
		const focus = await withPatchedDbPool(
			{
				selectOne: async (table) => {
					if (table === "agent_streams") return null
					if (table === "agent_memory") {
						return { value: "INVESTIGATE" }
					}
					return null
				},
			},
			() => orchestrator.resolveStreamFocus("stream-intent-only", "fallback focus"),
		)

		expect(focus).to.equal("INVESTIGATE")
	})

	it("persists and recalls task audit metadata", async () => {
		const stored: Record<string, string> = {}
		const memoryRows: Array<{ key: string; value: string; streamId: string }> = []
		await withPatchedDbPool(
			{
				selectOne: async (_table, where) => {
					if (Array.isArray(where)) {
						const keyCond = where.find((w: { column: string }) => w.column === "key")
						if (keyCond?.value === "last_completion_audit") {
							return stored.last_completion_audit ? { value: stored.last_completion_audit } : null
						}
					}
					return null
				},
				selectWhere: async (_table, where) => {
					if (where?.column === "streamId" && where?.value === "stream-persist") {
						return memoryRows
					}
					return []
				},
				pushBatch: async (
					ops: Array<{
						type: string
						table: string
						values?: { key?: string; value?: string; streamId?: string }
					}>,
				) => {
					for (const op of ops) {
						if (op.type === "upsert" && op.values?.key?.startsWith("audit_trail_")) {
							stored.last_completion_audit = op.values.value ?? ""
							memoryRows.push({
								key: op.values.key,
								value: op.values.value ?? "",
								streamId: op.values.streamId ?? "stream-persist",
							})
						}
						if (op.type === "upsert" && op.values?.key === "last_completion_audit") {
							stored.last_completion_audit = op.values.value ?? ""
						}
					}
				},
			},
			async () => {
				const metadata = await orchestrator.auditTask(
					"task-persist",
					"Verify persistence",
					"Implemented audit persistence and ran tests.",
					"persistence hardening",
				)
				await orchestrator.persistTaskAudit("stream-persist", metadata)
				const recalled = await orchestrator.recallLastTaskAudit("stream-persist")
				expect(recalled?.hardening_grade).to.equal(metadata.hardening_grade)
				expect(recalled?.result_checksum).to.equal(metadata.result_checksum)

				const trail = await orchestrator.recallAuditTrail("stream-persist", 5)
				expect(trail).to.have.length(1)
				expect(trail[0]?.hardening_grade).to.equal(metadata.hardening_grade)
			},
		)
	})

	it("replaces duplicate audit hooks instead of stacking them", async () => {
		const hookName = "DuplicateHookGuard"
		let callCount = 0

		orchestrator.registerAuditHook({
			name: hookName,
			validate: () => {
				callCount += 1
				return ["duplicate_hook_marker"]
			},
		})
		orchestrator.registerAuditHook({
			name: hookName,
			validate: () => {
				callCount += 1
				return ["duplicate_hook_marker"]
			},
		})

		const metadata = await orchestrator.auditTask(
			"task-dedupe",
			"Check hook dedupe",
			"verified result with tests",
			"hook dedupe",
		)
		expect(metadata.violations).to.include("duplicate_hook_marker")
		expect(callCount).to.equal(1)

		orchestrator.unregisterAuditHook(hookName)
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
		expect(metadata.hardening_grade).to.be.oneOf(["A", "B", "C", "D", "F"])
		expect(metadata.violations).to.not.include("missing_validation_evidence")
	})

	it("escapes stream completion summaries before building coordination XML", async () => {
		const notification = await withPatchedDbPool(
			{
				commitWork: async () => undefined,
				pushBatch: async () => undefined,
				selectWhere: async () => [],
			},
			() => orchestrator.completeStream("stream-xml", `Use <xml> & "quotes" safely.`),
		)

		expect(notification).to.contain("&lt;xml&gt;")
		expect(notification).to.contain("&amp;")
		expect(notification).to.contain("&quot;quotes&quot;")
		expect(notification).not.to.contain("<result>Use <xml>")
	})

	it("allows registering and unregistering custom audit hooks", async () => {
		const hookName = "CustomSecurityValidator"
		let hookCalled = false

		orchestrator.registerAuditHook({
			name: hookName,
			validate: (ctx) => {
				hookCalled = true
				if (ctx.taskResult.includes("secret")) {
					return ["security_leak"]
				}
				return []
			},
		})

		const metadata = await orchestrator.auditTask(
			"task-hook",
			"Check output for sensitive data",
			"Here is a private secret exposed.",
			"security check",
		)

		expect(hookCalled).to.equal(true)
		expect(metadata.violations).to.include("security_leak")

		orchestrator.unregisterAuditHook(hookName)

		const metadataAfter = await orchestrator.auditTask(
			"task-hook-after",
			"Check output for sensitive data",
			"Here is a private secret exposed.",
			"security check",
		)
		expect(metadataAfter.violations).to.not.include("security_leak")
	})

	it("generates a hierarchical execution trace for a stream and its children", async () => {
		const trace = await withPatchedDbPool(
			{
				selectOne: async (table, where) => {
					if (table === "agent_streams") {
						if (where.value === "parent-stream") {
							return {
								id: "parent-stream",
								externalId: "ext-1",
								parentId: null,
								focus: "main task",
								status: "completed",
								createdAt: 1000,
							}
						}
						if (where.value === "child-stream") {
							return {
								id: "child-stream",
								externalId: null,
								parentId: "parent-stream",
								focus: "sub task",
								status: "completed",
								createdAt: 2000,
							}
						}
					}
					return null
				},
				selectWhere: async (table, where) => {
					if (table === "agent_streams") {
						if (where.column === "parentId" && where.value === "parent-stream") {
							return [{ id: "child-stream" }]
						}
						if (where.column === "parentId" && where.value === "child-stream") {
							return []
						}
					}
					if (table === "agent_tasks") {
						if (where.value === "parent-stream") {
							return [
								{
									id: "task-p1",
									streamId: "parent-stream",
									description: "main part 1",
									subagent_type: "worker",
									status: "completed",
									result: "done p1",
									metadata: JSON.stringify({
										intent_classification: "CREATE",
										entropy_score: 0.1,
										intent_coverage: 0.9,
										violations: [],
									}),
									createdAt: 1100,
								},
							]
						}
						if (where.value === "child-stream") {
							return [
								{
									id: "task-c1",
									streamId: "child-stream",
									description: "sub part 1",
									subagent_type: "researcher",
									status: "completed",
									result: "done c1",
									metadata: JSON.stringify({
										intent_classification: "INVESTIGATE",
										entropy_score: 0.2,
										intent_coverage: 0.8,
										violations: ["minor_warn"],
									}),
									createdAt: 2100,
								},
							]
						}
					}
					if (table === "agent_memory") {
						return []
					}
					return []
				},
			},
			() => orchestrator.getExecutionTrace("parent-stream"),
		)

		expect(trace.id).to.equal("parent-stream")
		expect(trace.tasks).to.have.lengthOf(1)
		expect(trace.tasks[0].description).to.equal("main part 1")
		expect(trace.children).to.have.lengthOf(1)
		expect(trace.children[0].id).to.equal("child-stream")
		expect(trace.children[0].tasks[0].subagentType).to.equal("researcher")
		expect(trace.children[0].tasks[0].violations).to.include("minor_warn")
	})

	it("detects and fails stalled tasks based on heartbeats", async () => {
		let updatedTaskId = ""
		let updatedStatus = ""
		let updatedResult = ""
		let emittedSignal = false

		await withPatchedDbPool(
			{
				selectAllFrom: async (table) => {
					if (table === "agent_tasks") {
						return [
							{
								id: "stalled-task-1",
								streamId: "stream-stalled",
								description: "stalled desc",
								status: "running",
								createdAt: Date.now() - 5000,
							},
							{
								id: "active-task-2",
								streamId: "stream-stalled",
								description: "active desc",
								status: "running",
								createdAt: Date.now() - 5000,
							},
						]
					}
					return []
				},
				selectOne: async (table, where) => {
					if (table === "agent_tasks") {
						if (Array.isArray(where)) {
							const idCond = where.find((w: any) => w.column === "id")
							if (idCond?.value === "stalled-task-1") {
								return { id: "stalled-task-1", streamId: "stream-stalled", description: "stalled desc" }
							}
						} else if (where.value === "stalled-task-1") {
							return { id: "stalled-task-1", streamId: "stream-stalled", description: "stalled desc" }
						}
					}
					if (table === "agent_streams") {
						return { id: "stream-stalled", focus: "stalled stream focus" }
					}
					if (table === "agent_memory") {
						if (Array.isArray(where)) {
							const keyCond = where.find((w: any) => w.column === "key")
							if (keyCond?.value === "task_heartbeat:active-task-2") {
								return { value: String(Date.now()) }
							}
						}
					}
					return null
				},
				selectWhere: async (table, where) => {
					return []
				},
				push: async (op: any) => {
					if (op && typeof op === "object" && op.type === "update" && op.table === "agent_tasks") {
						updatedTaskId = String(op.where.value)
						updatedStatus = String(op.values.status)
						updatedResult = String(op.values.result)
					}
					if (op && typeof op === "object" && op.type === "insert" && op.table === "agent_memory") {
						const key = String(op.values.key)
						if (key.startsWith("swarm_signal_")) {
							emittedSignal = true
						}
					}
				},
			},
			async () => {
				const stalled = await orchestrator.detectStalledTasks(2000)
				expect(stalled).to.have.lengthOf(1)
				expect(stalled[0].id).to.equal("stalled-task-1")

				await orchestrator.failStalledTasks(2000, "stalled timeout reached")
			},
		)

		expect(updatedTaskId).to.equal("stalled-task-1")
		expect(updatedStatus).to.equal("failed")
		expect(updatedResult).to.contain("stalled timeout reached")
		expect(emittedSignal).to.equal(true)
	})

	it("filters swarm signals using type and since timestamp", async () => {
		const signals = await withPatchedDbPool(
			{
				selectWhere: async (table) => {
					if (table === "agent_memory") {
						return [
							{
								key: "swarm_signal_1",
								value: JSON.stringify({ type: "vibe", value: "all good", timestamp: 100 }),
							},
							{
								key: "swarm_signal_2",
								value: JSON.stringify({ type: "error", value: "something failed", timestamp: 200 }),
							},
							{
								key: "swarm_signal_3",
								value: JSON.stringify({ type: "vibe", value: "recovering", timestamp: 300 }),
							},
						]
					}
					return []
				},
			},
			() => orchestrator.getSwarmSignals("stream-swarm", { type: "vibe", since: 150 }),
		)

		expect(signals).to.have.lengthOf(1)
		expect(signals[0].type).to.equal("vibe")
		expect(signals[0].value).to.equal("recovering")
		expect(signals[0].timestamp).to.equal(300)
	})
})
