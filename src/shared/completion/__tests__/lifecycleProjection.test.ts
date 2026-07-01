import type { CanonicalLifecycleDecision } from "@shared/completion/canonicalLifecycleDecision"
import type { GateLifecycleDecision } from "@shared/completion/gateLifecycleDecision"
import {
	resolveLifecycleProjection,
	shouldChecklistDriveLifecycle,
	shouldContinuityMarkerDriveLabel,
	shouldRenderLegacyLabel,
	shouldRenderLegacyNextAction,
} from "@shared/completion/lifecycleProjection"
import { describe, it } from "mocha"
import should from "should"

function legacyDecision(overrides: Partial<GateLifecycleDecision> = {}): GateLifecycleDecision {
	return {
		lifecycleState: "engineering_in_progress",
		activeLane: "completion",
		reasonCode: "preflight.unknown",
		operatorMessage: "Complete engineering work, then call attempt_completion.",
		engineering: "pending",
		verification: "pending",
		documentation: "pending",
		ledger: "pending",
		finalization: "not_applicable",
		allowedActions: ["attempt_completion", "run_verification"],
		forbiddenActions: [],
		recoveryPath: [],
		receiptEligible: false,
		moreToolCallsUseful: true,
		userInputRequired: false,
		evaluatedAt: Date.now(),
		...overrides,
	}
}

const routeToFinalization: CanonicalLifecycleDecision = {
	kind: "route_to_finalization",
	nextAllowedAction: "run_finalization",
	forbiddenActions: ["attempt_completion"],
	canonicalInstruction: "Call run_finalization now. Do not call attempt_completion.",
	reason: "Engineering verified. Call run_finalization to update documentation and stamp the ledger in this session.",
}

const allowAttempt: CanonicalLifecycleDecision = {
	kind: "allow_attempt",
	nextAllowedAction: "attempt_completion",
	forbiddenActions: [],
	canonicalInstruction: "Call attempt_completion now.",
	reason: "Completion allowed — all gate stages passed.",
}

const softBlock: CanonicalLifecycleDecision = {
	kind: "soft_block",
	nextAllowedAction: "modify_workspace",
	forbiddenActions: ["attempt_completion", "run_finalization"],
	canonicalInstruction: "Do not call attempt_completion. Modify the workspace (code changes required), then retry.",
	reason: "Completion blocked: the workspace hasn't changed since the last gate block.",
}

const hardBlock: CanonicalLifecycleDecision = {
	kind: "hard_block",
	nextAllowedAction: "stop_and_report",
	forbiddenActions: ["attempt_completion", "run_finalization"],
	canonicalInstruction:
		"Stop calling attempt_completion. Make workspace changes for a probe attempt, or present results via act_mode_respond.",
	reason: "Maximum completion gate retries exceeded.",
}

describe("LifecycleProjection conflict resolver", () => {
	describe("canonical decision wins over legacy", () => {
		it("canonical route_to_finalization suppresses legacy 'Next: attempt_completion'", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({
					allowedActions: ["attempt_completion"],
					lifecycleState: "engineering_in_progress",
				}),
				freshness: "current",
			})

			should(projection.source).equal("canonical_spine")
			should(projection.nextAction).equal("run_finalization")
			should(projection.statusLabel).equal("Ready for finalization")
			// Must NOT contain the legacy action
			should(projection.forbiddenActions).containEql("attempt_completion")
		})

		it("canonical route_to_finalization renders 'Ready for finalization'", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision(),
				freshness: "current",
			})

			should(projection.statusLabel).equal("Ready for finalization")
			should(projection.phase).equal("completing")
		})

		it("canonical allow_attempt renders 'Ready to complete'", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: allowAttempt,
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "current",
			})

			should(projection.statusLabel).equal("Ready to complete")
			should(projection.nextAction).equal("attempt_completion")
			should(projection.phase).equal("ready_for_completion")
		})

		it("canonical soft_block renders 'Workspace changes required' and suppresses verification/finalization", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: softBlock,
				legacyDecision: legacyDecision({
					verification: "pending",
					finalization: "pending",
				}),
				freshness: "current",
			})

			should(projection.statusLabel).equal("Workspace changes required")
			should(projection.nextAction).equal("modify_workspace")
			should(projection.phase).equal("blocked")
			// Must not show verification/finalization as pending work
			should(projection.forbiddenActions).containEql("attempt_completion")
			should(projection.forbiddenActions).containEql("run_finalization")
		})

		it("canonical hard_block renders 'Blocked'", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: hardBlock,
				legacyDecision: legacyDecision({ lifecycleState: "completion_retry_locked" }),
				freshness: "current",
			})

			should(projection.statusLabel).equal("Blocked")
			should(projection.nextAction).equal("stop_and_report")
			should(projection.phase).equal("failed_with_receipt")
		})

		it("conflicting legacy and canonical states always choose canonical", () => {
			// Legacy says engineering_in_progress, canonical says route_to_finalization
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({
					lifecycleState: "engineering_in_progress",
					engineering: "pending",
					allowedActions: ["attempt_completion"],
				}),
				freshness: "current",
			})

			should(projection.source).equal("canonical_spine")
			should(projection.statusLabel).not.equal("Ready to complete")
			should(projection.statusLabel).equal("Ready for finalization")
		})

		it("advisory gate failure cannot render engineering-pending guidance", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({
					operatorMessage: "Complete engineering work, then call attempt_completion.",
					lifecycleState: "engineering_in_progress",
				}),
				freshness: "current",
			})

			should(projection.statusLabel).equal("Ready for finalization")
			should(projection.nextAction).equal("run_finalization")
			should(projection.instruction).equal(routeToFinalization.canonicalInstruction)
			should(projection.instruction).not.match(/Complete engineering work|Engineering In Progress/i)
		})
	})

	describe("legacy projection is evidence-only when canonical is absent", () => {
		it("does not derive current guidance from a legacy gate", () => {
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({ lifecycleState: "finalization_ready" }),
				freshness: "current",
			})

			should(projection.source).equal("legacy_gate")
			should(projection.statusLabel).equal("Ready to complete")
			should(projection.nextAction).be.null()
			should(projection.isLegacyActionable).be.false()
		})

		it("falls back to fallback source when no decision at all", () => {
			const projection = resolveLifecycleProjection({
				freshness: "unknown",
			})

			should(projection.source).equal("fallback")
			should(projection.statusLabel).equal("Ready to complete")
		})
	})

	describe("stale gate:preflight markers do not drive labels", () => {
		it("stale continuity marker does not render pending engineering when canonical exists", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "current",
				continuityMarker: "gate:preflight.quality:12345",
			})

			// Canonical wins — engineering_in_progress is suppressed
			should(projection.source).equal("canonical_spine")
			should(projection.statusLabel).equal("Ready for finalization")
			// Continuity marker is kept as evidence but doesn't drive the label
			should(projection.continuityMarker).equal("gate:preflight.quality:12345")
			should(projection.legacyDecision).not.be.undefined()
		})

		it("continuity marker never drives label regardless of canonical presence", () => {
			should(shouldContinuityMarkerDriveLabel()).be.false()
		})
	})

	describe("completed checklist cannot force lifecycle back", () => {
		it("checklist status never drives lifecycle phase", () => {
			should(shouldChecklistDriveLifecycle()).be.false()
		})

		it("canonical decision is not overridden by completed checklist data", () => {
			// Even if a checklist says "all passed", the canonical decision stands
			const projection = resolveLifecycleProjection({
				canonicalDecision: softBlock,
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "current",
			})

			should(projection.source).equal("canonical_spine")
			should(projection.statusLabel).equal("Workspace changes required")
		})
	})

	describe("cognitive reflection / breather nudge is not emitted", () => {
		it("resolver never produces breather or cognitive reflection output", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: softBlock,
				legacyDecision: legacyDecision(),
				freshness: "current",
			})

			// The projection should never contain breather/nudge language
			should(projection.instruction).not.match(/breather|cognitive reflection/i)
			should(projection.statusLabel).not.match(/breather|cognitive reflection/i)
		})
	})

	describe("no hardcoded next-step guidance outside canonical action contract", () => {
		it("nextAction comes from canonical nextAllowedAction, not legacy allowedActions", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				// Legacy has different allowedActions
				legacyDecision: legacyDecision({
					allowedActions: ["attempt_completion", "run_verification"],
				}),
				freshness: "current",
			})

			should(projection.nextAction).equal("run_finalization")
			should(projection.nextAction).not.equal("attempt_completion")
		})

		it("never renders legacy labels as current guidance", () => {
			should(shouldRenderLegacyLabel(true)).be.false()
			should(shouldRenderLegacyLabel(false)).be.false()
		})

		it("never renders legacy next actions as current guidance", () => {
			should(shouldRenderLegacyNextAction(true)).be.false()
			should(shouldRenderLegacyNextAction(false)).be.false()
		})
	})

	describe("normalized status vocabulary", () => {
		it("only uses canonical labels", () => {
			const validLabels = new Set([
				"Ready to complete",
				"Probe allowed",
				"Ready for finalization",
				"Workspace changes required",
				"Blocked",
				"Finalized",
				"Failed — receipt available",
			])

			const allDecisions: CanonicalLifecycleDecision[] = [
				allowAttempt,
				{ ...allowAttempt, kind: "allow_probe" as const },
				routeToFinalization,
				softBlock,
				hardBlock,
			]

			for (const dec of allDecisions) {
				const projection = resolveLifecycleProjection({
					canonicalDecision: dec,
					freshness: "current",
				})
				if (!validLabels.has(projection.statusLabel)) {
					throw new Error(`"${projection.statusLabel}" is not a canonical label`)
				}
			}
		})

		it("legacy labels like 'Engineering pending' are never emitted", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: allowAttempt,
				legacyDecision: legacyDecision({ engineering: "pending" }),
				freshness: "current",
			})

			should(projection.statusLabel).not.equal("Engineering pending")
			should(projection.statusLabel).not.equal("Verification pending")
			should(projection.statusLabel).not.equal("Documentation pending")
			should(projection.statusLabel).not.equal("Ledger pending")
			should(projection.statusLabel).not.equal("Finalization not_applicable")
		})
	})

	describe("regression hardening — completed task progress vs stale legacy", () => {
		it("completed checklist + stale legacy snapshot renders canonical status, not 'Engineering In Progress'", () => {
			// Even without a canonical decision, when checklist is complete,
			// stale legacy is evidence-only and must not show actionable status
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "stale",
				checklistComplete: true,
			})

			should(projection.statusLabel).not.equal("Engineering In Progress")
			should(projection.isLegacyActionable).be.false()
			should(projection.nextAction).be.null()
		})

		it("completed checklist suppresses legacy 'Next: attempt_completion, run_verification'", () => {
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({
					allowedActions: ["attempt_completion", "run_verification"],
				}),
				freshness: "current",
				checklistComplete: true,
			})

			// When checklist is complete, even a current legacy snapshot
			// is NOT actionable — nextAction must be null
			should(projection.isLegacyActionable).be.false()
			should(projection.nextAction).be.null()
		})

		it("stale gate:preflight.quality:* is evidence only when canonical exists", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "stale",
				continuityMarker: "gate:preflight.quality:12345",
			})

			should(projection.source).equal("canonical_spine")
			should(projection.isLegacyActionable).be.false()
			should(projection.continuityMarker).equal("gate:preflight.quality:12345")
			should(projection.nextAction).equal("run_finalization")
		})

		it("canonical decision overrides stale legacy snapshot even when legacy freshness is stale", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: allowAttempt,
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "stale",
			})

			should(projection.source).equal("canonical_spine")
			should(projection.statusLabel).equal("Ready to complete")
			should(projection.nextAction).equal("attempt_completion")
			should(projection.isLegacyActionable).be.false()
		})

		it("resolveLifecycleProjection never returns actionable legacy guidance when canonical exists", () => {
			const allCanonical: CanonicalLifecycleDecision[] = [
				allowAttempt,
				{ ...allowAttempt, kind: "allow_probe" as const },
				routeToFinalization,
				softBlock,
				hardBlock,
			]

			for (const dec of allCanonical) {
				const projection = resolveLifecycleProjection({
					canonicalDecision: dec,
					legacyDecision: legacyDecision({
						lifecycleState: "engineering_in_progress",
						allowedActions: ["attempt_completion"],
					}),
					freshness: "stale",
				})

				should(projection.source).equal("canonical_spine")
				should(projection.isLegacyActionable).be.false()
				// nextAction must come from canonical, not legacy
				should(projection.nextAction).equal(dec.nextAllowedAction === "none" ? null : dec.nextAllowedAction)
			}
		})

		it("stale legacy without canonical or checklist is evidence-only (not actionable)", () => {
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "stale",
			})

			should(projection.isLegacyActionable).be.false()
			should(projection.nextAction).be.null()
			should(projection.statusLabel).equal("Ready to complete")
		})

		it("current legacy without canonical or checklist remains evidence-only", () => {
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "current",
			})

			should(projection.isLegacyActionable).be.false()
			should(projection.nextAction).be.null()
			should(projection.instruction).not.match(/attempt_completion|run_verification/i)
		})
	})

	describe("no recovery philosophy language in output", () => {
		it("projection never contains 'Reconciliation' in any field", () => {
			const allCanonical: CanonicalLifecycleDecision[] = [
				allowAttempt,
				{ ...allowAttempt, kind: "allow_probe" as const },
				routeToFinalization,
				softBlock,
				hardBlock,
			]

			for (const dec of allCanonical) {
				const projection = resolveLifecycleProjection({
					canonicalDecision: dec,
					legacyDecision: legacyDecision(),
					freshness: "current",
				})

				should(projection.instruction).not.match(/Reconciliation/i)
				should(projection.statusLabel).not.match(/Reconciliation/i)
				should(projection.instruction).not.match(/breather/i)
				should(projection.instruction).not.match(/cognitive/i)
				should(projection.instruction).not.match(/re-orient/i)
				should(projection.instruction).not.match(/system nudge/i)
			}
		})

		it("fallback projection does not contain recovery prose", () => {
			const projection = resolveLifecycleProjection({
				legacyDecision: legacyDecision({ lifecycleState: "engineering_in_progress" }),
				freshness: "stale",
			})

			should(projection.instruction).not.match(/Reconciliation/i)
			should(projection.instruction).not.match(/breather/i)
			should(projection.instruction).not.match(/cognitive/i)
			should(projection.instruction).not.match(/re-orient/i)
		})

		it("completion guidance derives only from canonical action contract", () => {
			const projection = resolveLifecycleProjection({
				canonicalDecision: routeToFinalization,
				legacyDecision: legacyDecision({
					operatorMessage: "Some old recovery prose about reviewing notes",
					allowedActions: ["attempt_completion"],
				}),
				freshness: "current",
			})

			// Instruction must come from canonical, not legacy operatorMessage
			should(projection.instruction).equal(routeToFinalization.canonicalInstruction)
			should(projection.instruction).not.equal("Some old recovery prose about reviewing notes")
			should(projection.nextAction).equal(routeToFinalization.nextAllowedAction)
		})
	})
})
