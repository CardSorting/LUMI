import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GovernedReceiptPanel } from "./GovernedReceiptPanel"

describe("GovernedReceiptPanel", () => {
	it("renders incident console with diagnostics", () => {
		render(
			<GovernedReceiptPanel
				receipt={{
					swarmId: "swarm-1",
					attemptId: "attempt-abc",
					parentAttemptId: "attempt-prev",
					admitted: true,
					mergePassed: false,
					sealed: false,
					laneCount: 2,
					lanesSealed: 1,
					lanesFailed: 1,
					lanesBlocked: 0,
					lanesRunning: 0,
					collisionRejections: 0,
					orphanedClaims: 1,
					integrityValid: false,
					evidenceComplete: false,
					replayIntegrityValid: false,
					splitBrainDetected: true,
					governedArtifactPath: "subagent_executions/swarm-1.governed.json",
					replayArtifactPath: "subagent_executions/swarm-1.json",
					replayChecksum: "abcd1234efgh5678",
					violations: ["unsafe overlap on 'src/a.ts': a, b"],
					advisoryWarnings: ["missing transcript pointer: swarm-lane:swarm-1:1"],
					retryDisposition: "retry_after_recovery",
					claimTimeline: [
						{ label: "admitted", event: "admitted", timestamp: Date.now(), status: "ok" },
						{
							label: "acquired",
							event: "acquired",
							timestamp: Date.now(),
							laneId: "swarm-lane:swarm-1:0",
							claimId: "claim-uuid-1",
							status: "ok",
						},
					],
					laneStates: [
						{
							index: 0,
							laneId: "swarm-lane:swarm-1:0",
							status: "completed",
							dagState: "sealed",
							claimId: "claim-uuid-1",
							evidenceCount: 2,
						},
						{ index: 1, laneId: "swarm-lane:swarm-1:1", status: "failed", dagState: "failed" },
					],
					laneDag: [
						{ index: 0, laneId: "swarm-lane:swarm-1:0", dependsOn: [], state: "sealed", agentId: "a" },
						{ index: 1, laneId: "swarm-lane:swarm-1:1", dependsOn: [0], state: "failed", agentId: "b" },
					],
					resourceOwners: [
						{
							resourceKey: "governed-lane:swarm-1:0",
							ownerId: "a",
							laneId: "swarm-lane:swarm-1:0",
							claimId: "claim-uuid-1",
							fencingToken: 1,
							lockBackends: {
								inProcess: true,
								swarmMutex: false,
								roadmapLease: false,
								fileLock: true,
								broccoliFence: true,
							},
							status: "released",
						},
					],
					retryHistory: [
						{ attemptId: "attempt-prev", sealed: true, mergePassed: true, timestamp: Date.now() - 1000 },
						{
							attemptId: "attempt-abc",
							parentAttemptId: "attempt-prev",
							sealed: false,
							mergePassed: false,
							timestamp: Date.now(),
							retryReason: "merge gate blocked",
						},
					],
					diagnostics: {
						incident: "merge_blocked",
						incidentSummary: "unsafe overlap on 'src/a.ts': a, b",
						retrySafe: false,
						retryUnsafeReason: "Active claims remain: governed-lane:swarm-1:1",
						authoritativeAttemptId: "attempt-prev",
						activeResourceOwners: [
							{
								resourceKey: "governed-lane:swarm-1:1",
								ownerId: "b",
								fencingToken: 2,
								status: "active",
							},
						],
						staleResourceOwners: [],
						overlappingPaths: [{ path: "src/a.ts", agents: ["a", "b"] }],
						missingTranscripts: [],
						missingToolEvidence: [],
						replayMismatchCauses: [],
					},
				}}
			/>,
		)

		expect(screen.getByText(/Incident console/i)).toBeInTheDocument()
		expect(screen.getByText(/Merge blocked/i)).toBeInTheDocument()
		expect(screen.getByText(/Retry unsafe/i)).toBeInTheDocument()
		expect(screen.getByText(/File overlaps/i)).toBeInTheDocument()
		expect(screen.getByText(/Retry lineage/i)).toBeInTheDocument()
		expect(screen.getByText(/merge gate blocked/i)).toBeInTheDocument()
		expect(screen.getByText(/retry_after_recovery/i)).toBeInTheDocument()
		expect(screen.getByText(/Audit advisories · no retry required/i)).toBeInTheDocument()
	})

	it("shows execution mode and lock-skipped lanes without missing-lock noise", () => {
		render(
			<GovernedReceiptPanel
				receipt={{
					swarmId: "swarm-1",
					attemptId: "attempt-read",
					admitted: true,
					mergePassed: true,
					sealed: true,
					laneCount: 2,
					lanesSealed: 2,
					lanesFailed: 0,
					lanesBlocked: 0,
					lanesRunning: 0,
					collisionRejections: 0,
					orphanedClaims: 0,
					integrityValid: true,
					evidenceComplete: true,
					replayIntegrityValid: true,
					splitBrainDetected: false,
					governedArtifactPath: "subagent_executions/swarm-1.governed.json",
					replayArtifactPath: "subagent_executions/swarm-1.json",
					violations: [],
					claimTimeline: [],
					laneStates: [
						{
							index: 0,
							laneId: "swarm-lane:swarm-1:0",
							status: "completed",
							executionMode: "read_only",
							lockRequired: false,
							reasonLockSkipped: "read-only lane; no mutation intent",
							readSet: ["src/a.ts"],
							evidenceCount: 1,
						},
						{
							index: 1,
							laneId: "swarm-lane:swarm-1:1",
							status: "completed",
							executionMode: "mutation",
							lockRequired: true,
							reasonLockAcquired: "mutation lane with write set",
							writeSet: ["src/b.ts"],
							claimId: "claim-mut-1",
							evidenceCount: 2,
						},
					],
					laneDag: [],
					resourceOwners: [],
					retryHistory: [],
				}}
			/>,
		)

		expect(screen.getByText(/read_only/)).toBeInTheDocument()
		expect(screen.getByText(/lock skipped/i)).toBeInTheDocument()
		expect(screen.getByText(/read:1/)).toBeInTheDocument()
		expect(screen.getByText(/mutation/)).toBeInTheDocument()
		expect(screen.getByText(/lock required/i)).toBeInTheDocument()
		expect(screen.getByText(/write:1/)).toBeInTheDocument()
		expect(screen.queryByText(/missing lock/i)).not.toBeInTheDocument()
	})

	it("shows roadmap ownership and completion advisory in operator console", () => {
		render(
			<GovernedReceiptPanel
				receipt={{
					swarmId: "swarm-1",
					attemptId: "attempt-rm",
					admitted: true,
					mergePassed: false,
					sealed: false,
					laneCount: 1,
					lanesSealed: 0,
					lanesFailed: 0,
					lanesBlocked: 0,
					lanesRunning: 1,
					collisionRejections: 0,
					orphanedClaims: 0,
					integrityValid: false,
					evidenceComplete: false,
					replayIntegrityValid: false,
					splitBrainDetected: false,
					governedArtifactPath: "subagent_executions/swarm-1.governed.json",
					replayArtifactPath: "subagent_executions/swarm-1.json",
					violations: ["unsafe roadmap mutation overlap"],
					claimTimeline: [],
					laneStates: [
						{
							index: 0,
							laneId: "swarm-lane:swarm-1:0",
							status: "running",
							executionMode: "mutation",
							lockRequired: true,
							roadmapReadSet: ["roadmap:workspace"],
							roadmapWriteSet: ["roadmap:item:TASK-1"],
							roadmapMutationLockRequired: true,
							roadmapItemOwner: "agent-a",
							reasonRoadmapLockAcquired: "roadmap mutation requires serialized ownership",
							evidenceCount: 1,
						},
					],
					laneDag: [],
					resourceOwners: [
						{
							resourceKey: "roadmap:item:TASK-1",
							ownerId: "agent-a",
							fencingToken: 2,
							status: "active",
						},
					],
					retryHistory: [],
					roadmapLinkage: {
						roadmapEnabled: true,
						orchestrationLeaseTaskIds: [],
						laneRoadmapItems: [],
						completionOutcome: { policy: "advisory_only", status: "advisory_only", reason: "default_advisory_only" },
					},
					diagnostics: {
						incident: "merge_blocked",
						incidentSummary: "unsafe roadmap mutation overlap",
						retrySafe: false,
						activeResourceOwners: [],
						staleResourceOwners: [],
						overlappingPaths: [],
						overlappingRoadmapResources: [{ resource: "roadmap:item:TASK-1", agents: ["a", "b"] }],
						blockedRoadmapWriters: ["a", "b"],
						roadmapCompletionAdvisory: "default_advisory_only",
						missingTranscripts: [],
						missingToolEvidence: [],
						replayMismatchCauses: [],
					},
				}}
			/>,
		)

		expect(screen.getByText(/Roadmap overlaps/i)).toBeInTheDocument()
		expect(screen.getByText(/Blocked roadmap writers/i)).toBeInTheDocument()
		expect(screen.getByText(/rm-read:1/)).toBeInTheDocument()
		expect(screen.getByText(/rm-write:1/)).toBeInTheDocument()
		expect(screen.getByText(/roadmap lock/i)).toBeInTheDocument()
		expect(screen.getByText(/advisory only/i)).toBeInTheDocument()
	})

	it("shows accepted and rejected patch projection state in operator console", () => {
		render(
			<GovernedReceiptPanel
				receipt={{
					swarmId: "swarm-1",
					attemptId: "attempt-proj",
					admitted: true,
					mergePassed: true,
					sealed: true,
					laneCount: 2,
					lanesSealed: 2,
					lanesFailed: 0,
					lanesBlocked: 0,
					lanesRunning: 0,
					collisionRejections: 0,
					orphanedClaims: 0,
					integrityValid: true,
					evidenceComplete: true,
					replayIntegrityValid: true,
					splitBrainDetected: false,
					governedArtifactPath: "subagent_executions/swarm-1.governed.json",
					replayArtifactPath: "subagent_executions/swarm-1.json",
					violations: [],
					claimTimeline: [],
					laneStates: [
						{
							index: 0,
							laneId: "swarm-lane:swarm-1:0",
							status: "sealed",
							executionMode: "mutation",
							lockRequired: true,
							evidenceCount: 2,
							agentRoadmapId: "arm-lane-0",
							localRoadmapEvents: [{ type: "progress_note", timestamp: 1, payload: "working" }],
							proposedWorkspacePatch: [
								{
									patchId: "patch-accepted",
									agentRoadmapId: "arm-lane-0",
									laneId: "swarm-lane:swarm-1:0",
									agentId: "agent-a",
									type: "attach_evidence",
									itemId: "TASK-1",
									baseWorkspaceSnapshotId: "rm-snap-base",
									evidencePointer: "evidence/a.md",
									rationale: "tests pass",
									expectedTransition: { to: "evidence_attached" },
									conflictPolicy: "rebase_if_safe",
								},
							],
						},
						{
							index: 1,
							laneId: "swarm-lane:swarm-1:1",
							status: "sealed",
							executionMode: "mutation",
							lockRequired: true,
							evidenceCount: 1,
							agentRoadmapId: "arm-lane-1",
							proposedWorkspacePatch: [
								{
									patchId: "patch-rejected",
									agentRoadmapId: "arm-lane-1",
									laneId: "swarm-lane:swarm-1:1",
									agentId: "agent-b",
									type: "mark_complete",
									itemId: "TASK-2",
									baseWorkspaceSnapshotId: "rm-snap-stale",
									rationale: "done",
									expectedTransition: { to: "complete" },
									conflictPolicy: "fail_on_conflict",
								},
							],
						},
					],
					laneDag: [],
					resourceOwners: [],
					retryHistory: [],
					roadmapLinkage: {
						roadmapEnabled: true,
						orchestrationLeaseTaskIds: [],
						laneRoadmapItems: [],
						swarmRoadmapPlan: {
							swarmRoadmapId: "swarm-plan-1",
							roadmapSnapshotId: "rm-snap-current",
							swarmId: "swarm-1",
							laneItemIds: [
								{ index: 0, laneId: "swarm-lane:swarm-1:0", roadmapItemId: "TASK-1" },
								{ index: 1, laneId: "swarm-lane:swarm-1:1", roadmapItemId: "TASK-2" },
							],
						},
						agentProjections: [
							{
								agentRoadmapId: "arm-lane-0",
								roadmapSnapshotId: "rm-snap-base",
								swarmRoadmapId: "swarm-plan-1",
								laneId: "swarm-lane:swarm-1:0",
								agentId: "agent-a",
								index: 0,
								plane: "agent",
								projectedItems: ["TASK-1"],
								dependsOn: [],
								executionMode: "mutation",
							},
							{
								agentRoadmapId: "arm-lane-1",
								roadmapSnapshotId: "rm-snap-stale",
								swarmRoadmapId: "swarm-plan-1",
								laneId: "swarm-lane:swarm-1:1",
								agentId: "agent-b",
								index: 1,
								plane: "agent",
								projectedItems: ["TASK-2"],
								dependsOn: [],
								executionMode: "mutation",
							},
						],
						patchReconciliation: {
							passed: false,
							violations: ["stale snapshot for mark_complete"],
							acceptedPatches: [
								{
									patchId: "patch-accepted",
									agentRoadmapId: "arm-lane-0",
									laneId: "swarm-lane:swarm-1:0",
									agentId: "agent-a",
									type: "attach_evidence",
									itemId: "TASK-1",
									baseWorkspaceSnapshotId: "rm-snap-current",
									evidencePointer: "evidence/a.md",
									rationale: "tests pass",
									expectedTransition: { to: "evidence_attached" },
									conflictPolicy: "rebase_if_safe",
								},
							],
							rejectedPatches: [
								{
									patch: {
										patchId: "patch-rejected",
										agentRoadmapId: "arm-lane-1",
										laneId: "swarm-lane:swarm-1:1",
										agentId: "agent-b",
										type: "mark_complete",
										itemId: "TASK-2",
										baseWorkspaceSnapshotId: "rm-snap-stale",
										rationale: "done",
										expectedTransition: { to: "complete" },
										conflictPolicy: "fail_on_conflict",
									},
									reason: "missing evidence pointer for mark_complete",
								},
							],
							staleProjections: ["arm-lane-1"],
							rebaseResults: [
								{
									patchId: "patch-accepted",
									agentRoadmapId: "arm-lane-0",
									outcome: "rebased",
									fromSnapshotId: "rm-snap-base",
									toSnapshotId: "rm-snap-current",
								},
								{
									patchId: "patch-rejected",
									agentRoadmapId: "arm-lane-1",
									outcome: "stale_conflict",
									fromSnapshotId: "rm-snap-stale",
									reason: "mark_complete on stale snapshot",
								},
							],
							commitStatus: "blocked",
							workspaceSnapshotId: "rm-snap-base",
							currentWorkspaceSnapshotId: "rm-snap-current",
						},
						workspaceCommit: {
							committed: false,
							commitStatus: "blocked",
							appliedPatchIds: [],
							blockReason: "roadmap patch reconciliation failed",
						},
					},
					diagnostics: {
						incident: "merge_blocked",
						incidentSummary: "patch reconciliation blocked commit",
						retrySafe: false,
						activeResourceOwners: [],
						staleResourceOwners: [],
						overlappingPaths: [],
						overlappingRoadmapResources: [],
						blockedRoadmapWriters: [],
						missingTranscripts: [],
						missingToolEvidence: [],
						replayMismatchCauses: [],
						workspaceRoadmapSnapshotId: "rm-snap-current",
						roadmapCommitStatus: "blocked",
						staleProjectionWarnings: ["arm-lane-1 projection stale vs workspace"],
						rejectedPatchReasons: ["patch-rejected: missing evidence pointer for mark_complete"],
					},
				}}
			/>,
		)

		expect(screen.getByText(/accepted patches: 1/i)).toBeInTheDocument()
		expect(screen.getByText(/rejected patches: 1/i)).toBeInTheDocument()
		expect(screen.getByText(/rebase patch-ac/i)).toBeInTheDocument()
		expect(screen.getByText(/stale_conflict/i)).toBeInTheDocument()
		expect(screen.getByText(/Rejected patch reasons/i)).toBeInTheDocument()
		expect(screen.getByText(/missing evidence pointer for mark_complete/i)).toBeInTheDocument()
		expect(screen.getByText(/commit: blocked/i)).toBeInTheDocument()
		expect(screen.getByText(/workspace snap: rm-snap-current/i)).toBeInTheDocument()
		expect(screen.getByText(/agent projections: 2/i)).toBeInTheDocument()
		expect(screen.getAllByText(/patches:1/i)).toHaveLength(2)
	})
})
