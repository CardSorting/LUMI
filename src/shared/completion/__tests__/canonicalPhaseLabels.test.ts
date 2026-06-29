import { describe, it } from "mocha"
import "should"
import {
	ALL_CANONICAL_PHASES,
	ALL_GATE_LIFECYCLE_STATES,
	assertExhaustiveCanonicalPhase,
	assertExhaustiveGateLifecycleState,
	getCanonicalPhaseHeadline,
	getCanonicalPhaseSubtitle,
	getCanonicalPhaseTone,
	getGateLifecycleHeadline,
	getGateLifecycleHeadlineTone,
} from "../gateLifecycleLabels"

describe("canonical phase labels", () => {
	describe("ALL_CANONICAL_PHASES", () => {
		it("contains exactly the seven canonical phases", () => {
			ALL_CANONICAL_PHASES.should.have.length(7)
			ALL_CANONICAL_PHASES.should.containEql("evaluating")
			ALL_CANONICAL_PHASES.should.containEql("synchronizing")
			ALL_CANONICAL_PHASES.should.containEql("blocked")
			ALL_CANONICAL_PHASES.should.containEql("ready_for_completion")
			ALL_CANONICAL_PHASES.should.containEql("completing")
			ALL_CANONICAL_PHASES.should.containEql("finalized")
			ALL_CANONICAL_PHASES.should.containEql("failed_with_receipt")
		})
	})

	describe("getCanonicalPhaseHeadline", () => {
		it("returns a non-empty headline for every phase", () => {
			for (const phase of ALL_CANONICAL_PHASES) {
				getCanonicalPhaseHeadline(phase).length.should.be.greaterThan(0)
			}
		})

		it("returns calm, enterprise-grade language", () => {
			getCanonicalPhaseHeadline("evaluating").should.equal("Evaluating")
			getCanonicalPhaseHeadline("synchronizing").should.equal("Synchronizing")
			getCanonicalPhaseHeadline("blocked").should.equal("Blocked")
			getCanonicalPhaseHeadline("ready_for_completion").should.equal("Ready for Completion")
			getCanonicalPhaseHeadline("completing").should.equal("Completing")
			getCanonicalPhaseHeadline("finalized").should.equal("Finalized")
			getCanonicalPhaseHeadline("failed_with_receipt").should.equal("Failed — Receipt Available")
		})
	})

	describe("getCanonicalPhaseSubtitle", () => {
		it("returns a descriptive subtitle for every phase", () => {
			for (const phase of ALL_CANONICAL_PHASES) {
				getCanonicalPhaseSubtitle(phase).length.should.be.greaterThan(0)
			}
		})

		it("answers 'what is happening right now?' for evaluating", () => {
			getCanonicalPhaseSubtitle("evaluating").should.containEql("Assessing")
		})

		it("answers 'what is happening right now?' for synchronizing", () => {
			getCanonicalPhaseSubtitle("synchronizing").should.containEql("Reconciling")
		})

		it("answers 'what is blocking progress?' for blocked", () => {
			getCanonicalPhaseSubtitle("blocked").should.containEql("blocker")
		})

		it("answers 'can completion proceed?' for ready_for_completion", () => {
			getCanonicalPhaseSubtitle("ready_for_completion").should.containEql("eligible")
		})
	})

	describe("getCanonicalPhaseTone", () => {
		it("returns neutral for evaluating and synchronizing", () => {
			getCanonicalPhaseTone("evaluating").should.equal("neutral")
			getCanonicalPhaseTone("synchronizing").should.equal("neutral")
		})

		it("returns success for ready, completing, and finalized", () => {
			getCanonicalPhaseTone("ready_for_completion").should.equal("success")
			getCanonicalPhaseTone("completing").should.equal("success")
			getCanonicalPhaseTone("finalized").should.equal("success")
		})

		it("returns warning for blocked", () => {
			getCanonicalPhaseTone("blocked").should.equal("warning")
		})

		it("returns danger for failed_with_receipt", () => {
			getCanonicalPhaseTone("failed_with_receipt").should.equal("danger")
		})
	})

	describe("exhaustiveness", () => {
		it("defines headlines for every canonical lifecycle state", () => {
			for (const state of ALL_GATE_LIFECYCLE_STATES) {
				getGateLifecycleHeadline(state).length.should.be.greaterThan(0)
			}
		})

		it("defines tones for every canonical lifecycle state", () => {
			for (const state of ALL_GATE_LIFECYCLE_STATES) {
				const tone = getGateLifecycleHeadlineTone(state)
				;["neutral", "success", "warning", "danger"].should.containEql(tone)
			}
		})

		it("assertExhaustiveCanonicalPhase throws for unhandled phase", () => {
			should(() => assertExhaustiveCanonicalPhase("unhandled" as never)).throw(/Unhandled canonical/)
		})

		it("assertExhaustiveGateLifecycleState throws for unhandled state", () => {
			should(() => assertExhaustiveGateLifecycleState("unhandled" as never)).throw(/Unhandled gate lifecycle/)
		})
	})
})
