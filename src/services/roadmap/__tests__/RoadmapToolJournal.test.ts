import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { formatExplainStaleReport } from "../RoadmapFreshness"
import { finalizeRoadmapSession } from "../RoadmapLifecycle"
import { RoadmapService } from "../RoadmapService"
import { parseRoadmapToolAction, parseRoadmapToolResult, ROADMAP_EVENT_BY_ACTION } from "../RoadmapToolJournal"

describe("RoadmapToolJournal", () => {
	it("parseRoadmapToolAction reads action param", () => {
		assert.strictEqual(parseRoadmapToolAction({ action: "validate" }), "validate")
	})

	it("parseRoadmapToolResult detects validate success from validation.valid", () => {
		const { success } = parseRoadmapToolResult(JSON.stringify({ action: "validate", validation: { valid: true }, ok: true }))
		assert.strictEqual(success, true)
	})

	it("maps explain_stale to progress event name", () => {
		assert.strictEqual(ROADMAP_EVENT_BY_ACTION.explain_stale, "explain_stale")
	})
})

describe("RoadmapFreshness", () => {
	it("formatExplainStaleReport includes project and next action", () => {
		const report = formatExplainStaleReport(
			{
				stale: true,
				reason: "checkpoint_expired",
				summary: "Checkpoint is 14d old",
				days_since_checkpoint: 14,
				git_commits_since_checkpoint: 5,
				recommended_action: "roadmap(action='checkpoint', context='stale refresh')",
			},
			"Audit Project",
		)
		assert.match(report, /Audit Project/)
		assert.match(report, /stale refresh/)
	})
})

describe("Roadmap explain_stale", () => {
	it("returns explain_stale payload", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-stale-"))
		try {
			await fs.writeFile(path.join(tmp, "README.md"), "# Stale Test\n", "utf8")
			const result = await RoadmapService.getInstance().explainStale(tmp)
			assert.strictEqual(result.action, "explain_stale")
			assert.ok(result.report)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})

describe("RoadmapLifecycle finalize", () => {
	it("finalizeRoadmapSession runs without error", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-finalize-"))
		try {
			await fs.writeFile(path.join(tmp, "README.md"), "# Finalize\n", "utf8")
			await finalizeRoadmapSession(tmp, "task-finalize-1")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})
