import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	assertArchitectureFreeze,
	buildBoundedImprovementResponse,
	classifyGovernedDirective,
	GOVERNED_EXECUTION_COMPLETE_INVARIANTS,
	isArchitectureExpansionAllowed,
	routeGovernedImprovementPrompt,
} from "../GovernedExecutionDirective"
import { auditGovernedGateBehavior } from "../GovernedExecutionGateAudit"

const VAGUE_PROMPTS = [
	"double down worldclass UX for subagents",
	"deeply investigate another pass on governed execution",
	"mirror industry standards for agentic CI/CD",
	"make it more robust and improve subagent ergonomics",
	"improved subagent ergonomics with worldclass UX — dig deeper",
]

describe("governed execution anti-recursion", () => {
	describe("directive classification", () => {
		for (const prompt of VAGUE_PROMPTS) {
			it(`routes vague prompt to audit-only: "${prompt.slice(0, 40)}..."`, () => {
				const classification = classifyGovernedDirective(prompt)
				assert.equal(classification.kind, "vague_recursive_escalation")
				assert.equal(classification.allowedPass, "audit_only")
				assert.equal(classification.architectureExpansionPermitted, false)
				assert.ok(classification.matchedSignals.length > 0)
				assert.equal(routeGovernedImprovementPrompt(prompt), "audit_only")
			})
		}

		it("allows regression test requests without architecture expansion", () => {
			const classification = classifyGovernedDirective("add regression test for merge gate overlap")
			assert.equal(classification.kind, "regression_test")
			assert.equal(classification.allowedPass, "test_only")
			assert.equal(classification.architectureExpansionPermitted, false)
		})

		it("allows concrete bug fix without vague escalation", () => {
			const classification = classifyGovernedDirective(
				"fix bug: release fails on owner mismatch — failing test in LockAuthority",
			)
			assert.equal(classification.kind, "bug_fix")
			assert.equal(classification.architectureExpansionPermitted, false)
		})

		it("blocks new receipt schema without failing test evidence", () => {
			const classification = classifyGovernedDirective("add new receipt schema v4 for better ergonomics")
			assert.equal(classification.kind, "vague_recursive_escalation")
			assert.equal(classification.architectureExpansionPermitted, false)
		})

		it("permits architecture expansion only with failing test evidence", () => {
			const classification = classifyGovernedDirective(
				"add new lock authority layer — failing test proves split-brain in production",
			)
			assert.equal(classification.kind, "architecture_expansion")
			assert.equal(classification.architectureExpansionPermitted, true)
		})
	})

	describe("architecture freeze guard", () => {
		it("rejects frozen layer expansion without evidence", () => {
			assert.equal(isArchitectureExpansionAllowed("receipt_schema", {}), false)
			assert.throws(() => assertArchitectureFreeze("merge_gate", {}), /Architecture freeze/)
		})

		it("permits frozen layer expansion with failing test", () => {
			assert.equal(isArchitectureExpansionAllowed("lock_authority", { failingTest: true }), true)
		})
	})

	describe("bounded operator response", () => {
		it("refuses speculative architecture for vague prompts", () => {
			const response = buildBoundedImprovementResponse("double down worldclass UX")
			assert.equal(response.classification.kind, "vague_recursive_escalation")
			assert.equal(response.architectureFrozen, true)
			assert.ok(response.refusal?.includes("Refusing speculative architecture"))
			assert.ok(response.allowedNextActions.some((a) => a.includes("gate audit")))
			assert.equal(response.invariants.length, GOVERNED_EXECUTION_COMPLETE_INVARIANTS.length)
			assert.ok(response.invariants.every((i) => i.satisfied))
		})

		it("lists concrete failing tests when provided", () => {
			const response = buildBoundedImprovementResponse("make it more robust", {
				failingTests: ["governedExecutionReliability.test.ts"],
			})
			assert.ok(response.allowedNextActions.some((a) => a.includes("governedExecutionReliability")))
		})
	})

	describe("gate behavior audit", () => {
		it("passes false-positive and false-negative regression checks", () => {
			const report = auditGovernedGateBehavior()
			if (!report.passed) {
				const failed = report.checks.filter((c) => !c.passed)
				assert.fail(`Gate audit failures: ${failed.map((f) => `${f.name}: ${f.detail || ""}`).join("; ")}`)
			}
			assert.equal(report.passed, true)
		})
	})
})
