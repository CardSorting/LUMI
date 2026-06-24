import { strict as assert } from "node:assert"
import type { LaneExecutionReceipt } from "@shared/subagent/governedExecution"
import type { ProposedWorkspacePatch } from "@shared/subagent/roadmapProjection"
import { afterEach, describe, it } from "mocha"
import { InMemoryLockAuthority } from "@/core/governance/LockAuthority"
import type { RoadmapRuntimeState } from "@/services/roadmap/RoadmapService"
import {
	agentAttemptedDirectWorkspaceRoadmapMutation,
	buildAgentRoadmapProjection,
	computeRoadmapSnapshotId,
	defaultExpectedTransition,
	parseLocalRoadmapEventsFromPrompt,
	parseProposedPatchesFromPrompt,
} from "../AgentRoadmapProjection"
import { GovernedSwarmCoordinator } from "../GovernedSwarmCoordinator"
import { classifyLockNecessity, resolveLaneLockIntent } from "../LockNecessity"
import { auditDirectWorkspaceRoadmapMutation, runRoadmapPatchReconciliation } from "../RoadmapPatchReconciler"
import { commitWorkspaceRoadmapPatches } from "../RoadmapWorkspaceCommit"

function minimalRuntimeState(): RoadmapRuntimeState {
	return {
		version: 1,
		project_identity: { core_purpose: "", anti_goals: "", raw_body: "" },
		health: { status: "ok", summary: "", raw_body: "" },
		strategic_narrative: "",
		tasks: {
			now: { intro: "", items: [{ id: "TASK-1", title: "Task one", body: "" }] },
			next: { intro: "", items: [] },
			later: { intro: "", items: [] },
		},
		discovery: "",
		maintenance_gravity: "",
		code_soup_audit: { risk_level: "low", raw_body: "" },
		decision_log: "",
		checkpoint: { date: "", summary: "", raw_body: "" },
		archive: "",
		version_vectors: { workspace: 1 },
	}
}

function laneReceipt(overrides: Partial<LaneExecutionReceipt>): LaneExecutionReceipt {
	return {
		laneId: "l0",
		agentId: "a",
		index: 0,
		status: "completed",
		claimReleased: true,
		evidenceCount: 1,
		touchedFiles: [],
		sealedAt: Date.now(),
		executionMode: "read_only",
		lockRequired: false,
		...overrides,
	} as LaneExecutionReceipt
}

function patch(overrides: Partial<ProposedWorkspacePatch>): ProposedWorkspacePatch {
	return {
		patchId: `p-${Math.random()}`,
		agentRoadmapId: "agent-rm:s:0",
		laneId: "l0",
		agentId: "a",
		type: "mark_complete",
		itemId: "TASK-1",
		baseWorkspaceSnapshotId: "rm-snap-base",
		baseSnapshotId: "rm-snap-base",
		evidencePointer: "subagent_executions/t.jsonl",
		confidence: 0.9,
		rationale: "verified implementation with passing evidence",
		expectedTransition: defaultExpectedTransition("mark_complete"),
		conflictPolicy: "rebase_if_safe",
		...overrides,
	}
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

describe("governed execution roadmap projection", () => {
	afterEach(() => {
		InMemoryLockAuthority.reset()
	})

	describe("agent roadmap projection", () => {
		it("creates lane-scoped projection from workspace snapshot", () => {
			const state = minimalRuntimeState()
			const snapshotId = computeRoadmapSnapshotId(state)
			const projection = buildAgentRoadmapProjection({
				swarmId: "swarm-p",
				laneId: "swarm-lane:swarm-p:0",
				agentId: "agent-a",
				index: 0,
				workspaceSnapshotId: snapshotId,
				swarmRoadmapId: "swarm-rm:swarm-p",
				intent: { executionMode: "read_only", roadmapItemId: "TASK-1" },
				workspaceState: state,
			})
			assert.equal(projection.plane, "agent")
			assert.ok(projection.projectedItems.includes("TASK-1"))
			assert.equal(projection.roadmapSnapshotId, snapshotId)
		})

		it("two agents locally mutate private roadmaps without collision", () => {
			const eventsA = parseLocalRoadmapEventsFromPrompt("[local_roadmap:progress_note:TASK-1:done step 1]")
			const eventsB = parseLocalRoadmapEventsFromPrompt("[local_roadmap:todo_state:TASK-1:in_progress]")
			assert.equal(eventsA.length, 1)
			assert.equal(eventsB.length, 1)
			const reconciliation = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({ laneId: "l0", agentId: "a", index: 0, localRoadmapEvents: eventsA }),
					laneReceipt({ laneId: "l1", agentId: "b", index: 1, localRoadmapEvents: eventsB }),
				],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [], state: "sealed" },
				],
				mergePassed: true,
			})
			assert.equal(reconciliation.passed, true)
			assert.equal(reconciliation.violations.length, 0)
		})
	})

	describe("patch reconciliation", () => {
		const snap = "rm-snap-base"

		it("two agents propose compatible workspace patches", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						laneId: "l0",
						agentId: "a",
						index: 0,
						proposedWorkspacePatch: [
							patch({
								laneId: "l0",
								agentId: "a",
								type: "attach_evidence",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: snap,
							}),
						],
					}),
					laneReceipt({
						laneId: "l1",
						agentId: "b",
						index: 1,
						proposedWorkspacePatch: [
							patch({
								laneId: "l1",
								agentId: "b",
								type: "mark_complete",
								itemId: "TASK-2",
								baseWorkspaceSnapshotId: snap,
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

		it("conflicting patches fail reconciliation", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						laneId: "l0",
						agentId: "a",
						index: 0,
						proposedWorkspacePatch: [
							patch({
								laneId: "l0",
								agentId: "a",
								type: "mark_complete",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: snap,
							}),
						],
					}),
					laneReceipt({
						laneId: "l1",
						agentId: "b",
						index: 1,
						proposedWorkspacePatch: [
							patch({
								laneId: "l1",
								agentId: "b",
								type: "move_lane",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: snap,
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
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.equal(result.passed, false)
			assert.ok(result.violations.some((v) => v.includes("conflicting workspace patches")))
		})

		it("stale roadmap snapshot blocks commit", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						agentRoadmapId: "agent-rm:s:0",
						proposedWorkspacePatch: [patch({ baseWorkspaceSnapshotId: "rm-snap-stale", itemId: "TASK-1" })],
					}),
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: "rm-snap-newer",
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.ok(result.rejectedPatches.some((r) => r.reason.includes("stale")))
		})

		it("failed lane cannot mark roadmap complete", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						status: "failed",
						proposedWorkspacePatch: [patch({ type: "mark_complete", baseWorkspaceSnapshotId: snap })],
					}),
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "failed" }],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: snap,
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.ok(result.rejectedPatches.some((r) => r.reason.includes("failed lane cannot mark")))
		})

		it("dependency-ordered patches pass", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						laneId: "l0",
						agentId: "a",
						index: 0,
						proposedWorkspacePatch: [
							patch({
								laneId: "l0",
								agentId: "a",
								type: "mark_complete",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: snap,
							}),
						],
					}),
					laneReceipt({
						laneId: "l1",
						agentId: "b",
						index: 1,
						proposedWorkspacePatch: [
							patch({
								laneId: "l1",
								agentId: "b",
								type: "mark_complete",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: snap,
							}),
						],
					}),
				],
				laneDag: [
					{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" },
					{ index: 1, laneId: "l1", dependsOn: [0], state: "sealed" },
				],
				workspaceSnapshotIdAtAdmit: snap,
				currentWorkspaceSnapshotId: snap,
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})
			assert.equal(result.passed, true)
		})

		it("advisory patch remains advisory", () => {
			const result = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						proposedWorkspacePatch: [
							patch({
								type: "advisory_only",
								advisory: true,
								baseWorkspaceSnapshotId: snap,
								agentRoadmapId: "agent-rm:s:0",
							}),
						],
					}),
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				mergePassed: true,
			})
			assert.equal(result.commitStatus, "advisory_only")
			assert.equal(result.acceptedPatches[0].advisory, true)
		})
	})

	describe("workspace mutation boundaries", () => {
		it("agent cannot directly mutate workspace roadmap", () => {
			const violations = auditDirectWorkspaceRoadmapMutation([laneReceipt({ directWorkspaceRoadmapMutation: true })])
			assert.equal(violations.length, 1)
			assert.ok(violations[0].includes("cannot directly mutate workspace roadmap"))
		})

		it("direct tool write without proposed patch is flagged", () => {
			const flagged = agentAttemptedDirectWorkspaceRoadmapMutation({
				toolSteps: [{ toolName: "roadmap", params: { action: "update" } }],
				proposedPatches: [],
			})
			assert.equal(flagged, true)
		})

		it("proposed patches from prompt are collected", () => {
			const patches = parseProposedPatchesFromPrompt("[propose_patch:mark_complete:TASK-1]", {
				...projection,
				agentRoadmapId: "agent-rm:s:0",
				roadmapSnapshotId: "rm-snap-x",
				laneId: "l0",
				agentId: "a",
				index: 0,
				swarmRoadmapId: "swarm-rm:s",
				plane: "agent",
				projectedItems: ["TASK-1"],
				dependsOn: [],
				executionMode: "read_only",
			})
			assert.equal(patches.length, 1)
			assert.equal(patches[0].type, "mark_complete")
			assert.ok(patches[0].agentRoadmapId)
		})

		it("completion update uses projection model not workspace lock", () => {
			const intent = resolveLaneLockIntent("[execution_mode:read_only] [mutates_roadmap_completion]", {}, 0)
			const result = classifyLockNecessity(intent)
			assert.equal(result.roadmapMutationLockRequired, false)
			assert.equal(result.lockRequired, false)
		})
	})

	describe("coordinator commit", () => {
		it("coordinator commits accepted patch under one workspace roadmap lock", async () => {
			const authority = new InMemoryLockAuthority()
			const reconciliation = runRoadmapPatchReconciliation({
				laneReceipts: [
					laneReceipt({
						proposedWorkspacePatch: [
							patch({
								patchId: "commit-1",
								type: "add_blocked_reason",
								itemId: "TASK-1",
								baseWorkspaceSnapshotId: "rm-snap-c",
								rationale: "waiting on review from coordinator",
								payload: { detail: "waiting on review" },
							}),
						],
					}),
				],
				laneDag: [{ index: 0, laneId: "l0", dependsOn: [], state: "sealed" }],
				workspaceSnapshotIdAtAdmit: "rm-snap-c",
				currentWorkspaceSnapshotId: "rm-snap-c",
				mergePassed: true,
				knownItemIds: new Set(["TASK-1"]),
			})

			const commit = await commitWorkspaceRoadmapPatches({
				workspace: "/tmp",
				coordinatorId: "coordinator",
				reconciliation,
				lockAuthority: authority,
				roadmapEnabled: false,
				mergePassed: true,
				integrityValid: true,
				sealed: true,
				completionPolicy: "advisory_only",
			})
			assert.equal(commit.commitStatus, "skipped")
			assert.equal(commit.committed, false)
			assert.ok(commit.blockReason?.includes("roadmap disabled"))
		})

		it("acquireLane attaches agent roadmap projection when roadmap enabled", async () => {
			const coordinator = new GovernedSwarmCoordinator("/tmp", true, 1, undefined, new InMemoryLockAuthority())
			await coordinator.admitSwarm("parent")
			const result = await coordinator.acquireLane("swarm-p", "agent-a", 0, {
				executionMode: "read_only",
				roadmapItemId: "TASK-1",
			})
			assert.equal(result.success, true)
			assert.ok(result.claim?.agentRoadmap?.agentRoadmapId)
			assert.ok(result.claim?.agentRoadmap?.projectedItems.length)
		})
	})
})
