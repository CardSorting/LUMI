import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	evaluateRoadmapCompletionBlock,
	failClosedCompletionMessage,
	requireFreshCheckpointBeforeComplete,
} from "../RoadmapCompletionGate"
import { DEFAULT_ROADMAP_CONFIG, setRoadmapConfigOverride } from "../RoadmapConfig"

describe("RoadmapCompletionGate", () => {
	let tmpDir = ""

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-completion-"))
		setRoadmapConfigOverride({ ...DEFAULT_ROADMAP_CONFIG, enabled: true })
	})

	afterEach(async () => {
		setRoadmapConfigOverride(null)
		if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("allows completion when roadmap disabled", async () => {
		setRoadmapConfigOverride({ enabled: false })
		const block = await evaluateRoadmapCompletionBlock(tmpDir)
		assert.strictEqual(block.blocked, false)
	})

	it("blocks completion when validation_pending in workspace state", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), "# Roadmap\n", "utf8")

		const block = await evaluateRoadmapCompletionBlock(tmpDir)
		assert.strictEqual(block.blocked, true)
		assert.match(block.message || "", /validate/)
	})

	it("requireFreshCheckpointBeforeComplete returns diagnostic message", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), "# Roadmap\n", "utf8")

		const msg = await requireFreshCheckpointBeforeComplete(tmpDir)
		assert.ok(msg)
		assert.match(msg, /explain_gate|validate/)
	})

	it("failClosedCompletionMessage includes doctor recovery", () => {
		assert.match(failClosedCompletionMessage(), /doctor/)
	})
})

describe("RoadmapLifecycle", () => {
	it("initRoadmapSession emits progress for temp workspace", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-lifecycle-"))
		try {
			await fs.writeFile(path.join(tmpDir, "README.md"), "# Lifecycle Test\n", "utf8")
			const { initRoadmapSession } = await import("../RoadmapLifecycle")
			const result = await initRoadmapSession(tmpDir, "task-test-1")
			assert.ok(result)
			assert.strictEqual(result.workspace, tmpDir)
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true })
			setRoadmapConfigOverride(null)
		}
	})
})
