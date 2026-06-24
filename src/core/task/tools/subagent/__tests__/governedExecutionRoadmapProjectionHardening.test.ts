import { strict as assert } from "node:assert"
import type { LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import type { ProposedWorkspacePatch } from "@shared/subagent/roadmapProjection"
import { afterEach, describe, it } from "mocha"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import {
	collectRoadmapLaneArtifacts,
	defaultExpectedTransition,
	parseLocalRoadmapEventsFromPrompt,
} from "../AgentRoadmapProjection"
import { containLocalRoadmapEvents } from "../RoadmapLocalEventContainment"
import { validatePatchQuality } from "../RoadmapPatchQualityGate"
import { attemptPatchRebase, runRoadmapPatchReconciliation } from "../RoadmapPatchReconciler"
import { canCoordinatorCommitWorkspaceRoadmap, commitWorkspaceRoadmapPatches } from "../RoadmapWorkspaceCommit"

function laneReceipt(overrides: Partial<LaneExecutionReceipt>): LaneExecutionReceipt {
	return {
		laneId: "l0",
		agentId: "a",
		index: 0,
		status: "completed",
		claimReleased: true,
		evidenceCount: 1,
		toolStepCount: 1,
		transcriptArtifactPath: "subagent_executions/t.jsonl",
		touchedFiles: [],
		sealedAt: Date.now(),
		executionMode: "read_only",
		lockRequired: false,
		projectedItems: ["TASK-1"],
		agentRoadmapId: "agent-rm:s:0",
		...overrides,
	} as LaneExecutionReceipt
}

function validPatch(overrides: Partial<ProposedWorkspacePatch>): ProposedWorkspacePatch {
	const base = {
		patchId: "patch-1",
		agentRoadmapId: "agent-rm:s:0",
		laneId: "l0",
		agentId: "a",
		type: "mark_complete" as const,
		itemId: "TASK-1",
		baseWorkspaceSnapshotId: "rm-snap-base",
		baseSnapshotId: "rm-snap-base",
		evidencePointer: "subagent_executions/t.jsonl",
		confidence: 0.9,
		rationale: "verified implementation with tests passing",
		expectedTransition: defaultExpectedTransition("mark_complete"),
		conflictPolicy: "rebase_if_safe" as const,
	}
	return { ...base, ...overrides }
}

const projection = {
	agentRoadmapId: "agent-rm:s:0",
	roadmapSnapshotId: "rm-snap-base",
	swarmRoadmapId: "swarm-rm:s",
	laneId: "l0",
	agentId: "a",
	index: 0,
	plane: "agent" as const,
	projectedItems: ["TASK-1"],
	dependsOn: [],
	executionMode: "read_only" as const,
}

describe("governed execution roadmap projection hardening", () => {
	afterEach(() => {
		InMemoryLockAuthority.reset()
	})

	describe("local event containment", () => {
		it("local roadmap events do not mutate workspace", () => {
			const events = parseLocalRoadmapEventsFromPrompt("[local_roadmap:progress_note:TASK-1:implemented parser]")
			const result = containLocalRoadmapEvents(events, projection)
			assert.equal(result.containedEvents[0].containment, "accepted")
			assert.equal(result.convertedPatches.length, 0)
			assert.equal(result.rejectedLocalEvents.length, 0)
		})

		it("mutation-like local event is rejected or converted to patch", () => {
			const events = parseLocalRoadmapEventsFromPrompt(
				"[local_roadmap:dependency_observation:TASK-1:update depends on TASK-0]",
			)
			const result = containLocalRoadmapEvents(events, projection, { evidencePointer: "ev-1" })
			assert.equal(result.convertedPatches.length, 1)
			assert.equal(result.convertedPatches[0].type, "update_dependency")
		})

		it("smuggled completion language in local event is rejected", () => {
			const events = parseLocalRoadmapEventsFromPrompt("[local_roadmap:todo_state:TASK-1:mark complete now]")
			const result = containLocalRoadmapEvents(events, projection)
			assert.ok(result.rejectedLocalEvents.length > 0 || result.convertedPatches.length > 0)
		})
	})

	describe("patch quality gate", () => {
		it("missing patch evidence blocks completion", () => {
			const patch = validPatch({ evidencePointer: undefined })
			const quality = validatePatchQuality(patch, {
				knownItemIds: new Set(["TASK-1"]),
				projectedItemIds: ["TASK-1"],
				evidenceCount: 0,
			})
			assert.equal(quality.valid, false)
			assert.ok(quality.reasons.some((r) => r.includes("evidence")))
		})

		it("vague rationale is rejected", () => {
			const patch = validPatch({ rationale: "done" })
			const quality = validatePatchQuality(patch, {
				knownItemIds: new Set(["TASK-1"]),
				evidenceCount: 1,
				transcriptArtifactPath: "t.jsonl",
			})
			assert.equal(quality.valid, false)
			assert.ok(quality.reasons.some((r) => r.includes("rationale")))
		})
	})

	describe("projection rebase", () => {
		it("stale projection safe rebase passes for attach_evidence", () => {
			const patch = validPatch({
				type: "attach_evidence",
				baseWorkspaceSnapshotId: "rm-snap-old",
				conflictPolicy: "rebase_if_safe",
			})
			const rebase = attemptPatchRebase(patch, "rm-snap-old", "rm-snap-new")
			assert.equal(rebase.outcome, "rebased")
		})

		it("stale conflicting projection fails for mark_complete", () => {
			const patch = validPatch({ baseWorkspaceSnapshotId: "rm-snap-old" })
			const rebase = attemptPatchRebase(patch, "rm-snap-old", "rm-snap-new")
			assert.equal(rebase.outcome, "stale_conflict")
		})
	})

	describe("patch reconciliation", () => {
		const snap = "rm-snap-base"

		it("compatible patches merge", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						proposedWorkspacePatch: [
							validPatch({ patchId: "p1", type: "attach_evidence", agentId: "a", laneId: "l0" }),
						],
					}),
					laneReceipt({
						laneId: "l1",
						agentId: "b",
						index: 1,
						proposedWorkspacePatch: [
							validPatch({
								patchId: "p2",
								type: "attach_evidence",
								agentId: "b",
								laneId: "l1",
								itemId: "TASK-2",
							}),
						],
					}),
				],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: snap,
				mergePassed: true,
				knownItemIds: new Set(["TASK-1", "TASK-2"]),
			})
			assert.equal(result.passed, true)
			assert.equal(result.acceptedPatches.length, 2)
		})

		it("conflicting patches fail", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						proposedWorkspacePatch: [validPatch({ patchId: "p1", type: "mark_complete" })],
					}),
					laneReceipt({
						laneId: "l1",
						agentId: "b",
						index: 1,
						proposedWorkspacePatch: [validPatch({ patchId: "p2", type: "move_lane", agentId: "b", laneId: "l1" })],
					}),
				],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: snap,
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.equal(result.passed, false)
			assert.ok(result.violations.some((v) => v.includes("conflicting")))
		})

		it("records rebaseResult in reconciliation", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						proposedWorkspacePatch: [
							validPatch({
								type: "attach_evidence",
								baseWorkspaceSnapshotId: snap,
							}),
						],
					}),
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: "rm-snap-new",
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.ok(result.rebaseResults.some((r) => r.outcome === "rebased"))
		})
	})

	describe("coordinator-only commit", () => {
		it("coordinator commit requires roadmap workspace lock and gates", async () => {
			const reconciliation = runRoadmapPatchReconciliation({
				laneReceipts: [laneReceipt({ proposedWorkspacePatch: [validPatch({})] })],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				workspaceSnapshotIdAtAdmit: "rm-snap-base",
				currentWorkspaceSnapshotId: "rm-snap-base",
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})

			const blocked = canCoordinatorCommitWorkspaceRoadmap({
				mergePassed: false,
				reconciliation,
				integrityValid: true,
				sealed: true,
				completionPolicy: "advisory_only",
				roadmapEnabled: true,
			})
			assert.equal(blocked.allowed, false)

			const commit = await commitWorkspaceRoadmapPatches({
				workspace: "/tmp",
				coordinatorId: "coordinator",
				reconciliation,
				lockAuthority: new InMemoryLockAuthority(),
				roadmapEnabled: true,
				mergePassed: true,
				integrityValid: true,
				sealed: true,
				completionPolicy: "update_on_sealed_success",
			})
			assert.equal(commit.workspaceLockAcquired, true)
		})

		it("failed merge prevents roadmap commit", () => {
			const gate = canCoordinatorCommitWorkspaceRoadmap({
				mergePassed: false,
				reconciliation: {
					passed: false,
					violations: [],
					acceptedPatches: [validPatch({})],
					rejectedPatches: [],
					staleProjections: [],
					rebaseResults: [],
					commitStatus: "blocked",
				},
				integrityValid: true,
				sealed: true,
				completionPolicy: "update_on_sealed_success",
				roadmapEnabled: true,
			})
			assert.equal(gate.allowed, false)
			assert.ok(gate.reason?.includes("merge gate"))
		})
	})

	describe("lane artifact collection", () => {
		it("collects contained local events without workspace mutation", () => {
			const artifacts = collectRoadmapLaneArtifacts({
				prompt: "[local_roadmap:evidence_checklist:TASK-1:tests green]",
				projection,
				evidencePointer: "ev-1",
				evidenceCount: 2,
			})
			assert.equal(artifacts.localRoadmapEvents.length, 1)
			assert.equal(artifacts.proposedWorkspacePatch.length, 0)
		})
	})
})
