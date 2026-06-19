import * as assert from "assert"
import {
	AUTO_GOVERNANCE,
	buildRoadmapGateStructuredEnvelope,
	formatBlockingGatesList,
	formatKanbanGateStatusLine,
	formatRemediationNote,
	gateEditInstruction,
	governanceFieldsFromStatus,
	isAutoClearableBrief,
	isAutoClearableGovernanceOnly,
	journalFollowupForMutation,
	mergeGovernanceFields,
	midTaskAgentNextCall,
	STALE_AUTO_TOUCH_REASONS,
} from "../RoadmapAutoGovernance"

describe("RoadmapAutoGovernance", () => {
	it("formatRemediationNote returns empty for no steps", () => {
		assert.strictEqual(formatRemediationNote([]), "")
	})

	it("formatRemediationNote lists attempted steps", () => {
		const note = formatRemediationNote(["auto-validated ROADMAP.md schema"])
		assert.match(note, /Internal remediation/)
		assert.match(note, /auto-validated/)
	})

	it("formatBlockingGatesList includes per-gate edit instructions", () => {
		const list = formatBlockingGatesList([{ id: "schema_valid", label: "Schema", why: "invalid", fix: "old fix" }])
		assert.match(list, /Schema/)
		assert.match(list, /Edit:/)
		assert.doesNotMatch(list, /roadmap\(action='validate'\)/)
	})

	it("buildRoadmapGateStructuredEnvelope is machine-parseable", () => {
		const xml = buildRoadmapGateStructuredEnvelope({
			remediationSteps: ["auto-validated ROADMAP.md schema"],
			blockingGates: [{ id: "checkpoint_fresh", label: "Stale", why: "old checkpoint", fix: "" }],
			autoClearableOnly: true,
		})
		assert.match(xml, /<roadmap_governance_recovery/)
		assert.match(xml, /<auto_clearable_only>true<\/auto_clearable_only>/)
		assert.match(xml, /<mid_task_note>/)
		assert.match(xml, /<gate id="checkpoint_fresh">/)
		assert.match(xml, /<remediation_attempted>/)
		assert.doesNotMatch(xml, /use_mcp/i)
	})

	it("journalFollowupForMutation avoids tool commands", () => {
		const plain = journalFollowupForMutation(false)
		assert.match(plain, /automatically/)
		assert.doesNotMatch(plain, /roadmap\(action=/)

		const bootstrap = journalFollowupForMutation(true)
		assert.match(bootstrap, /bootstrap/i)
		assert.doesNotMatch(bootstrap, /roadmap\(action=/)
	})

	it("mergeGovernanceFields spreads policy onto payloads", () => {
		const merged = mergeGovernanceFields({ workspace: "/tmp" }, { validation_pending: true })
		assert.strictEqual(merged.workspace, "/tmp")
		assert.strictEqual(merged.governance_policy, AUTO_GOVERNANCE.governancePolicy)
		assert.ok(merged.governance_mid_task)
	})

	it("midTaskAgentNextCall avoids validate loops when pending", () => {
		const call = midTaskAgentNextCall({ validationPending: true })
		assert.match(call, /attempt_completion/)
		assert.doesNotMatch(call, /roadmap\(action='validate'\)/)
	})

	it("gateEditInstruction returns gate-specific guidance", () => {
		assert.match(gateEditInstruction("checkpoint_fresh"), /section 11/i)
	})

	it("STALE_AUTO_TOUCH_REASONS covers mechanical stale cases only", () => {
		assert.ok(STALE_AUTO_TOUCH_REASONS.has("no_recent_checkpoint_date"))
		assert.ok(STALE_AUTO_TOUCH_REASONS.has("invalid_date"))
		assert.ok(!STALE_AUTO_TOUCH_REASONS.has("checkpoint_expired"))
	})

	it("isAutoClearableGovernanceOnly detects validation_pending-only blocks", () => {
		assert.strictEqual(
			isAutoClearableGovernanceOnly({
				kanbanCompleteAllowed: false,
				validationPending: true,
				schemaValid: true,
				blockingGates: [{ id: "validation_current" }],
			}),
			true,
		)
		assert.strictEqual(
			isAutoClearableGovernanceOnly({
				kanbanCompleteAllowed: false,
				validationPending: false,
				schemaValid: false,
				blockingGates: [{ id: "schema_valid" }],
			}),
			false,
		)
		assert.strictEqual(
			isAutoClearableGovernanceOnly({
				kanbanCompleteAllowed: false,
				validationPending: true,
				schemaValid: false,
				blockingGates: [{ id: "validation_current" }],
			}),
			false,
		)
	})

	it("formatKanbanGateStatusLine distinguishes auto-clearable vs hard block", () => {
		const soft = formatKanbanGateStatusLine({
			kanbanCompleteAllowed: false,
			validationPending: true,
			schemaValid: true,
			blockingGates: [{ id: "validation_current" }],
		})
		assert.ok(soft?.startsWith("ℹ️"))

		const hard = formatKanbanGateStatusLine({
			kanbanCompleteAllowed: false,
			schemaValid: false,
			blockingGates: [{ id: "schema_valid" }],
		})
		assert.ok(hard?.includes("attempt_completion blocked"))
	})

	it("AUTO_GOVERNANCE copy avoids mandating validate at completion", () => {
		for (const [key, value] of Object.entries(AUTO_GOVERNANCE)) {
			if (key === "noManualValidate" || key === "governancePolicy") continue
			assert.doesNotMatch(value, /roadmap\(action='validate'\)/)
			assert.doesNotMatch(value, /use_mcp/i)
		}
		assert.match(AUTO_GOVERNANCE.noManualValidate, /Do not call roadmap\(action='validate'\)/)
		assert.strictEqual(AUTO_GOVERNANCE.governancePolicy, AUTO_GOVERNANCE.noManualValidate)
	})

	it("isAutoClearableBrief reads brief flag or derives from gates", () => {
		assert.strictEqual(isAutoClearableBrief({ auto_clearable_governance_only: true }), true)
		assert.strictEqual(
			isAutoClearableBrief({
				kanban_complete_allowed: false,
				validation_pending: true,
				schema_valid: true,
				roadmap_gate: { blocking_gates: [{ id: "validation_current" }] },
			}),
			true,
		)
	})

	it("governanceFieldsFromStatus exposes policy and mid-task note", () => {
		const fields = governanceFieldsFromStatus({
			auto_clearable_governance_only: true,
			validation_pending: true,
		})
		assert.strictEqual(fields.governance_policy, AUTO_GOVERNANCE.governancePolicy)
		assert.strictEqual(fields.auto_clearable_governance_only, true)
		assert.ok(fields.governance_mid_task)
	})
})
