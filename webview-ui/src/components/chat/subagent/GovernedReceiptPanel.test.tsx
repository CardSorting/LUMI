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
})
