import "should"
import { LaneDAG } from "../LaneDAG"
import { findDeadlockedCycles, type LaneDAGLike } from "../TarjanDeadlockDetector"

function makeDAG(nodes: Record<number, { state: string; dependsOn?: number[] }>): LaneDAGLike {
	return {
		getNode(index: number) {
			return nodes[index]
		},
	}
}

describe("TarjanDeadlockDetector", () => {
	describe("true dependency cycles", () => {
		it("detects a two-node dependency cycle", () => {
			// Lane 0 depends on Lane 1, Lane 1 depends on Lane 0
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
			})
			const result = findDeadlockedCycles([0, 1], dag, new Set(), 0, 2, new Set())
			result.hasDeadlock.should.be.true()
			result.cycles.length.should.be.greaterThan(0)
		})

		it("detects a three-node dependency cycle", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [2] },
				2: { state: "pending", dependsOn: [0] },
			})
			const result = findDeadlockedCycles([0, 1, 2], dag, new Set(), 0, 3, new Set())
			result.hasDeadlock.should.be.true()
		})

		it("detects a self-loop as deadlock", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [0] },
			})
			const result = findDeadlockedCycles([0], dag, new Set(), 0, 2, new Set())
			result.hasDeadlock.should.be.true()
		})
	})

	describe("timer-based escape transitions", () => {
		it("does not report deadlock when a timer resolves an internal edge", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
			})
			// Lane 0 has an active timer
			const result = findDeadlockedCycles(
				[0, 1],
				dag,
				new Set([0]),
				0,
				2,
				new Set(),
				0,
				undefined,
				undefined,
				new Map([[0, Date.now() + 60000]]),
			)
			result.hasDeadlock.should.be.false()
		})
	})

	describe("resource ownership cycles", () => {
		it("detects resource-ownership cycle when owner is blocked in the SCC", () => {
			// Lane 0 waits for resource R, which is owned by Lane 1
			// Lane 1 depends on Lane 0
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [] },
				1: { state: "pending", dependsOn: [0] },
			})
			const resourceOwnership = new Map([["R", 1]])
			const laneWaitingForResource = new Map([[0, "R"]])
			const result = findDeadlockedCycles(
				[0, 1],
				dag,
				new Set(),
				0,
				2,
				new Set(),
				0,
				resourceOwnership,
				laneWaitingForResource,
			)
			result.hasDeadlock.should.be.true()
		})

		it("does NOT declare deadlock when resource owner is running outside the SCC", () => {
			// Lane 0 waits for resource R, which is owned by running Lane 2 (outside SCC)
			// Lane 0 and Lane 1 form a dependency cycle
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
				2: { state: "running" },
			})
			const resourceOwnership = new Map([["R", 2]])
			const laneWaitingForResource = new Map([[0, "R"]])
			const result = findDeadlockedCycles(
				[0, 1],
				dag,
				new Set(),
				1,
				3,
				new Set([2]),
				0,
				resourceOwnership,
				laneWaitingForResource,
			)
			result.hasDeadlock.should.be.false()
		})

		it("does not treat an outside owner as an escape when that owner waits on the SCC", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
				2: { state: "running", dependsOn: [0] },
			})
			const result = findDeadlockedCycles(
				[0, 1],
				dag,
				new Set(),
				1,
				3,
				new Set([2]),
				0,
				new Map([["R", 2]]),
				new Map([[0, "R"]]),
			)
			result.hasDeadlock.should.be.true()
		})
	})

	describe("unrelated running lanes do not create escapes", () => {
		it("deadlocks even with an unrelated running lane that cannot resolve the cycle", () => {
			// Lanes A(0) and B(1) depend on each other. Lane C(2) is running but has no relation.
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
				2: { state: "running" },
			})
			// No resource edges connecting C to the A-B cycle
			const result = findDeadlockedCycles([0, 1], dag, new Set(), 1, 3, new Set([2]))
			result.hasDeadlock.should.be.true()
		})
	})

	describe("capacity contention vs deadlock", () => {
		it("does NOT report deadlock when capacity is exhausted but running lanes are outside the SCC", () => {
			// Lanes 0, 1, 2 are all pending, waiting for capacity
			// Lane 3 is running (holds a slot, will eventually complete)
			const dag = makeDAG({
				0: { state: "pending" },
				1: { state: "pending" },
				2: { state: "pending" },
				3: { state: "running" },
			})
			const result = findDeadlockedCycles([0, 1, 2], dag, new Set(), 1, 1, new Set([3]))
			result.hasDeadlock.should.be.false()
		})

		it("reports deadlock when all capacity holders are blocked in the SCC", () => {
			// Lanes 0 and 1 depend on each other AND exhaust capacity
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [0] },
			})
			// No running lanes at all, capacity full
			const result = findDeadlockedCycles([0, 1], dag, new Set(), 0, 0, new Set())
			result.hasDeadlock.should.be.true()
		})
	})

	describe("scheduler state version tracking", () => {
		it("includes the scheduler state version in the result", () => {
			const dag = makeDAG({
				0: { state: "pending" },
			})
			const result = findDeadlockedCycles([0], dag, new Set(), 0, 2, new Set(), 42)
			result.schedulerStateVersion.should.equal(42)
		})

		it("increments lane state versions and preserves immutable snapshots", () => {
			const dag = new LaneDAG(2, new Map([[1, [0]]]))
			const before = dag.immutableSnapshot()
			dag.markRunning(0, "agent-0")
			dag.markSealed(0)
			const after = dag.immutableSnapshot()

			before.version.should.equal(0)
			after.version.should.equal(2)
			before.nodes.get(0)?.state.should.equal("ready")
			after.nodes.get(0)?.state.should.equal("sealed")
			after.nodes.get(1)?.state.should.equal("ready")
		})
	})

	describe("no cycle scenarios", () => {
		it("returns no deadlock for a linear dependency chain", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [1] },
				1: { state: "pending", dependsOn: [2] },
				2: { state: "running" },
			})
			const result = findDeadlockedCycles([0, 1], dag, new Set(), 1, 3, new Set([2]))
			result.hasDeadlock.should.be.false()
		})

		it("returns no deadlock for independent pending lanes with capacity", () => {
			const dag = makeDAG({
				0: { state: "pending" },
				1: { state: "pending" },
			})
			const result = findDeadlockedCycles([0, 1], dag, new Set(), 0, 5, new Set())
			result.hasDeadlock.should.be.false()
		})
	})

	describe("lease expiration escape", () => {
		it("does NOT report deadlock when a resource lease is expiring", () => {
			const dag = makeDAG({
				0: { state: "pending", dependsOn: [] },
				1: { state: "pending", dependsOn: [0] },
			})
			const resourceOwnership = new Map([["R", 1]])
			const laneWaitingForResource = new Map([[0, "R"]])
			const leaseExpirations = new Map([["R", Date.now() + 30000]])

			const result = findDeadlockedCycles(
				[0, 1],
				dag,
				new Set(),
				0,
				2,
				new Set(),
				0,
				resourceOwnership,
				laneWaitingForResource,
				undefined,
				leaseExpirations,
			)
			result.hasDeadlock.should.be.false()
		})
	})
})
