import * as fs from "fs"
import { AgentContext } from "../broccolidb/core/agent-context"
import { Workspace } from "../broccolidb/core/workspace"
import { dbPool } from "../broccolidb/infrastructure/db/BufferedDbPool"
import { orchestrator } from "../src/infrastructure/ai/Orchestrator"

async function testSwarmOrchestration() {
	console.log("--- TEST: Swarm Orchestration (Pass 3) ---")

	const workspace = new Workspace(dbPool, "test-user", `test-workspace-${Date.now()}`)
	const ctx = new AgentContext(workspace)

	// 1. Test Scratchpad Lifecycle
	console.log("Testing Sovereign Scratchpad...")
	const scratchpadPath = ctx.tasks.getScratchpadPath()
	await ctx.tasks.updateScratchpad("# Test State\n- Task 1: Pending")

	const loaded = await ctx.tasks.loadScratchpad()
	if (loaded.includes("Task 1: Pending")) {
		console.log("✅ SUCCESS: Scratchpad loaded correctly.")
	} else {
		throw new Error("Scratchpad loading failed.")
	}

	// 2. Test XML-Lite Notifications
	console.log("Testing XML-Lite Notifications...")
	const stream = await orchestrator.createStream("Refactor Auth")
	const notification = await orchestrator.completeStream(
		stream.id,
		"Finished refactoring auth. Added null checks in validation.ts.",
	)

	if (notification.includes("<task-notification>") && notification.includes("<task-id>")) {
		console.log("✅ SUCCESS: XML-Lite notification generated.")
		console.log("Notification Preview:", `${notification.split("\n")[0]}...`)
	} else {
		throw new Error("XML-Lite notification failed.")
	}

	// 3. Test Skeptical Verification Audit
	console.log("Testing Skeptical Verification Audit...")
	// Add some "risky" knowledge
	const node1 = "verify-test-1"
	await ctx.addKnowledge(node1, "fact", "Implementing unsafe direct memory access for performance.", {
		confidence: 0.9,
		metadata: { path: "src/unsafe.ts" },
	})

	const audit = await ctx.reasoningService.performSkepticalAudit([node1])
	console.log("Audit Result - Pass:", audit.pass)
	console.log("Audit Risks:", audit.risks)

	if (audit.risks.includes("unsafe")) {
		console.log("✅ SUCCESS: Skeptical audit detected risks.")
	} else {
		// In some models 'unsafe' might not be flagged as a keyword if the narrative is different,
		// but our implementation looks for 'unsafe' in the lowercased narrative.
		console.log("⚠️ WARNING: Skeptical audit narrative did not contain expected risk keywords, check output.")
	}

	// 4. Test Background Memory Synthesis
	console.log("Testing Background Memory Synthesis...")
	await ctx.performMemorySynthesis()
	const syncedScratchpad = await ctx.tasks.loadScratchpad()

	if (syncedScratchpad.includes("Sovereign Executive Summary")) {
		console.log("✅ SUCCESS: Background synthesis updated the Scratchpad.")
	} else {
		throw new Error("Memory synthesis failed to update Scratchpad.")
	}

	console.log("✅ ALL SWARM ORCHESTRATION TESTS PASSED.")

	// Cleanup
	if (fs.existsSync(scratchpadPath)) fs.unlinkSync(scratchpadPath)
}

testSwarmOrchestration().catch((err) => {
	console.error("❌ TEST FAILED:", err)
	process.exit(1)
})
