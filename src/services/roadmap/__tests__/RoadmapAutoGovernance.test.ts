import * as assert from "assert"
import {
	AUTO_GOVERNANCE,
	buildRoadmapGateStructuredEnvelope,
	formatBlockingGatesList,
	formatRemediationNote,
	gateEditInstruction,
	journalFollowupForMutation,
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
		})
		assert.match(xml, /<roadmap_governance_recovery/)
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

	it("AUTO_GOVERNANCE copy avoids mandating validate at completion", () => {
		for (const [key, value] of Object.entries(AUTO_GOVERNANCE)) {
			if (key === "noManualValidate") continue
			assert.doesNotMatch(value, /roadmap\(action='validate'\)/)
			assert.doesNotMatch(value, /use_mcp/i)
		}
		assert.match(AUTO_GOVERNANCE.noManualValidate, /Do not call roadmap\(action='validate'\)/)
	})
})
