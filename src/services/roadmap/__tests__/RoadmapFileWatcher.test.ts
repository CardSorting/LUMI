import * as assert from "assert"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { handleExternalRoadmapChange } from "../RoadmapFileWatcher"
import { RoadmapService } from "../RoadmapService"

describe("RoadmapFileWatcher", () => {
	it("marks validation_pending on external ROADMAP.md change", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "roadmap-watch-"))
		try {
			await fs.mkdir(path.join(tmp, ".dietcode"), { recursive: true })
			await fs.writeFile(
				path.join(tmp, ".dietcode", "roadmap-state.json"),
				JSON.stringify({ validation_pending: false }),
				"utf8",
			)
			await fs.writeFile(path.join(tmp, "ROADMAP.md"), "# Roadmap\n", "utf8")

			await handleExternalRoadmapChange(tmp, "external-edit")

			const state = await RoadmapService.getInstance().readState(tmp)
			assert.strictEqual(state.validation_pending, true)
			assert.strictEqual(state.last_mutation_tool, "external-edit")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})
