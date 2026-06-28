import type { LaneDAGNode, LaneExecutionMode } from "@shared/subagent/governedExecution"

export type { LaneDAGNode } from "@shared/subagent/governedExecution"

/**
 * Minimal lane dependency graph with ready / blocked / running / sealed / failed states.
 */
export class LaneDAG {
	private readonly nodes: Map<number, LaneDAGNode>

	constructor(laneCount: number, dependencies?: Map<number, number[]>) {
		this.nodes = new Map()
		for (let index = 0; index < laneCount; index++) {
			this.nodes.set(index, {
				index,
				laneId: `lane-${index}`,
				dependsOn: dependencies?.get(index) || [],
				state: "ready",
			})
		}
		this.recomputeBlocked()
	}

	getNode(index: number): LaneDAGNode | undefined {
		return this.nodes.get(index)
	}

	getReadyLanes(): number[] {
		return [...this.nodes.values()].filter((node) => node.state === "ready").map((node) => node.index)
	}

	/** Prefer ready lanes on the longest downstream path so scarce worker slots unblock the DAG sooner. */
	getReadyLanesByPriority(laneWeights?: Map<number, number>): number[] {
		const memo = new Map<number, number>()
		return this.getReadyLanes().sort((left, right) => {
			const priorityDelta =
				this.getLaneScheduleScore(right, memo, laneWeights) - this.getLaneScheduleScore(left, memo, laneWeights)
			return priorityDelta || left - right
		})
	}

	/** Weighted critical-path score used by the parent scheduler and priority execution pool. */
	getLaneScheduleScore(index: number, memo = new Map<number, number>(), laneWeights?: Map<number, number>): number {
		const pathWeight = this.criticalPathLength(index, memo) * (laneWeights?.get(index) ?? 1)
		const unblockBoost = 1 + this.blockedDependentCount(index) * 0.25
		return pathWeight * unblockBoost
	}

	/** Count blocked lanes waiting on this upstream node — prioritizes lanes that unblock the DAG. */
	blockedDependentCount(index: number): number {
		return [...this.nodes.values()].filter((node) => node.state === "blocked" && node.dependsOn.includes(index)).length
	}

	markRunning(index: number, agentId: string, executionMode?: LaneExecutionMode): void {
		const node = this.nodes.get(index)
		if (!node || node.state !== "ready") {
			throw new Error(`Lane ${index} is not ready (state=${node?.state})`)
		}
		node.state = "running"
		node.agentId = agentId
		if (executionMode) {
			node.executionMode = executionMode
		}
	}

	markSealed(index: number): void {
		const node = this.nodes.get(index)
		if (!node) {
			return
		}
		node.state = "sealed"
		this.recomputeBlocked()
	}

	markRetryReady(index: number): void {
		const node = this.nodes.get(index)
		if (!node || node.state !== "failed") {
			throw new Error(`Lane ${index} is not failed (state=${node?.state})`)
		}
		node.state = "ready"
		node.agentId = undefined
		node.error = undefined
		this.recomputeBlocked()
	}

	markFailed(index: number, error?: string): void {
		const node = this.nodes.get(index)
		if (!node) {
			return
		}
		node.state = "failed"
		node.error = error
		this.recomputeBlocked()
	}

	snapshot(): LaneDAGNode[] {
		return [...this.nodes.values()].map((node) => ({ ...node, dependsOn: [...node.dependsOn] }))
	}

	allSealedOrFailed(): boolean {
		return [...this.nodes.values()].every((node) => node.state === "sealed" || node.state === "failed")
	}

	private recomputeBlocked(): void {
		const sealed = new Set([...this.nodes.values()].filter((n) => n.state === "sealed").map((n) => n.index))
		for (const node of this.nodes.values()) {
			if (node.state !== "ready" && node.state !== "blocked") {
				continue
			}
			const blocked = node.dependsOn.some((dep) => !sealed.has(dep))
			node.state = blocked ? "blocked" : "ready"
		}
	}

	private criticalPathLength(index: number, memo: Map<number, number>, visiting = new Set<number>()): number {
		const cached = memo.get(index)
		if (cached !== undefined) {
			return cached
		}
		if (visiting.has(index)) {
			return 0
		}

		visiting.add(index)
		const dependents = [...this.nodes.values()].filter((node) => node.dependsOn.includes(index))
		const length = 1 + Math.max(0, ...dependents.map((node) => this.criticalPathLength(node.index, memo, visiting)))
		visiting.delete(index)
		memo.set(index, length)
		return length
	}
}
