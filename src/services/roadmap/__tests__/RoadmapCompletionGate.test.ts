import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	evaluateRoadmapCompletionBlock,
	failClosedCompletionMessage,
	requireFreshCheckpointBeforeComplete,
	roadmapPreflightReadinessFromDryRun,
} from "../RoadmapCompletionGate"
import { DEFAULT_ROADMAP_CONFIG, setRoadmapConfigOverride } from "../RoadmapConfig"
import { bootstrapSkeleton } from "../RoadmapSchema"
import { RoadmapService } from "../RoadmapService"

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

	it("dry-run preview does not mutate roadmap-state.json", async () => {
		setRoadmapConfigOverride({
			...DEFAULT_ROADMAP_CONFIG,
			enabled: true,
			block_kanban_on_bootstrap_incomplete: false,
		})
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		const statePath = path.join(tmpDir, ".dietcode", "roadmap-state.json")
		await fs.writeFile(statePath, JSON.stringify({ validation_pending: true }), "utf8")
		await fs.writeFile(path.join(tmpDir, "README.md"), "# Dry run test\n", "utf8")
		const skeleton = bootstrapSkeleton({
			project_hint: "Dry run gate test",
			anti_goals: "What This Project Must Not Become: ungoverned sprawl.",
		})
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), skeleton, "utf8")

		const block = await evaluateRoadmapCompletionBlock(tmpDir, { dryRun: true })
		assert.strictEqual(block.blocked, false)
		assert.ok(block.dryRunAdvisory)
		assert.ok(block.remediationSteps?.some((s) => s.startsWith("will-")))

		const stateAfter = JSON.parse(await fs.readFile(statePath, "utf8"))
		assert.strictEqual(stateAfter.validation_pending, true)
	})

	it("live remediation clears validation_pending", async () => {
		setRoadmapConfigOverride({
			...DEFAULT_ROADMAP_CONFIG,
			enabled: true,
			block_kanban_on_bootstrap_incomplete: false,
		})
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "README.md"), "# Completion gate test\n\nSteering surface.\n", "utf8")
		const skeleton = bootstrapSkeleton({
			project_hint: "Completion gate test project",
			anti_goals: "What This Project Must Not Become: ungoverned sprawl.",
			strategic_narrative: "A governed TypeScript project with ROADMAP steering.",
			operators_hint: "Developers and coding agents.",
			canonical_architecture: "Monorepo with src/ services layer.",
			canonical_workflows: "Edit, test, ship via PR.",
			runtime_center: "Workspace root beside package.json.",
			health_summary: "Coherent bootstrap for gate test.",
			now_section: "### 1. Gate test\n- Verify auto-validation at completion",
			checkpoint_next_move: "Retry attempt_completion after auto-validation.",
		})
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), skeleton, "utf8")

		const block = await evaluateRoadmapCompletionBlock(tmpDir)
		assert.strictEqual(block.blocked, false)
		assert.ok(block.remediationSteps?.some((s) => s.includes("auto-validated")))
	})

	it("blocks completion when ROADMAP.md cannot be auto-validated", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), "# Test\n", "utf8")

		const block = await evaluateRoadmapCompletionBlock(tmpDir)
		assert.strictEqual(block.blocked, true)
		assert.match(block.message || "", /ROADMAP\.md/)
		assert.doesNotMatch(block.message || "", /roadmap\(action=/)
	})

	it("requireFreshCheckpointBeforeComplete returns diagnostic message without tool commands", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), "# Test\n", "utf8")

		const msg = await requireFreshCheckpointBeforeComplete(tmpDir)
		assert.ok(msg)
		assert.match(msg, /ROADMAP\.md/)
		assert.doesNotMatch(msg, /roadmap\(action=/)
	})

	it("auto-stamps missing checkpoint date during completion remediation", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		const skeleton = bootstrapSkeleton({
			project_hint: "Checkpoint touch test",
			anti_goals: "What This Project Must Not Become: drift.",
		})
		// Remove valid date to trigger no_recent_checkpoint_date stale reason
		const withoutDate = skeleton.replace(/\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/, "**Date:** TBD")
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), withoutDate, "utf8")

		const touched = await RoadmapService.getInstance().touchRecentCheckpointDate(tmpDir)
		assert.strictEqual(touched.written, true)

		const text = await fs.readFile(path.join(tmpDir, "ROADMAP.md"), "utf8")
		assert.match(text, /\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/)
	})

	it("roadmapPreflightReadinessFromDryRun maps auto-clearable dry-run to info severity", async () => {
		await fs.mkdir(path.join(tmpDir, ".dietcode"), { recursive: true })
		await fs.writeFile(
			path.join(tmpDir, ".dietcode", "roadmap-state.json"),
			JSON.stringify({ validation_pending: true }),
			"utf8",
		)
		await fs.writeFile(path.join(tmpDir, "README.md"), "# Gate test\n", "utf8")
		const skeleton = bootstrapSkeleton({
			project_hint: "Gate test",
			anti_goals: "What This Project Must Not Become: drift.",
		})
		await fs.writeFile(path.join(tmpDir, "ROADMAP.md"), skeleton, "utf8")

		const block = await evaluateRoadmapCompletionBlock(tmpDir, { dryRun: true })
		const issue = roadmapPreflightReadinessFromDryRun(block)
		assert.ok(issue)
		assert.strictEqual(issue!.severity, "info")
		assert.match(issue!.message, /attempt_completion/)
	})

	it("failClosedCompletionMessage avoids external tool commands", () => {
		const msg = failClosedCompletionMessage()
		assert.match(msg, /ROADMAP\.md/)
		assert.doesNotMatch(msg, /doctor|explain-gate/)
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
