import * as assert from "assert"
import * as fs from "fs"
import * as path from "path"
import { orchestrator } from "../src/infrastructure/ai/Orchestrator"
import { dbPool } from "../src/infrastructure/db/BufferedDbPool"
import { setDbPath } from "../src/infrastructure/db/Config"

async function verifyCollision() {
	console.log("🚀 Testing Pass 14: Cross-Shadow Conflict Detection...")

	const agentA = "agent-A"
	const agentB = "agent-B"
	const table = "agent_tasks"
	const where = { column: "id", value: "task-shared" }

	// 0. Setup streams
	await dbPool.push({
		type: "insert",
		table: "agent_streams",
		values: { id: agentA, status: "active", createdAt: Date.now() },
		layer: "infrastructure",
	})
	await dbPool.push({
		type: "insert",
		table: "agent_streams",
		values: { id: agentB, status: "active", createdAt: Date.now() },
		layer: "infrastructure",
	})
	await dbPool.flush()

	// 1. Agent A starts a shadow mutation
	await dbPool.beginWork(agentA)
	await dbPool.push(
		{
			type: "update",
			table: table,
			values: { description: "Updated by A" },
			where: where,
			layer: "infrastructure",
		},
		agentA,
	)

	// 2. Agent B attempts an overlapping shadow mutation (BEFORE A commits)
	await dbPool.beginWork(agentB)
	try {
		await dbPool.push(
			{
				type: "update",
				table: table,
				values: { description: "Updated by B" },
				where: where,
				layer: "infrastructure",
			},
			agentB,
		)
		assert.fail("Should have thrown conflict error for cross-shadow overlap")
	} catch (e: any) {
		console.log(`Cross-Shadow Conflict Caught: ${e.message}`)
		assert.ok(e.message.includes("conflicting with active Stream agent-A"), "Error should identify conflicting agent-A")
	}

	// 3. Cleanup
	await dbPool.rollbackWork(agentA)
	await dbPool.rollbackWork(agentB)
	console.log("✅ Cross-Shadow Conflict Detection Verified!")
}

async function verifyEntropy() {
	console.log("🚀 Testing Pass 14: Algorithmic Entropy (Jaccard)...")

	const prev = "export class Controller { constructor() {} }"
	const current = "export class AgentController { constructor() { console.log('init'); } }"

	const score = orchestrator.calculateEntropy(prev, current)
	console.log(`Entropy Score (Structural Change): ${score}`)
	assert.ok(score > 0.3 && score < 0.7, "Entropy score should reflect partial structural overlap")

	const stableScore = orchestrator.calculateEntropy(prev, prev)
	console.log(`Entropy Score (Stable): ${stableScore}`)
	assert.strictEqual(stableScore, 0, "Entropy score should be 0 for identical structural content")

	console.log("✅ Algorithmic Entropy Verified!")
}

async function run() {
	const testDb = path.join("/tmp", `test-db-${Date.now()}.sqlite`)
	setDbPath(testDb)
	try {
		await verifyCollision()
		await verifyEntropy()
	} catch (e) {
		console.error("❌ Verification Failed:", e)
		process.exit(1)
	} finally {
		await dbPool.stop()
		if (fs.existsSync(testDb)) fs.unlinkSync(testDb)
	}
}

run()
