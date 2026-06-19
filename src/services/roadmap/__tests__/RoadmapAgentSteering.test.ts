import * as assert from "assert"
import { buildProjectContextLines, formatRoadmapSteeringBlock, formatWatchSteeringLine } from "../RoadmapAgentSteering"
import { AUTO_GOVERNANCE } from "../RoadmapAutoGovernance"

describe("RoadmapAgentSteering", () => {
	it("builds rich project context lines", () => {
		const lines = buildProjectContextLines({
			project_identity_line: "Audit Project — Node/TS",
			stack_summary: "TypeScript monorepo",
			project_archetype: "application",
			health_status: "Healthy",
			now_item_count: 3,
			code_soup_risk: "Low",
			recent_checkpoint_date: "2026-06-01",
			project_fingerprint: {
				agent_rules_files: ["AGENTS.md"],
				makefile_targets: ["verify", "test"],
				verification_commands: ["make verify"],
				governance_files: ["SECURITY.md"],
				has_backstage_catalog: true,
			},
		})
		assert.ok(lines.some((l) => l.startsWith("Project:")))
		assert.ok(lines.some((l) => l.includes("AGENTS.md")))
		assert.ok(lines.some((l) => l.includes("make verify")))
		assert.ok(lines.some((l) => l.includes("Backstage")))
	})

	it("formats environment steering block with gate warnings", () => {
		const block = formatRoadmapSteeringBlock({
			project_identity_line: "My App",
			phase: "bootstrap_fill",
			validation_pending: true,
			kanban_complete_allowed: false,
			schema_valid: true,
			roadmap_gate: {
				blocking_gates: [{ id: "validation_current", label: "Validated", why: "pending", fix: "wait" }],
			},
			agent_next_call: AUTO_GOVERNANCE.continueTaskMidPass,
		})
		assert.match(block, /# Roadmap Steering/)
		assert.doesNotMatch(block, /attempt_completion blocked/)
		assert.match(block, /automatically/)
	})

	it("formats compact watch line", () => {
		const line = formatWatchSteeringLine({
			project_identity_line: "My App",
			phase: "checkpoint",
			validation_pending: true,
			kanban_complete_allowed: false,
			agent_next_call: "roadmap(action='cockpit')",
		})
		assert.match(line, /\[roadmap\]/)
		assert.match(line, /pending/)
	})
})
