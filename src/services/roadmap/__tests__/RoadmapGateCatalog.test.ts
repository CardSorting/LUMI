import * as assert from "assert"
import { DEFAULT_ROADMAP_CONFIG } from "../RoadmapConfig"
import { blockingClosedGates, evaluateGateChecks, type GateClosedEntry, type GateInputs } from "../RoadmapGateCatalog"

function baseInputs(overrides: Partial<GateInputs> = {}): GateInputs {
	return {
		config: DEFAULT_ROADMAP_CONFIG,
		workspace: "/tmp/project",
		roadmap_path: "/tmp/project/ROADMAP.md",
		roadmap_present: true,
		validation: {
			valid: true,
			schema_complete: true,
			health_status: "Healthy",
			code_soup_risk: "Low",
			now_item_count: 2,
			issues: [],
		},
		freshness: { stale: false, reason: "fresh", summary: "ok" },
		workspace_state: { validation_pending: false, bootstrap_complete: true },
		bootstrap_complete: true,
		bootstrap_placeholder_count: 0,
		project_fingerprint: { steering_brief: "Audit Project — test" },
		evidence_roadmap: { sections_missing: [] },
		...overrides,
	}
}

describe("RoadmapGateCatalog", () => {
	it("blocks completion on validation_pending when configured", () => {
		const { closed } = evaluateGateChecks(
			baseInputs({
				workspace_state: { validation_pending: true },
			}),
		)
		const blocking = blockingClosedGates(closed, DEFAULT_ROADMAP_CONFIG)
		assert.ok(blocking.some((g) => g.id === "validation_current"))
	})

	it("blocks completion on invalid schema when block_kanban_on_invalid_schema is true", () => {
		const { closed } = evaluateGateChecks(
			baseInputs({
				validation: {
					valid: false,
					schema_complete: false,
					code_soup_risk: "Low",
					now_item_count: 0,
					issues: [{ severity: "error", code: "missing_section", message: "missing section" }],
				},
			}),
		)
		const blocking = blockingClosedGates(closed, {
			...DEFAULT_ROADMAP_CONFIG,
			block_kanban_on_invalid_schema: true,
		})
		assert.ok(
			blocking.some((g: GateClosedEntry) => g.id === "schema_valid"),
			"invalid schema should block when block_kanban_on_invalid_schema=true",
		)
	})

	it("does not block on invalid schema when block_kanban_on_invalid_schema is false", () => {
		const { closed } = evaluateGateChecks(
			baseInputs({
				validation: {
					valid: false,
					schema_complete: false,
					code_soup_risk: "Low",
					now_item_count: 0,
					issues: [{ severity: "error", code: "missing_section", message: "missing section" }],
				},
			}),
		)
		const blocking = blockingClosedGates(closed, {
			...DEFAULT_ROADMAP_CONFIG,
			block_kanban_on_invalid_schema: false,
		})
		assert.strictEqual(
			blocking.some((g) => g.id === "schema_valid"),
			false,
		)
	})

	it("includes workspace_safe in closed gates for quarantined paths", () => {
		const { closed } = evaluateGateChecks(
			baseInputs({
				workspace: "/Users/dev/Downloads/codemarie-new/dist/extension",
			}),
		)
		assert.ok(closed.some((g) => g.id === "workspace_safe"))
	})
})
