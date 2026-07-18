/** Typed, snapshot-based wait-for graph and Tarjan SCC deadlock detection. */
export type WaitEdge =
	| { kind: "lane_dependency"; from: string; to: string }
	| { kind: "resource_ownership"; from: string; to: string }
	| { kind: "owned_by"; from: string; to: string }
	| { kind: "timer"; from: string; deadline: number }
	| { kind: "capacity"; from: string; poolId: string }

export interface LaneDAGLike {
	getNode(index: number): { state: string; dependsOn?: readonly number[] } | undefined
}

export interface SchedulerSnapshot {
	readonly pendingLanes: readonly number[]
	readonly runningLaneIndices: ReadonlySet<number>
	readonly timersActive: ReadonlySet<number>
	readonly activeLaneExecutions: number
	readonly maxInFlightLanes: number
	readonly dag: LaneDAGLike
	readonly stateVersion: number
	readonly laneStateVersion?: number
	readonly observedAt: number
	readonly resourceOwnership?: ReadonlyMap<string, number>
	readonly laneWaitingForResource?: ReadonlyMap<number, string>
	readonly timerDeadlines?: ReadonlyMap<number, number>
	readonly leaseExpirations?: ReadonlyMap<string, number>
}

export interface DeadlockDetectionResult {
	hasDeadlock: boolean
	cycles: string[][]
	explanation: string
	schedulerStateVersion: number
	laneStateVersion?: number
	edges: readonly WaitEdge[]
}

type Graph = Map<string, Set<string>>

function addEdge(graph: Graph, from: string, to: string): void {
	if (!graph.has(from)) graph.set(from, new Set())
	if (!graph.has(to)) graph.set(to, new Set())
	graph.get(from)?.add(to)
}

function laneId(index: number): string {
	return `lane:${index}`
}

function resourceNode(resourceId: string): string {
	return `resource:${resourceId}`
}

function capacityNode(poolId: string): string {
	return `capacity:${poolId}`
}

function buildWaitForGraph(snapshot: SchedulerSnapshot): { graph: Graph; edges: WaitEdge[] } {
	const graph: Graph = new Map()
	const edges: WaitEdge[] = []
	const laneIndices = new Set<number>([...snapshot.pendingLanes, ...snapshot.runningLaneIndices])
	const queue = [...laneIndices]
	while (queue.length) {
		const index = queue.pop() as number
		for (const dependency of snapshot.dag.getNode(index)?.dependsOn ?? []) {
			if (!laneIndices.has(dependency)) {
				laneIndices.add(dependency)
				queue.push(dependency)
			}
		}
	}

	for (const index of laneIndices) {
		const from = laneId(index)
		if (!graph.has(from)) graph.set(from, new Set())
		const node = snapshot.dag.getNode(index)
		for (const dependency of node?.dependsOn ?? []) {
			const dependencyNode = snapshot.dag.getNode(dependency)
			if (dependencyNode?.state === "sealed") continue
			const to = laneId(dependency)
			const edge: WaitEdge = { kind: "lane_dependency", from, to }
			edges.push(edge)
			addEdge(graph, from, to)
		}

		const resourceId = snapshot.laneWaitingForResource?.get(index)
		if (resourceId) {
			const resource = resourceNode(resourceId)
			edges.push({ kind: "resource_ownership", from, to: resource })
			addEdge(graph, from, resource)
			const owner = snapshot.resourceOwnership?.get(resourceId)
			if (owner !== undefined) {
				const ownerNode = laneId(owner)
				edges.push({ kind: "owned_by", from: resource, to: ownerNode })
				addEdge(graph, resource, ownerNode)
			}
		}
	}

	if (snapshot.activeLaneExecutions >= snapshot.maxInFlightLanes && snapshot.pendingLanes.length > 0) {
		const poolId = "default"
		const pool = capacityNode(poolId)
		for (const index of snapshot.pendingLanes) {
			const from = laneId(index)
			edges.push({ kind: "capacity", from, poolId })
			addEdge(graph, from, pool)
		}
		for (const index of snapshot.runningLaneIndices) {
			const holder = laneId(index)
			edges.push({ kind: "owned_by", from: pool, to: holder })
			addEdge(graph, pool, holder)
		}
	}

	for (const index of snapshot.timersActive) {
		const deadline = snapshot.timerDeadlines?.get(index)
		if (deadline !== undefined) edges.push({ kind: "timer", from: laneId(index), deadline })
	}
	return { graph, edges }
}

function tarjan(graph: Graph): string[][] {
	let nextIndex = 0
	const indices = new Map<string, number>()
	const lowLinks = new Map<string, number>()
	const stack: string[] = []
	const onStack = new Set<string>()
	const components: string[][] = []

	const visit = (node: string): void => {
		indices.set(node, nextIndex)
		lowLinks.set(node, nextIndex)
		nextIndex++
		stack.push(node)
		onStack.add(node)

		for (const neighbor of graph.get(node) ?? []) {
			if (!indices.has(neighbor)) {
				visit(neighbor)
				lowLinks.set(node, Math.min(lowLinks.get(node) as number, lowLinks.get(neighbor) as number))
			} else if (onStack.has(neighbor)) {
				lowLinks.set(node, Math.min(lowLinks.get(node) as number, indices.get(neighbor) as number))
			}
		}

		if (lowLinks.get(node) !== indices.get(node)) return
		const component: string[] = []
		while (stack.length) {
			const member = stack.pop() as string
			onStack.delete(member)
			component.push(member)
			if (member === node) break
		}
		components.push(component)
	}

	for (const node of graph.keys()) if (!indices.has(node)) visit(node)
	return components
}

function ownerWaitsOnComponent(ownerIndex: number, component: ReadonlySet<string>, snapshot: SchedulerSnapshot): boolean {
	for (const dependency of snapshot.dag.getNode(ownerIndex)?.dependsOn ?? []) {
		if (component.has(laneId(dependency))) return true
	}
	const waitingResource = snapshot.laneWaitingForResource?.get(ownerIndex)
	if (!waitingResource) return false
	const blockingOwner = snapshot.resourceOwnership?.get(waitingResource)
	return blockingOwner !== undefined && component.has(laneId(blockingOwner))
}

function hasEscapeTransition(component: ReadonlySet<string>, edges: readonly WaitEdge[], snapshot: SchedulerSnapshot): boolean {
	for (const edge of edges) {
		if (edge.kind === "timer" && component.has(edge.from) && edge.deadline > snapshot.observedAt) return true

		if (edge.kind === "resource_ownership" && component.has(edge.from)) {
			const resourceId = edge.to.slice("resource:".length)
			const expiry = snapshot.leaseExpirations?.get(resourceId)
			if (expiry !== undefined && expiry > snapshot.observedAt) return true
			const ownerIndex = snapshot.resourceOwnership?.get(resourceId)
			if (
				ownerIndex !== undefined &&
				snapshot.runningLaneIndices.has(ownerIndex) &&
				!component.has(laneId(ownerIndex)) &&
				!ownerWaitsOnComponent(ownerIndex, component, snapshot)
			)
				return true
		}

		if (edge.kind === "capacity") {
			const pool = capacityNode(edge.poolId)
			if (!component.has(edge.from) || !component.has(pool)) continue
			for (const runningIndex of snapshot.runningLaneIndices) {
				if (!component.has(laneId(runningIndex))) return true
			}
		}
	}
	return false
}

export function detectDeadlocks(snapshot: SchedulerSnapshot): DeadlockDetectionResult {
	const { graph, edges } = buildWaitForGraph(snapshot)
	const cycles = tarjan(graph).filter((component) => {
		const cyclic = component.length > 1 || graph.get(component[0])?.has(component[0]) === true
		return cyclic && !hasEscapeTransition(new Set(component), edges, snapshot)
	})
	return {
		hasDeadlock: cycles.length > 0,
		cycles,
		explanation: cycles.length
			? `Deadlock cycles detected: ${cycles.map((cycle) => cycle.join(" -> ")).join(", ")}`
			: "No deadlock detected; every cycle has an edge-resolving escape or no cycle exists.",
		schedulerStateVersion: snapshot.stateVersion,
		laneStateVersion: snapshot.laneStateVersion,
		edges,
	}
}

/** Backward-compatible convenience API that clones all mutable scheduler collections. */
export function findDeadlockedCycles(
	pendingLanes: number[],
	dag: LaneDAGLike,
	timersActive: Set<number>,
	activeLaneExecutions: number,
	maxInFlightLanes: number,
	runningLaneIndices: Set<number>,
	schedulerStateVersion = 0,
	resourceOwnership?: Map<string, number>,
	laneWaitingForResource?: Map<number, string>,
	timerDeadlines?: Map<number, number>,
	leaseExpirations?: Map<string, number>,
): DeadlockDetectionResult {
	return detectDeadlocks({
		pendingLanes: Object.freeze([...pendingLanes]),
		runningLaneIndices: new Set(runningLaneIndices),
		timersActive: new Set(timersActive),
		activeLaneExecutions,
		maxInFlightLanes,
		dag,
		stateVersion: schedulerStateVersion,
		observedAt: Date.now(),
		resourceOwnership: resourceOwnership ? new Map(resourceOwnership) : undefined,
		laneWaitingForResource: laneWaitingForResource ? new Map(laneWaitingForResource) : undefined,
		timerDeadlines: timerDeadlines ? new Map(timerDeadlines) : undefined,
		leaseExpirations: leaseExpirations ? new Map(leaseExpirations) : undefined,
	})
}
