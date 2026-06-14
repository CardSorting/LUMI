import * as assert from "assert"
import { DEFAULT_ROADMAP_CONFIG, getRoadmapConfig, setRoadmapConfigOverride } from "../RoadmapConfig"
import { determinePhase, recommendNextAction } from "../RoadmapOperator"

describe("RoadmapGates", () => {
	afterEach(() => {
		setRoadmapConfigOverride(null)
	})

	it("determinePhase returns bootstrap when roadmap missing", () => {
		const phase = determinePhase({
			roadmap_exists: false,
			sections_missing: [],
			health_status: null,
			validation_valid: undefined,
			bootstrap_incomplete: false,
		})
		assert.strictEqual(phase.phase, "bootstrap")
		assert.match(phase.agent_next_call, /checkpoint/)
	})

	it("determinePhase returns bootstrap_fill when placeholders remain", () => {
		const phase = determinePhase({
			roadmap_exists: true,
			sections_missing: [],
			health_status: "Healthy",
			validation_valid: true,
			bootstrap_incomplete: true,
		})
		assert.strictEqual(phase.phase, "bootstrap_fill")
	})

	it("recommendNextAction uses roadmap tool commands not slash paths", () => {
		const rec = recommendNextAction({ schema_valid: false, roadmap_exists: true })
		assert.match(rec.command, /roadmap\(action=/)
		assert.doesNotMatch(rec.command, /^\/roadmap/)
	})

	it("fail_closed_completion_gates defaults true", () => {
		setRoadmapConfigOverride(null)
		assert.strictEqual(getRoadmapConfig().fail_closed_completion_gates, true)
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.fail_closed_completion_gates, true)
	})
})
