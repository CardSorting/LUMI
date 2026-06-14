import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { roadmapToolCommandToSlash } from "../RoadmapOperator"
import { executeRoadmapSlashCommand, ROADMAP_SLASH_HELP, roadmapSlashCommandResponse } from "../RoadmapSlashCommand"

describe("RoadmapSlashCommand", () => {
	it("returns help for empty args", async () => {
		const report = await executeRoadmapSlashCommand("")
		assert.strictEqual(report, ROADMAP_SLASH_HELP)
	})

	it("returns help for help subcommand", async () => {
		const report = await executeRoadmapSlashCommand("help")
		assert.strictEqual(report, ROADMAP_SLASH_HELP)
	})

	it("wraps report in operator envelope", () => {
		const wrapped = roadmapSlashCommandResponse("🗺️ Roadmap cockpit")
		assert.match(wrapped, /roadmap_slash_result/)
		assert.match(wrapped, /explicit_instructions type="roadmap_slash"/)
	})

	it("runs status against temp workspace", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-slash-"))
		try {
			await fs.writeFile(path.join(tmp, "README.md"), "# Demo\n", "utf8")
			const report = await executeRoadmapSlashCommand("status", tmp)
			assert.match(report, /Roadmap status/)
			assert.match(report, /Exists: false/)
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})

describe("roadmapToolCommandToSlash", () => {
	it("maps explain_stale to /roadmap explain-stale", () => {
		assert.strictEqual(roadmapToolCommandToSlash("roadmap(action='explain_stale')"), "/roadmap explain-stale")
	})

	it("maps checkpoint with context", () => {
		assert.strictEqual(
			roadmapToolCommandToSlash("roadmap(action='checkpoint', context='stale refresh')"),
			"/roadmap checkpoint stale refresh",
		)
	})
})
