import { buildAuditHookMetadata, SARIF_HOOK_EXPORT_MAX_CHARS } from "@shared/audit/auditHookMetadata"
import { enrichAuditMetadata } from "@shared/audit/taskAuditUtils"
import { expect } from "chai"

describe("auditHookMetadata", () => {
	it("includes gate readiness fields for TaskComplete hooks", () => {
		const metadata = enrichAuditMetadata({
			violations: ["missing_validation_evidence"],
			intent_coverage: 0.1,
			entropy_score: 0.9,
			gate_block_count: 1,
			gate_reason_codes: ["score_below_threshold"],
		})
		const hookMeta = buildAuditHookMetadata(metadata, { gateOptions: { scoreThreshold: 95 } })
		expect(hookMeta.gateReady).to.equal("false")
		expect(hookMeta.gateBlockCount).to.equal("1")
		expect(hookMeta.gateReasonCodes).to.contain("score_below_threshold")
		expect(hookMeta.qualityGatePassed).to.equal("false")
		expect(hookMeta.qualityGateStatus).to.equal("blocked")
	})

	it("embeds SARIF report when includeSarif is enabled", () => {
		const metadata = enrichAuditMetadata({ violations: ["result_empty"] })
		const hookMeta = buildAuditHookMetadata(metadata, { includeSarif: true, taskUri: "task://abc" })
		expect(hookMeta.sarifVersion).to.equal("2.1.0")
		expect(hookMeta.sarifReport).to.contain('"version": "2.1.0"')
		expect(Number(hookMeta.sarifResultCount)).to.be.greaterThan(0)
		expect(hookMeta.sarifReport?.length ?? 0).to.be.at.most(SARIF_HOOK_EXPORT_MAX_CHARS + 3)
	})

	it("includes suppressed violations and workspace policy in hook metadata", () => {
		const metadata = enrichAuditMetadata({
			violations: [],
			suppressed_violations: ["missing_validation_evidence"],
			workspace_gate_policy_applied: true,
		})
		const hookMeta = buildAuditHookMetadata(metadata)
		expect(hookMeta.suppressedViolationCount).to.equal("1")
		expect(hookMeta.workspacePolicyApplied).to.equal("true")
		expect(hookMeta.policySource).to.equal("workspace")
	})
})
