import {
	isTaskLifecycleEvent,
	isTaskLifecycleRecord,
	type TaskLifecycleEvent,
	type TaskLifecycleRecord,
	type TaskParentLink,
} from "@shared/lifecycle/taskLifecycleEvent"
import { getCoordinationRawDb } from "@/infrastructure/db/Config"

export interface LifecycleCommitExpectation {
	generationId?: string
	lifecycleRevision?: number
	absent?: boolean
}

export type LifecyclePersistenceCommitResult =
	| { kind: "committed"; record: TaskLifecycleRecord; event: TaskLifecycleEvent }
	| { kind: "duplicate_intent"; record: TaskLifecycleRecord; event: TaskLifecycleEvent }
	| { kind: "compare_and_swap_failed"; current?: TaskLifecycleRecord }
	| { kind: "constraint_failed"; reason: string; current?: TaskLifecycleRecord }

export interface TaskLifecyclePersistence {
	load(taskId: string): Promise<TaskLifecycleRecord | undefined>
	loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined>
	commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult>
	listAttachedChildren(parent: TaskParentLink): Promise<TaskLifecycleRecord[]>
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

function withSequence(
	record: TaskLifecycleRecord,
	event: TaskLifecycleEvent,
	sequence: number,
): { record: TaskLifecycleRecord; event: TaskLifecycleEvent } {
	const committedRecord = { ...record, monotonicSequence: sequence }
	const committedEvent = {
		...event,
		committed: { ...event.committed, monotonicSequence: sequence },
		monotonicSequence: sequence,
	}
	return { record: committedRecord, event: committedEvent }
}

function attachedParentConstraint(
	record: TaskLifecycleRecord,
	event: TaskLifecycleEvent,
	parent: TaskLifecycleRecord | undefined,
): string | undefined {
	if (record.parent?.governance !== "attached" || event.transition === "register_generation") return undefined
	if (!parent || parent.generationId !== record.parent.generationId) {
		return "The attached child targets a stale or unknown parent generation."
	}
	if (event.cause.source === "parent_lifecycle") {
		if (event.cause.originatingEventId !== parent.lastEventId) {
			return "Parent propagation must name the current committed parent lifecycle event."
		}
		if (event.transition === "request_cancellation") {
			if (parent.cancellation.status !== "requested") {
				return "Parent cancellation propagation requires a committed parent cancellation request."
			}
		} else if (event.transition === "settle_cancellation") {
			if (parent.state !== "terminal" || parent.terminalOutcome !== "cancelled") {
				return "Parent cancellation settlement requires terminal parent cancellation."
			}
		} else if (event.transition === "propagate_parent_termination") {
			if (
				parent.state !== "terminal" ||
				(parent.terminalOutcome !== "failed" && parent.terminalOutcome !== "timed_out") ||
				record.terminalOutcome !== parent.terminalOutcome
			) {
				return "Parent termination propagation must match the committed parent failure or timeout."
			}
		} else {
			return "The parent_lifecycle causal source is valid only for a typed propagation transition."
		}
	}
	if (event.transition === "propagate_parent_termination" && event.cause.source !== "parent_lifecycle") {
		return "Parent termination propagation requires the parent_lifecycle causal source."
	}
	const parentSettlement =
		event.cause.source === "parent_lifecycle" &&
		(event.transition === "propagate_parent_termination" || event.transition === "settle_cancellation")
	if (parent.state === "terminal" && !parentSettlement) {
		return "The attached child cannot transition after its parent generation terminalized."
	}
	if (
		parent.cancellation.status === "requested" &&
		event.transition !== "request_cancellation" &&
		event.transition !== "settle_cancellation"
	) {
		return "The attached child transition is fenced by parent cancellation."
	}
	return undefined
}

export class InMemoryTaskLifecyclePersistence implements TaskLifecyclePersistence {
	private readonly records = new Map<string, TaskLifecycleRecord>()
	private readonly eventsByIntent = new Map<string, TaskLifecycleEvent>()
	private sequence = 0

	async load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		const record = this.records.get(taskId)
		return record ? clone(record) : undefined
	}

	async loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		const event = [...this.eventsByIntent.values()].find((candidate) => candidate.eventId === eventId)
		return event ? clone(event) : undefined
	}

	async commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		const duplicate = this.eventsByIntent.get(event.intentId)
		if (duplicate) {
			const existingRecord = this.records.get(duplicate.taskId)
			if (!existingRecord) return { kind: "compare_and_swap_failed" }
			return { kind: "duplicate_intent", record: clone(existingRecord), event: clone(duplicate) }
		}

		const current = this.records.get(record.taskId)
		const matches =
			expectation.absent === true
				? current === undefined
				: current !== undefined &&
					current.generationId === expectation.generationId &&
					current.lifecycleRevision === expectation.lifecycleRevision
		if (!matches) {
			return { kind: "compare_and_swap_failed", current: current ? clone(current) : undefined }
		}
		if (event.transition === "register_generation" && record.parent?.governance === "attached") {
			const parent = this.records.get(record.parent.taskId)
			if (
				!parent ||
				parent.generationId !== record.parent.generationId ||
				parent.state !== "active" ||
				parent.cancellation.status === "requested"
			) {
				return {
					kind: "constraint_failed",
					reason: "An attached child requires the exact active, unfenced parent generation.",
					current: current ? clone(current) : undefined,
				}
			}
		}
		const parentConstraint = attachedParentConstraint(
			record,
			event,
			record.parent ? this.records.get(record.parent.taskId) : undefined,
		)
		if (parentConstraint) {
			return {
				kind: "constraint_failed",
				reason: parentConstraint,
				current: current ? clone(current) : undefined,
			}
		}
		if (event.transition === "settle_completion" && record.parent?.governance === "attached") {
			const parent = this.records.get(record.parent.taskId)
			if (
				!parent ||
				parent.generationId !== record.parent.generationId ||
				parent.state === "terminal" ||
				parent.cancellation.status === "requested"
			) {
				return {
					kind: "constraint_failed",
					reason: "Attached child completion is fenced by its parent lifecycle.",
					current: current ? clone(current) : undefined,
				}
			}
		}
		if (event.transition === "settle_completion" || event.transition === "replace_generation") {
			const governedGeneration =
				event.transition === "replace_generation" ? event.previous?.generationId : record.generationId
			const activeChild = [...this.records.values()].find(
				(candidate) =>
					candidate.parent?.governance === "attached" &&
					candidate.parent.taskId === record.taskId &&
					candidate.parent.generationId === governedGeneration &&
					candidate.state !== "terminal",
			)
			if (activeChild) {
				return {
					kind: "constraint_failed",
					reason: `Attached child '${activeChild.taskId}' must terminalize before parent completion or generation replacement.`,
					current: current ? clone(current) : undefined,
				}
			}
		}

		const committed = withSequence(record, event, ++this.sequence)
		this.records.set(record.taskId, clone(committed.record))
		this.eventsByIntent.set(event.intentId, clone(committed.event))
		return { kind: "committed", record: clone(committed.record), event: clone(committed.event) }
	}

	async listAttachedChildren(parent: TaskParentLink): Promise<TaskLifecycleRecord[]> {
		return [...this.records.values()]
			.filter(
				(record) =>
					record.parent?.governance === "attached" &&
					record.parent.taskId === parent.taskId &&
					record.parent.generationId === parent.generationId,
			)
			.map(clone)
	}
}

interface LifecycleRawDatabase {
	exec(sql: string): void
	prepare(sql: string): {
		get(...parameters: unknown[]): unknown
		all(...parameters: unknown[]): unknown[]
		run(...parameters: unknown[]): { changes: number }
	}
}

interface LifecycleRecordRow {
	taskId: string
	generationId: string
	lifecycleRevision: number
	recordJson: string
}

interface LifecycleEventRow {
	eventJson: string
}

function parseRecordRow(row: unknown): TaskLifecycleRecord | undefined {
	if (!row) return undefined
	const candidate = row as Partial<LifecycleRecordRow>
	if (
		typeof candidate.taskId !== "string" ||
		typeof candidate.generationId !== "string" ||
		!Number.isInteger(candidate.lifecycleRevision) ||
		typeof candidate.recordJson !== "string"
	) {
		throw new Error("Malformed task lifecycle persistence row.")
	}
	const record = JSON.parse(candidate.recordJson) as unknown
	if (
		!isTaskLifecycleRecord(record) ||
		record.taskId !== candidate.taskId ||
		record.generationId !== candidate.generationId ||
		record.lifecycleRevision !== candidate.lifecycleRevision
	) {
		throw new Error("Task lifecycle persistence row does not match its record payload.")
	}
	return record
}

export class SqliteTaskLifecyclePersistence implements TaskLifecyclePersistence {
	private async database(): Promise<LifecycleRawDatabase> {
		return (await getCoordinationRawDb()) as LifecycleRawDatabase
	}

	async load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		const db = await this.database()
		return parseRecordRow(
			db
				.prepare(
					`SELECT taskId, generationId, lifecycleRevision, recordJson
					 FROM task_lifecycle_records
					 WHERE taskId = ?`,
				)
				.get(taskId),
		)
	}

	async loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		const db = await this.database()
		const row = db.prepare("SELECT eventJson FROM task_lifecycle_events WHERE eventId = ?").get(eventId) as
			| LifecycleEventRow
			| undefined
		if (!row) return undefined
		const event = JSON.parse(row.eventJson) as unknown
		if (!isTaskLifecycleEvent(event) || event.eventId !== eventId) {
			throw new Error("Task lifecycle event row is malformed or does not match its event payload.")
		}
		return event
	}

	async commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		const db = await this.database()
		db.exec("BEGIN IMMEDIATE")
		try {
			const duplicateRow = db
				.prepare("SELECT eventJson FROM task_lifecycle_events WHERE intentId = ?")
				.get(event.intentId) as LifecycleEventRow | undefined
			if (duplicateRow) {
				const duplicateEvent = JSON.parse(duplicateRow.eventJson) as unknown
				if (!isTaskLifecycleEvent(duplicateEvent)) throw new Error("Malformed duplicate lifecycle event.")
				const current = parseRecordRow(
					db
						.prepare(
							"SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records WHERE taskId = ?",
						)
						.get(duplicateEvent.taskId),
				)
				db.exec("COMMIT")
				if (!current) return { kind: "compare_and_swap_failed" }
				return { kind: "duplicate_intent", record: current, event: duplicateEvent }
			}

			const current = parseRecordRow(
				db
					.prepare(
						"SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records WHERE taskId = ?",
					)
					.get(record.taskId),
			)
			const matches =
				expectation.absent === true
					? current === undefined
					: current !== undefined &&
						current.generationId === expectation.generationId &&
						current.lifecycleRevision === expectation.lifecycleRevision
			if (!matches) {
				db.exec("ROLLBACK")
				return { kind: "compare_and_swap_failed", current }
			}
			if (event.transition === "register_generation" && record.parent?.governance === "attached") {
				const parent = parseRecordRow(
					db
						.prepare(
							"SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records WHERE taskId = ?",
						)
						.get(record.parent.taskId),
				)
				if (
					!parent ||
					parent.generationId !== record.parent.generationId ||
					parent.state !== "active" ||
					parent.cancellation.status === "requested"
				) {
					db.exec("ROLLBACK")
					return {
						kind: "constraint_failed",
						reason: "An attached child requires the exact active, unfenced parent generation.",
						current,
					}
				}
			}
			const attachedParent =
				record.parent?.governance === "attached"
					? parseRecordRow(
							db
								.prepare(
									"SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records WHERE taskId = ?",
								)
								.get(record.parent.taskId),
						)
					: undefined
			const parentConstraint = attachedParentConstraint(record, event, attachedParent)
			if (parentConstraint) {
				db.exec("ROLLBACK")
				return { kind: "constraint_failed", reason: parentConstraint, current }
			}
			if (event.transition === "settle_completion" && record.parent?.governance === "attached") {
				const parent = parseRecordRow(
					db
						.prepare(
							"SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records WHERE taskId = ?",
						)
						.get(record.parent.taskId),
				)
				if (
					!parent ||
					parent.generationId !== record.parent.generationId ||
					parent.state === "terminal" ||
					parent.cancellation.status === "requested"
				) {
					db.exec("ROLLBACK")
					return {
						kind: "constraint_failed",
						reason: "Attached child completion is fenced by its parent lifecycle.",
						current,
					}
				}
			}
			if (event.transition === "settle_completion" || event.transition === "replace_generation") {
				const governedGeneration =
					event.transition === "replace_generation" ? event.previous?.generationId : record.generationId
				const activeChild = db
					.prepare("SELECT recordJson FROM task_lifecycle_records WHERE taskId != ?")
					.all(record.taskId)
					.map((row) => JSON.parse((row as { recordJson: string }).recordJson) as TaskLifecycleRecord)
					.find(
						(candidate) =>
							candidate.parent?.governance === "attached" &&
							candidate.parent.taskId === record.taskId &&
							candidate.parent.generationId === governedGeneration &&
							candidate.state !== "terminal",
					)
				if (activeChild) {
					db.exec("ROLLBACK")
					return {
						kind: "constraint_failed",
						reason: `Attached child '${activeChild.taskId}' must terminalize before parent completion or generation replacement.`,
						current,
					}
				}
			}

			db.prepare("UPDATE task_lifecycle_sequence SET value = value + 1 WHERE id = 1").run()
			const sequenceRow = db.prepare("SELECT value FROM task_lifecycle_sequence WHERE id = 1").get() as
				| { value: number }
				| undefined
			if (!sequenceRow || !Number.isSafeInteger(sequenceRow.value)) {
				throw new Error("Task lifecycle sequence is unavailable.")
			}
			const committed = withSequence(record, event, sequenceRow.value)
			const recordJson = JSON.stringify(committed.record)
			const eventJson = JSON.stringify(committed.event)

			if (current) {
				const updated = db
					.prepare(
						`UPDATE task_lifecycle_records
						 SET generationId = ?, lifecycleRevision = ?, recordJson = ?, updatedAt = ?
						 WHERE taskId = ? AND generationId = ? AND lifecycleRevision = ?`,
					)
					.run(
						committed.record.generationId,
						committed.record.lifecycleRevision,
						recordJson,
						committed.record.committedAt,
						committed.record.taskId,
						expectation.generationId,
						expectation.lifecycleRevision,
					)
				if (updated.changes !== 1) {
					db.exec("ROLLBACK")
					return { kind: "compare_and_swap_failed", current }
				}
			} else {
				const inserted = db
					.prepare(
						`INSERT INTO task_lifecycle_records
							(taskId, generationId, lifecycleRevision, recordJson, updatedAt)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.run(
						committed.record.taskId,
						committed.record.generationId,
						committed.record.lifecycleRevision,
						recordJson,
						committed.record.committedAt,
					)
				if (inserted.changes !== 1) {
					db.exec("ROLLBACK")
					return { kind: "compare_and_swap_failed" }
				}
			}

			db.prepare(
				`INSERT INTO task_lifecycle_events
					(monotonicSequence, eventId, intentId, taskId, generationId, lifecycleRevision, eventJson, committedAt)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				committed.event.monotonicSequence,
				committed.event.eventId,
				committed.event.intentId,
				committed.event.taskId,
				committed.event.generationId,
				committed.event.lifecycleRevision,
				eventJson,
				committed.event.committedAt,
			)
			db.exec("COMMIT")
			return { kind: "committed", record: committed.record, event: committed.event }
		} catch (error) {
			try {
				db.exec("ROLLBACK")
			} catch {
				// The transaction may already have rolled back.
			}
			throw error
		}
	}

	async listAttachedChildren(parent: TaskParentLink): Promise<TaskLifecycleRecord[]> {
		const db = await this.database()
		return db
			.prepare("SELECT taskId, generationId, lifecycleRevision, recordJson FROM task_lifecycle_records")
			.all()
			.map(parseRecordRow)
			.filter((record): record is TaskLifecycleRecord => Boolean(record))
			.filter(
				(record) =>
					record.parent?.governance === "attached" &&
					record.parent.taskId === parent.taskId &&
					record.parent.generationId === parent.generationId,
			)
	}
}
