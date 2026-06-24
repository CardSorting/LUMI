import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GovernedReceiptPanel } from "./GovernedReceiptPanel"

describe("GovernedReceiptPanel", () => {
	it("renders operator console sections", () => {
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
						},
					],
				}}
			/>,
		)

		expect(screen.getByText(/Governed operator console/i)).toBeInTheDocument()
		expect(screen.getByText(/Lane DAG/i)).toBeInTheDocument()
		expect(screen.getByText(/Resource ownership/i)).toBeInTheDocument()
		expect(screen.getByText(/Claim timeline/i)).toBeInTheDocument()
		expect(screen.getByText(/Retry history/i)).toBeInTheDocument()
		expect(screen.getAllByText(/unsafe overlap on/i).length).toBeGreaterThan(0)
		expect(screen.getByText(/completed/)).toBeInTheDocument()
	})
})
