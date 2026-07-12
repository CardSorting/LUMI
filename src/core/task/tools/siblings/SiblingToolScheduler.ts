import type { SiblingToolDependencyNode } from "./SiblingToolDependency"

export const DEFAULT_SIBLING_TOOL_CONCURRENCY = 4

export type SiblingExecutionStatus = "succeeded" | "failed" | "cancelled" | "skipped"

export interface SiblingExecutionEnvelope<T> {
	id: string
	sequence: number
	node: SiblingToolDependencyNode
	status: SiblingExecutionStatus
	value?: T
	error?: string
	queuedAtMs: number
	startedAtMs?: number
	completedAtMs: number
}

export interface SiblingSchedulerEvent {
	type: "queued" | "started" | "completed"
	node: SiblingToolDependencyNode
	atMs: number
	status?: SiblingExecutionStatus
}

export interface SiblingToolSchedulerOptions<T> {
	concurrency?: number
	now?: () => number
	isCancelled?: () => boolean
	onEvent?: (event: SiblingSchedulerEvent) => void
	canStart?: (node: SiblingToolDependencyNode) => boolean
	classifyResult?: (value: T) => { status: "succeeded" | "failed"; error?: string }
	run: (node: SiblingToolDependencyNode, signal: AbortSignal) => Promise<T>
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Bounded task-scoped scheduler with dependency-local failure propagation. */
export class SiblingToolScheduler<T> {
	private readonly controller = new AbortController()
	private wake?: () => void

	constructor(private readonly options: SiblingToolSchedulerOptions<T>) {}

	cancel(): void {
		this.controller.abort()
		this.signalReady()
	}

	/** Wake the task-local admission loop after an external prerequisite settles. */
	signalReady(): void {
		this.wake?.()
		this.wake = undefined
	}

	async execute(nodes: SiblingToolDependencyNode[]): Promise<SiblingExecutionEnvelope<T>[]> {
		const capacity = this.options.concurrency ?? DEFAULT_SIBLING_TOOL_CONCURRENCY
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new Error(`Sibling concurrency must be a positive integer (received ${capacity}).`)
		}
		const now = this.options.now ?? (() => performance.now())
		const queuedAt = new Map<number, number>()
		for (const node of nodes) {
			const atMs = now()
			queuedAt.set(node.sequence, atMs)
			this.emit({ type: "queued", node, atMs })
		}

		const pending = new Set(nodes.map((node) => node.sequence))
		const nodesBySequence = new Map(nodes.map((node) => [node.sequence, node]))
		const running = new Map<number, Promise<void>>()
		const results = new Map<number, SiblingExecutionEnvelope<T>>()
		const notify = () => {
			this.signalReady()
		}
		const waitForWake = () => new Promise<void>((resolve) => (this.wake = resolve))

		const completeWithoutRun = (node: SiblingToolDependencyNode, status: "cancelled" | "skipped", error: string) => {
			const completedAtMs = now()
			results.set(node.sequence, {
				id: node.id,
				sequence: node.sequence,
				node,
				status,
				error,
				queuedAtMs: queuedAt.get(node.sequence) ?? completedAtMs,
				completedAtMs,
			})
			pending.delete(node.sequence)
			this.emit({ type: "completed", node, atMs: completedAtMs, status })
		}

		while (pending.size > 0 || running.size > 0) {
			if (this.options.isCancelled?.()) this.cancel()
			let madeProgress = false

			for (const sequence of [...pending]) {
				const node = nodesBySequence.get(sequence)
				if (!node) continue
				if (this.controller.signal.aborted) {
					completeWithoutRun(node, "cancelled", "Task cancelled before sibling dispatch")
					madeProgress = true
					continue
				}
				if (this.options.canStart && !this.options.canStart(node)) continue
				const dependencyResults = node.dependencyEdges.map((edge) => ({ edge, result: results.get(edge.sequence) }))
				if (
					dependencyResults.some(
						({ edge, result }) => result && edge.kind !== "conflict" && result.status !== "succeeded",
					)
				) {
					completeWithoutRun(node, "skipped", "Prerequisite sibling did not succeed")
					madeProgress = true
					continue
				}
				if (!dependencyResults.every(({ result }) => Boolean(result)) || running.size >= capacity) continue

				pending.delete(sequence)
				const startedAtMs = now()
				this.emit({ type: "started", node, atMs: startedAtMs })
				const promise = this.options
					.run(node, this.controller.signal)
					.then((value) => {
						const completedAtMs = now()
						const classification = this.options.classifyResult?.(value) ?? { status: "succeeded" as const }
						results.set(sequence, {
							id: node.id,
							sequence,
							node,
							status: classification.status,
							value,
							error: classification.error,
							queuedAtMs: queuedAt.get(sequence) ?? startedAtMs,
							startedAtMs,
							completedAtMs,
						})
						this.emit({ type: "completed", node, atMs: completedAtMs, status: classification.status })
					})
					.catch((error) => {
						const completedAtMs = now()
						const status: SiblingExecutionStatus = this.controller.signal.aborted ? "cancelled" : "failed"
						results.set(sequence, {
							id: node.id,
							sequence,
							node,
							status,
							error: errorMessage(error),
							queuedAtMs: queuedAt.get(sequence) ?? startedAtMs,
							startedAtMs,
							completedAtMs,
						})
						this.emit({ type: "completed", node, atMs: completedAtMs, status })
					})
					.finally(() => {
						running.delete(sequence)
						notify()
					})
				running.set(sequence, promise)
				madeProgress = true
			}

			if (!madeProgress && (pending.size > 0 || running.size > 0)) {
				await waitForWake()
			}
		}

		return nodes.flatMap((node) => {
			const result = results.get(node.sequence)
			return result ? [result] : []
		})
	}

	private emit(event: SiblingSchedulerEvent): void {
		try {
			this.options.onEvent?.(event)
		} catch {
			// Observability callbacks are advisory.
		}
	}
}
