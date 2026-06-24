import type { LaneDAGState } from "@shared/subagent/governedExecution"

export interface LaneDAGNode {
	index: number
	laneId: string
	dependsOn: number[]
	state: LaneDAGState
	agentId?: string
	error?: string
}

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

	markRunning(index: number, agentId: string): void {
		const node = this.nodes.get(index)
		if (!node || node.state !== "ready") {
			throw new Error(`Lane ${index} is not ready (state=${node?.state})`)
		}
		node.state = "running"
		node.agentId = agentId
	}

	markSealed(index: number): void {
		const node = this.nodes.get(index)
		if (!node) {
			return
		}
		node.state = "sealed"
		this.recomputeBlocked()
	}

	markFailed(index: number, error?: string): void {
		const node = this.nodes.get(index)
		if (!node) {
			return
		}
		node.state = "failed"
		node.error = error
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
}
