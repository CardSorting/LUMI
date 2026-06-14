import * as assert from "assert"
import { isDigestContext, slimCheckpointPayload } from "../RoadmapCheckpointDigest"
import { resolveRoadmapWritePath, validateRoadmapWriteTarget } from "../RoadmapNativeBridge"

describe("RoadmapNativeBridge", () => {
	it("rejects ROADMAP writes outside workspace", async () => {
		const ws = "/tmp/roadmap-test-project"
		const check = await validateRoadmapWriteTarget("/etc/ROADMAP.md", ws)
		assert.strictEqual(check.allowed, false)
		assert.ok(check.error)
	})

	it("allows ROADMAP.md at workspace root", async () => {
		const ws = "/tmp/roadmap-test-project"
		const check = resolveRoadmapWritePath("ROADMAP.md", ws)
		assert.strictEqual(check.error, null)
		assert.ok(check.resolved?.endsWith("ROADMAP.md"))
	})
})

describe("RoadmapCheckpointDigest", () => {
	it("recognizes digest context", () => {
		assert.strictEqual(isDigestContext("digest"), true)
		assert.strictEqual(isDigestContext("compact"), true)
		assert.strictEqual(isDigestContext("stale refresh"), false)
	})

	it("strips heavy checkpoint fields", () => {
		const slim = slimCheckpointPayload({
			action: "checkpoint",
			phase: "checkpoint",
			evidence: {
				roadmap: { exists: true, health_status: "Healthy" },
				source_files: [{ path: "src/a.ts" }],
				project_identity_line: "Test — stack",
			},
			existing_roadmap_summary: "very long roadmap text",
			suggested_bootstrap: "full skeleton",
			code_soup_pre_audit: { issues: [1, 2, 3] },
		})
		assert.strictEqual(slim.context_mode, "digest")
		assert.strictEqual((slim as Record<string, unknown>).existing_roadmap_summary, undefined)
		assert.strictEqual((slim as Record<string, unknown>).suggested_bootstrap, undefined)
		assert.ok(slim.evidence)
		assert.ok(slim.evidence_digest_note)
	})
})
