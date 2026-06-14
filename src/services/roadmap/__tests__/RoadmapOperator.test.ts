import * as assert from "assert"
import { DEFAULT_ROADMAP_CONFIG } from "../RoadmapConfig"
import {
	buildAgentOperatorHints,
	formatExplainGateReport,
	isBootstrapIncomplete,
	recommendNextAction,
	wrapClarityEnvelope,
} from "../RoadmapOperator"

describe("RoadmapOperator", () => {
	describe("isBootstrapIncomplete", () => {
		it("returns false when roadmap missing", () => {
			assert.strictEqual(isBootstrapIncomplete({ roadmap_exists: false, bootstrap_complete: false }), false)
		})

		it("returns true when placeholders remain", () => {
			assert.strictEqual(
				isBootstrapIncomplete({ roadmap_exists: true, bootstrap_complete: false, bootstrap_placeholder_count: 3 }),
				true,
			)
		})
	})

	describe("recommendNextAction", () => {
		it("prioritizes validation_pending", () => {
			const rec = recommendNextAction({ validation_pending: true, roadmap_exists: true })
			assert.strictEqual(rec.action, "run_validate")
			assert.match(rec.command, /validate/)
		})

		it("prioritizes bootstrap fill", () => {
			const rec = recommendNextAction({ bootstrap_incomplete: true, roadmap_exists: true })
			assert.strictEqual(rec.action, "apply_bootstrap_fill")
		})

		it("routes stale checkpoints to explain_stale", () => {
			const rec = recommendNextAction({ stale: true, roadmap_exists: true, schema_valid: true })
			assert.strictEqual(rec.action, "explain_stale")
			assert.match(rec.command, /explain_stale/)
		})
	})

	describe("wrapClarityEnvelope", () => {
		it("includes playbooks and operator hints", () => {
			const wrapped = wrapClarityEnvelope({
				action: "guide",
				success: true,
				ok: true,
				workspace: "/tmp/project",
				roadmap_gate: { kanban_complete_allowed: true, roadmap_present: true },
				project_steering_digest: { identity_line: "My App — test" },
			})
			assert.ok(wrapped.agent_playbook)
			assert.ok(wrapped.operator_playbook)
			assert.ok(wrapped._roadmap_operator_hints)
			assert.strictEqual(wrapped.project_identity_line, "My App — test")
			assert.strictEqual(wrapped.required_section_count, 12)
		})
	})

	describe("formatExplainGateReport", () => {
		it("formats closed gates", () => {
			const report = formatExplainGateReport({
				workspace: "/tmp/project",
				closed_gates: [
					{
						label: "ROADMAP.md validated after last edit",
						why: "changed since validate",
						fix: "roadmap(action='validate')",
						blocks_kanban_complete: true,
					},
				],
				kanban_complete_allowed: false,
			})
			assert.match(report, /attempt_completion blocked/)
			assert.match(report, /validate/)
		})
	})

	describe("buildAgentOperatorHints", () => {
		it("includes write guard and slash commands", () => {
			const hints = buildAgentOperatorHints({
				gate: {
					roadmap_present: true,
					kanban_complete_allowed: true,
					workspace: "/tmp/project",
				},
				workspace: "/tmp/project",
			})
			assert.strictEqual(hints.preferred_tool, "roadmap")
			assert.ok(Array.isArray(hints.slash_commands))
			assert.match(String(hints.write_guard), /ROADMAP.md/)
		})
	})
})

describe("RoadmapConfig defaults", () => {
	it("enables production hardening flags by default", () => {
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.progress_enabled, true)
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.auto_install_skills, true)
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.block_kanban_on_bootstrap_incomplete, true)
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.fail_closed_completion_gates, true)
		assert.strictEqual(DEFAULT_ROADMAP_CONFIG.session_brief_cache_ttl_seconds > 0, true)
	})
})
