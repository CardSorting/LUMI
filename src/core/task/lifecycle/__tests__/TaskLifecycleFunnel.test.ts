import assert from "node:assert/strict"
import type { TaskLifecycleEvent, TaskLifecycleIntent, TaskLifecycleRecord } from "@shared/lifecycle/taskLifecycleEvent"
import { describe, it } from "mocha"
import { TaskState } from "../../TaskState"
import { createInMemoryTaskLifecycleFunnel, createTaskLifecycleIntentId, type TaskLifecycleFunnel } from "../TaskLifecycleFunnel"
import {
	InMemoryTaskLifecyclePersistence,
	type LifecycleCommitExpectation,
	type LifecyclePersistenceCommitResult,
	type TaskLifecyclePersistence,
} from "../TaskLifecyclePersistence"

function cause(reason = "test transition") {
	return { source: "test" as const, reason }
}

async function active(
	funnel = createInMemoryTaskLifecycleFunnel(),
	taskId = "task-1",
	parent?: { taskId: string; generationId: string; governance: "attached" | "detached" },
): Promise<{ funnel: TaskLifecycleFunnel; state: TaskState; record: TaskLifecycleRecord }> {
	const state = new TaskState()
	const result = await funnel.registerAndActivate(state, taskId, cause("activate fixture"), parent)
	assert.equal(result.kind, "committed")
	return { funnel, state, record: result.record }
}

function intent<T extends TaskLifecycleIntent["type"]>(
	type: T,
	record: TaskLifecycleRecord,
	overrides: Partial<Extract<TaskLifecycleIntent, { type: T }>> = {},
): Extract<TaskLifecycleIntent, { type: T }> {
	return {
		type,
		intentId: createTaskLifecycleIntentId(),
		taskId: record.taskId,
		generationId: record.generationId,
		cause: cause(type),
		...overrides,
	} as Extract<TaskLifecycleIntent, { type: T }>
}

describe("TaskLifecycleFunnel", () => {
	describe("generation safety and resume", () => {
		it("rejects stale generations, duplicate activation, and replayed intents", async () => {
			const fixture = await active()
			const duplicateActivation = await fixture.funnel.submit(fixture.state, intent("ActivateGeneration", fixture.record))
			assert.equal(duplicateActivation.kind, "rejected")
			assert.equal(duplicateActivation.code, "invalid_transition")

			const cancellationIntent = intent("RequestCancellation", fixture.record)
			const accepted = await fixture.funnel.submit(fixture.state, cancellationIntent)
			assert.equal(accepted.kind, "committed")
			const replay = await fixture.funnel.submit(fixture.state, cancellationIntent)
			assert.equal(replay.kind, "rejected")
			assert.match(replay.code, /duplicate_intent|terminal_generation/)

			const stale = await fixture.funnel.submit(fixture.state, {
				...intent("SettleCancellation", accepted.record),
				generationId: "old-generation",
			})
			assert.equal(stale.kind, "rejected")
			assert.equal(stale.code, "stale_generation")
		})

		it("resumes a suspended generation explicitly and isolates a replacement generation", async () => {
			const fixture = await active()
			const suspended = await fixture.funnel.submit(fixture.state, intent("SuspendGeneration", fixture.record))
			assert.equal(suspended.kind, "committed")
			const resumed = await fixture.funnel.submit(fixture.state, intent("ResumeWithGeneration", suspended.record))
			assert.equal(resumed.kind, "committed")
			assert.equal(resumed.record.generationId, fixture.record.generationId)
			assert.equal(resumed.record.state, "active")

			const failed = await fixture.funnel.submit(fixture.state, intent("SettleFailure", resumed.record))
			assert.equal(failed.kind, "committed")
			const ambiguousResume = await fixture.funnel.submit(fixture.state, intent("ResumeWithGeneration", failed.record))
			assert.equal(ambiguousResume.kind, "rejected")
			assert.equal(ambiguousResume.code, "terminal_generation")

			const replacement = await fixture.funnel.submit(fixture.state, {
				...intent("ResumeWithGeneration", failed.record),
				newGenerationId: "generation-2",
			})
			assert.equal(replacement.kind, "committed")
			assert.equal(replacement.record.generationId, "generation-2")
			assert.equal(replacement.record.state, "active")
			assert.equal(replacement.record.terminalOutcome, undefined)

			const oldCallback = await fixture.funnel.submit(fixture.state, intent("SettleFailure", failed.record))
			assert.equal(oldCallback.kind, "rejected")
			assert.equal(oldCallback.code, "stale_generation")
		})

		it("fences an old in-memory callback after another task instance replaces the generation", async () => {
			const fixture = await active()
			const oldGeneration = fixture.record.generationId
			const replacementState = new TaskState()
			const restored = await fixture.funnel.restore(replacementState, fixture.record.taskId)
			assert.ok(restored)
			const suspended = await fixture.funnel.submit(replacementState, intent("SuspendGeneration", restored))
			assert.equal(suspended.kind, "committed")
			const replaced = await fixture.funnel.submit(replacementState, {
				...intent("ResumeWithGeneration", suspended.record),
				newGenerationId: "replacement-generation",
			})
			assert.equal(replaced.kind, "committed")

			const staleEligibility = fixture.funnel.executionEligibility(fixture.state, fixture.record.taskId, oldGeneration)
			assert.equal(staleEligibility.eligible, false)
			assert.match(staleEligibility.reason ?? "", /stale|foreign/)
		})

		it("atomically replaces a generation and prevents stale concurrent replacement", async () => {
			const fixture = await active()
			const suspended = await fixture.funnel.submit(fixture.state, intent("SuspendGeneration", fixture.record))
			assert.equal(suspended.kind, "committed")
			const [first, second] = await Promise.all([
				fixture.funnel.submit(fixture.state, {
					...intent("ResumeWithGeneration", suspended.record),
					newGenerationId: "generation-a",
				}),
				fixture.funnel.submit(fixture.state, {
					...intent("ResumeWithGeneration", suspended.record),
					newGenerationId: "generation-b",
				}),
			])
			assert.equal(first.kind, "committed")
			assert.equal(second.kind, "rejected")
			assert.equal(second.code, "stale_generation")
		})

		it("restores a persisted suspended generation and resumes it without overwriting newer state", async () => {
			const persistence = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const first = new TaskLifecycleFunnel(persistence)
			const original = await active(first, "suspended-task")
			const suspended = await first.submit(original.state, intent("SuspendGeneration", original.record))
			assert.equal(suspended.kind, "committed")

			const restoredState = new TaskState()
			const second = new TaskLifecycleFunnel(persistence)
			const restored = await second.restore(restoredState, "suspended-task")
			assert.ok(restored)
			assert.equal(restored?.state, "suspended")
			assert.equal(restored?.generationId, original.record.generationId)
			assert.equal(restored?.lifecycleRevision, suspended.record.lifecycleRevision)
			const resumed = await second.submit(restoredState, intent("ResumeWithGeneration", restored))
			assert.equal(resumed.kind, "committed")
			assert.equal(resumed.record.generationId, original.record.generationId)
			assert.equal(resumed.record.lifecycleRevision, suspended.record.lifecycleRevision + 1)
		})
	})

	describe("terminal monotonicity and deterministic conflicts", () => {
		for (const terminal of [
			["SettleCompletion", "completed"],
			["SettleFailure", "failed"],
			["SettleTimeout", "timed_out"],
		] as const) {
			it(`${terminal[1]} is terminal and cannot reactivate`, async () => {
				const fixture = await active()
				const settled = await fixture.funnel.submit(fixture.state, intent(terminal[0], fixture.record))
				assert.equal(settled.kind, "committed")
				assert.equal(settled.record.terminalOutcome, terminal[1])
				const activation = await fixture.funnel.submit(fixture.state, intent("ActivateGeneration", settled.record))
				assert.equal(activation.kind, "rejected")
				assert.equal(activation.code, "terminal_generation")
			})
		}

		it("a cancellation request fences later completion and failure facts", async () => {
			const fixture = await active()
			const requested = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")
			const completion = await fixture.funnel.submit(fixture.state, {
				...intent("SettleCompletion", requested.record),
				cause: { ...cause("late completion"), authoritativeAt: Date.now() + 1 },
			})
			assert.equal(completion.kind, "rejected")
			assert.equal(completion.code, "cancellation_fenced")
			const failure = await fixture.funnel.submit(fixture.state, intent("SettleFailure", requested.record))
			assert.equal(failure.kind, "rejected")
			assert.equal(failure.code, "cancellation_fenced")
			const cancelled = await fixture.funnel.submit(fixture.state, intent("SettleCancellation", requested.record))
			assert.equal(cancelled.kind, "committed")
			assert.equal(cancelled.record.terminalOutcome, "cancelled")
		})

		it("keeps completed and cancelled generations terminal under later conflicting settlements", async () => {
			const completedFixture = await active(undefined, "completed-task")
			const completed = await completedFixture.funnel.submit(
				completedFixture.state,
				intent("SettleCompletion", completedFixture.record),
			)
			assert.equal(completed.kind, "committed")
			const cancelCompleted = await completedFixture.funnel.submit(
				completedFixture.state,
				intent("RequestCancellation", completed.record),
			)
			assert.equal(cancelCompleted.kind, "rejected")
			assert.equal(cancelCompleted.code, "terminal_generation")

			const cancelledFixture = await active(undefined, "cancelled-task")
			const requested = await cancelledFixture.funnel.submit(
				cancelledFixture.state,
				intent("RequestCancellation", cancelledFixture.record),
			)
			assert.equal(requested.kind, "committed")
			const cancelled = await cancelledFixture.funnel.submit(
				cancelledFixture.state,
				intent("SettleCancellation", requested.record),
			)
			assert.equal(cancelled.kind, "committed")
			const completeCancelled = await cancelledFixture.funnel.submit(
				cancelledFixture.state,
				intent("SettleCompletion", cancelled.record),
			)
			assert.equal(completeCancelled.kind, "rejected")
			assert.equal(completeCancelled.code, "terminal_generation")
		})

		it("rejects repeated cancellation and duplicate terminal submissions deterministically", async () => {
			const fixture = await active()
			const requested = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")
			const repeated = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", requested.record))
			assert.equal(repeated.kind, "rejected")
			assert.equal(repeated.code, "duplicate_intent")
			const terminalIntent = intent("SettleCancellation", requested.record)
			const settled = await fixture.funnel.submit(fixture.state, terminalIntent)
			assert.equal(settled.kind, "committed")
			const replayedTerminal = await fixture.funnel.submit(fixture.state, terminalIntent)
			assert.equal(replayedTerminal.kind, "rejected")
			assert.equal(replayedTerminal.code, "terminal_generation")
		})

		it("an earlier durable completion fact wins before cancellation settles", async () => {
			const fixture = await active()
			const requested = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")
			assert.equal(requested.record.cancellation.status, "requested")
			const authoritativeAt = requested.record.cancellation.requestedAt - 1
			const completion = await fixture.funnel.submit(fixture.state, {
				...intent("SettleCompletion", requested.record),
				cause: { ...cause("pre-fence completion"), authoritativeAt },
			})
			assert.equal(completion.kind, "committed")
			assert.equal(completion.record.terminalOutcome, "completed")
			const cancellation = await fixture.funnel.submit(fixture.state, intent("SettleCancellation", completion.record))
			assert.equal(cancellation.kind, "rejected")
			assert.equal(cancellation.code, "terminal_generation")
		})

		it("fails closed when completion and cancellation have the same authoritative timestamp", async () => {
			const fixture = await active()
			const requested = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")
			assert.equal(requested.record.cancellation.status, "requested")
			const completion = await fixture.funnel.submit(fixture.state, {
				...intent("SettleCompletion", requested.record),
				cause: {
					...cause("ambiguous completion"),
					authoritativeAt: requested.record.cancellation.requestedAt,
				},
			})
			assert.equal(completion.kind, "rejected")
			assert.equal(completion.code, "cancellation_fenced")
		})

		it("preserves the committed terminal fact when timeout and completion conflict", async () => {
			const timeoutFirst = await active(undefined, "timeout-first")
			const timedOut = await timeoutFirst.funnel.submit(timeoutFirst.state, intent("SettleTimeout", timeoutFirst.record))
			assert.equal(timedOut.kind, "committed")
			const lateCompletion = await timeoutFirst.funnel.submit(
				timeoutFirst.state,
				intent("SettleCompletion", timedOut.record),
			)
			assert.equal(lateCompletion.kind, "rejected")
			assert.equal(lateCompletion.code, "terminal_generation")

			const completionFirst = await active(undefined, "completion-first")
			const completed = await completionFirst.funnel.submit(
				completionFirst.state,
				intent("SettleCompletion", completionFirst.record),
			)
			assert.equal(completed.kind, "committed")
			const lateTimeout = await completionFirst.funnel.submit(
				completionFirst.state,
				intent("SettleTimeout", completed.record),
			)
			assert.equal(lateTimeout.kind, "rejected")
			assert.equal(lateTimeout.code, "terminal_generation")
		})

		it("requires a committed cancellation request before cancellation settlement", async () => {
			const fixture = await active()
			const result = await fixture.funnel.submit(fixture.state, intent("SettleCancellation", fixture.record))
			assert.equal(result.kind, "rejected")
			assert.equal(result.code, "cancellation_not_requested")
		})
	})

	describe("persistence and immutable publication", () => {
		it("publishes only after commit and preserves monotonic event ordering", async () => {
			const persistence = new DelayedCommitPersistence()
			const funnel = new (await import("../TaskLifecycleFunnel")).TaskLifecycleFunnel(persistence)
			const state = new TaskState()
			const published: TaskLifecycleEvent[] = []
			funnel.subscribe((event) => {
				published.push(event)
			})
			const pending = funnel.submit(state, {
				type: "RegisterGeneration",
				intentId: "register",
				taskId: "ordered-task",
				generationId: state.executionGeneration,
				cause: cause("register"),
			})
			await persistence.commitEntered
			assert.equal(published.length, 0)
			assert.equal(state.lifecycleFunnelEventJson, undefined)
			persistence.releaseCommit()
			const registered = await pending
			assert.equal(registered.kind, "committed")
			assert.equal(published.length, 1)

			const activated = await funnel.submit(state, {
				type: "ActivateGeneration",
				intentId: "activate",
				taskId: "ordered-task",
				generationId: registered.record.generationId,
				cause: cause("activate"),
			})
			assert.equal(activated.kind, "committed")
			assert.ok(activated.event.monotonicSequence > registered.event.monotonicSequence)
			assert.deepEqual(
				state.lifecycleFunnelHistory?.map((event) => event.transition),
				["register_generation", "activate_generation"],
			)
		})

		it("does not expose a false event when persistence fails", async () => {
			const funnel = new (await import("../TaskLifecycleFunnel")).TaskLifecycleFunnel(new FailingPersistence())
			const state = new TaskState()
			let published = false
			funnel.subscribe(() => {
				published = true
			})
			const result = await funnel.submit(state, {
				type: "RegisterGeneration",
				intentId: "failing",
				taskId: "failing-task",
				generationId: state.executionGeneration,
				cause: cause("fail"),
			})
			assert.equal(result.kind, "rejected")
			assert.equal(result.code, "persistence_failed")
			assert.equal(published, false)
			assert.equal(state.lifecycleFunnelEventJson, undefined)
		})

		it("leaves cancellation requested when settlement persistence fails", async () => {
			const base = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const authority = new TaskLifecycleFunnel(base)
			const fixture = await active(authority, "failed-cancellation-settlement")
			const requested = await authority.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")

			const failingAuthority = new TaskLifecycleFunnel(new FailingCommitPersistence(base))
			const restoredState = new TaskState()
			const restored = await failingAuthority.restore(restoredState, requested.record.taskId)
			assert.ok(restored)
			const result = await failingAuthority.submit(
				restoredState,
				intent("SettleCancellation", restored, {
					metadata: { cleanup: "joined" },
				}),
			)
			assert.equal(result.kind, "rejected")
			assert.equal(result.code, "persistence_failed")
			assert.equal((await base.load(requested.record.taskId))?.cancellation.status, "requested")
			assert.equal((await base.load(requested.record.taskId))?.state, "active")
		})

		it("fails closed when restoration cannot load the record's committed event", async () => {
			const base = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			await active(new TaskLifecycleFunnel(base), "missing-event-task")
			const restoredState = new TaskState()
			const result = await new TaskLifecycleFunnel(new MissingEventPersistence(base)).ensureActive(
				restoredState,
				"missing-event-task",
				cause("restore missing event"),
			)
			assert.equal(result.kind, "rejected")
			assert.equal(result.code, "persistence_failed")
			assert.equal(restoredState.lifecycleFunnelRecordJson, undefined)
			assert.equal(restoredState.lifecycleFunnelEventJson, undefined)
		})

		it("rejects a mismatched durable event and a malformed compatibility projection", async () => {
			const base = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const seeded = await active(new TaskLifecycleFunnel(base), "mismatched-event-task")
			const restoredState = new TaskState()
			const result = await new TaskLifecycleFunnel(new MismatchedEventPersistence(base)).ensureActive(
				restoredState,
				seeded.record.taskId,
				cause("restore mismatched event"),
			)
			assert.equal(result.kind, "rejected")
			assert.equal(result.code, "persistence_failed")
			assert.equal(restoredState.lifecycleFunnelRecordJson, undefined)

			const malformedState = new TaskState()
			malformedState.lifecycleFunnelRecordJson = JSON.stringify({
				taskId: "compatibility-task",
				generationId: "compatibility-generation",
				state: "terminal",
			})
			const authority = new TaskLifecycleFunnel(base)
			assert.equal(authority.readProjection(malformedState), undefined)
			assert.equal(
				authority.executionEligibility(malformedState, "compatibility-task", "compatibility-generation").eligible,
				false,
			)
		})

		it("freezes committed events and defensively clones caller metadata", async () => {
			const fixture = await active()
			const metadata: Record<string, string> = { detail: "original" }
			const requested = await fixture.funnel.submit(fixture.state, intent("RequestCancellation", fixture.record))
			assert.equal(requested.kind, "committed")
			const settled = await fixture.funnel.submit(fixture.state, {
				...intent("SettleCancellation", requested.record),
				metadata,
			})
			assert.equal(settled.kind, "committed")
			metadata.detail = "mutated"
			assert.equal(settled.event.metadata?.detail, "original")
			assert.equal(Object.isFrozen(settled.event), true)
			assert.equal(Object.isFrozen(settled.event.committed), true)
			assert.throws(() => {
				;(settled.event.metadata as Record<string, string>).detail = "mutated again"
			}, TypeError)
		})

		it("restores exact generation/revision and rejects duplicate persisted intents", async () => {
			const persistence = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const first = new TaskLifecycleFunnel(persistence)
			const state = new TaskState()
			const registrationIntent: TaskLifecycleIntent = {
				type: "RegisterGeneration",
				intentId: "durable-intent",
				taskId: "durable-task",
				generationId: state.executionGeneration,
				cause: cause("durable"),
			}
			const committed = await first.submit(state, registrationIntent)
			assert.equal(committed.kind, "committed")

			const restoredState = new TaskState()
			const second = new TaskLifecycleFunnel(persistence)
			const restored = await second.restore(restoredState, "durable-task")
			assert.deepEqual(restored, committed.record)
			assert.equal(restoredState.executionGeneration, committed.record.generationId)
			assert.equal(JSON.parse(restoredState.lifecycleFunnelEventJson ?? "{}").eventId, committed.event.eventId)
			const replay = await second.submit(restoredState, registrationIntent)
			assert.equal(replay.kind, "rejected")
		})

		it("prevents a stale asynchronous commit from overwriting a newer revision", async () => {
			const base = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const seedFunnel = new TaskLifecycleFunnel(base)
			const state = new TaskState()
			const seeded = await seedFunnel.registerAndActivate(state, "cas-task", cause("seed"))
			assert.equal(seeded.kind, "committed")

			const paired = new PairedLoadPersistence(base)
			const firstAuthority = new TaskLifecycleFunnel(paired)
			const secondAuthority = new TaskLifecycleFunnel(paired)
			const [first, second] = await Promise.all([
				firstAuthority.submit(state, intent("SuspendGeneration", seeded.record)),
				secondAuthority.submit(state, intent("RequestCancellation", seeded.record)),
			])
			const results = [first, second]
			expectExactlyOne(
				results.map((result) => result.kind),
				"committed",
			)
			expectExactlyOne(
				results.map((result) => (result.kind === "rejected" ? result.code : "committed")),
				"compare_and_swap_failed",
			)
			const durable = await base.load("cas-task")
			assert.equal(durable?.lifecycleRevision, seeded.record.lifecycleRevision + 1)
		})
	})

	describe("parent-child lifecycle policy", () => {
		it("propagates parent cancellation request and settlement to attached children", async () => {
			const parent = await active(undefined, "parent")
			const child = await active(parent.funnel, "child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})
			const request = await parent.funnel.submit(parent.state, intent("RequestCancellation", parent.record))
			assert.equal(request.kind, "committed")
			assert.equal(parent.funnel.readProjection(child.state)?.cancellation.status, "requested")

			const settlement = await parent.funnel.submit(parent.state, intent("SettleCancellation", request.record))
			assert.equal(settlement.kind, "committed")
			const childTerminal = parent.funnel.readProjection(child.state)
			assert.equal(childTerminal?.state, "terminal")
			assert.equal(childTerminal?.terminalOutcome, "cancelled")
		})

		it("does not propagate to detached children", async () => {
			const parent = await active(undefined, "parent")
			const child = await active(parent.funnel, "child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "detached",
			})
			const request = await parent.funnel.submit(parent.state, intent("RequestCancellation", parent.record))
			assert.equal(request.kind, "committed")
			assert.equal(parent.funnel.readProjection(child.state)?.cancellation.status, "none")
		})

		it("blocks parent completion while an attached child is active", async () => {
			const parent = await active(undefined, "parent")
			await active(parent.funnel, "child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})
			const completion = await parent.funnel.submit(parent.state, intent("SettleCompletion", parent.record))
			assert.equal(completion.kind, "rejected")
			assert.equal(completion.code, "parent_constraint")
		})

		it("fences child completion after parent cancellation and allows prior child completion", async () => {
			const parent = await active(undefined, "parent-a")
			const child = await active(parent.funnel, "child-a", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})
			const request = await parent.funnel.submit(parent.state, intent("RequestCancellation", parent.record))
			assert.equal(request.kind, "committed")
			const childCurrent = parent.funnel.readProjection(child.state)
			assert.ok(childCurrent)
			const lateChildCompletion = await parent.funnel.submit(child.state, intent("SettleCompletion", childCurrent))
			assert.equal(lateChildCompletion.kind, "rejected")

			const parentB = await active(undefined, "parent-b")
			const childB = await active(parentB.funnel, "child-b", {
				taskId: parentB.record.taskId,
				generationId: parentB.record.generationId,
				governance: "attached",
			})
			const earlyChildCompletion = await parentB.funnel.submit(childB.state, intent("SettleCompletion", childB.record))
			assert.equal(earlyChildCompletion.kind, "committed")
			const parentRequest = await parentB.funnel.submit(parentB.state, intent("RequestCancellation", parentB.record))
			assert.equal(parentRequest.kind, "committed")
			assert.equal(parentB.funnel.readProjection(childB.state)?.terminalOutcome, "completed")
		})

		it("blocks parent generation replacement until attached children terminalize", async () => {
			const parent = await active(undefined, "parent")
			const child = await active(parent.funnel, "child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})
			const suspended = await parent.funnel.submit(parent.state, intent("SuspendGeneration", parent.record))
			assert.equal(suspended.kind, "committed")
			const blocked = await parent.funnel.submit(parent.state, {
				...intent("ResumeWithGeneration", suspended.record),
				newGenerationId: "parent-generation-2",
			})
			assert.equal(blocked.kind, "rejected")
			assert.equal(blocked.code, "parent_constraint")

			const childFailure = await parent.funnel.submit(child.state, intent("SettleFailure", child.record))
			assert.equal(childFailure.kind, "committed")
			const replaced = await parent.funnel.submit(parent.state, {
				...intent("ResumeWithGeneration", suspended.record),
				newGenerationId: "parent-generation-2",
			})
			assert.equal(replaced.kind, "committed")
			const staleChildCallback = await parent.funnel.submit(child.state, intent("SettleTimeout", child.record))
			assert.equal(staleChildCallback.kind, "rejected")
		})

		it("propagates parent failure and timeout outcomes through typed child events", async () => {
			for (const [transition, outcome] of [
				["SettleFailure", "failed"],
				["SettleTimeout", "timed_out"],
			] as const) {
				const parent = await active(undefined, `parent-${outcome}`)
				const child = await active(parent.funnel, `child-${outcome}`, {
					taskId: parent.record.taskId,
					generationId: parent.record.generationId,
					governance: "attached",
				})
				const terminal = await parent.funnel.submit(parent.state, intent(transition, parent.record))
				assert.equal(terminal.kind, "committed")
				assert.equal(parent.funnel.readProjection(child.state)?.terminalOutcome, outcome)
				assert.equal(child.state.lifecycleFunnelHistory?.at(-1)?.transition, "propagate_parent_termination")
			}
		})

		it("rejects forged or stale parent propagation while the parent is active", async () => {
			const parent = await active(undefined, "parent")
			const child = await active(parent.funnel, "child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})
			const forged = await parent.funnel.submit(child.state, {
				...intent("PropagateParentTermination", child.record),
				parentEventId: "forged-parent-event",
				parentOutcome: "failed",
				cause: {
					source: "parent_lifecycle",
					reason: "forged propagation",
					originatingEventId: "forged-parent-event",
				},
			})
			assert.equal(forged.kind, "rejected")
			assert.equal(forged.code, "parent_constraint")
			assert.equal(parent.funnel.readProjection(child.state)?.state, "active")
		})

		it("fences an attached child across a propagation crash window and reconciles it on parent restore", async () => {
			const persistence = new InMemoryTaskLifecyclePersistence()
			const { TaskLifecycleFunnel } = await import("../TaskLifecycleFunnel")
			const interruptedAuthority = new TaskLifecycleFunnel(new SuppressedChildDiscoveryPersistence(persistence))
			const parent = await active(interruptedAuthority, "interrupted-parent")
			const child = await active(interruptedAuthority, "interrupted-child", {
				taskId: parent.record.taskId,
				generationId: parent.record.generationId,
				governance: "attached",
			})

			const failed = await interruptedAuthority.submit(parent.state, intent("SettleFailure", parent.record))
			assert.equal(failed.kind, "committed")
			assert.equal((await persistence.load(child.record.taskId))?.state, "active")

			const recoveredAuthority = new TaskLifecycleFunnel(persistence)
			const childState = new TaskState()
			const admission = await recoveredAuthority.ensureActive(
				childState,
				child.record.taskId,
				cause("recovered child admission"),
			)
			assert.equal(admission.kind, "rejected")
			assert.equal(admission.code, "parent_constraint")

			await recoveredAuthority.restore(new TaskState(), parent.record.taskId)
			const reconciled = await persistence.load(child.record.taskId)
			assert.equal(reconciled?.state, "terminal")
			assert.equal(reconciled?.terminalOutcome, "failed")
		})
	})
})

class DelayedCommitPersistence implements TaskLifecyclePersistence {
	private readonly delegate = new InMemoryTaskLifecyclePersistence()
	private enterCommit!: () => void
	private continueCommit!: () => void
	readonly commitEntered = new Promise<void>((resolve) => {
		this.enterCommit = resolve
	})
	private readonly commitReleased = new Promise<void>((resolve) => {
		this.continueCommit = resolve
	})
	private delayed = false

	releaseCommit(): void {
		this.continueCommit()
	}

	load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		return this.delegate.load(taskId)
	}

	loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		return this.delegate.loadEvent(eventId)
	}

	async commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		if (!this.delayed) {
			this.delayed = true
			this.enterCommit()
			await this.commitReleased
		}
		return this.delegate.commit(expectation, record, event)
	}

	listAttachedChildren(parent: {
		taskId: string
		generationId: string
		governance: "attached" | "detached"
	}): Promise<TaskLifecycleRecord[]> {
		return this.delegate.listAttachedChildren(parent)
	}
}

class FailingPersistence implements TaskLifecyclePersistence {
	load(): Promise<TaskLifecycleRecord | undefined> {
		return Promise.resolve(undefined)
	}

	loadEvent(): Promise<TaskLifecycleEvent | undefined> {
		return Promise.resolve(undefined)
	}

	commit(): Promise<LifecyclePersistenceCommitResult> {
		return Promise.reject(new Error("storage offline"))
	}

	listAttachedChildren(): Promise<TaskLifecycleRecord[]> {
		return Promise.resolve([])
	}
}

class FailingCommitPersistence implements TaskLifecyclePersistence {
	constructor(private readonly delegate: InMemoryTaskLifecyclePersistence) {}

	load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		return this.delegate.load(taskId)
	}

	loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		return this.delegate.loadEvent(eventId)
	}

	commit(): Promise<LifecyclePersistenceCommitResult> {
		return Promise.reject(new Error("commit unavailable"))
	}

	listAttachedChildren(parent: {
		taskId: string
		generationId: string
		governance: "attached" | "detached"
	}): Promise<TaskLifecycleRecord[]> {
		return this.delegate.listAttachedChildren(parent)
	}
}

class MissingEventPersistence implements TaskLifecyclePersistence {
	constructor(private readonly delegate: InMemoryTaskLifecyclePersistence) {}

	load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		return this.delegate.load(taskId)
	}

	loadEvent(): Promise<TaskLifecycleEvent | undefined> {
		return Promise.resolve(undefined)
	}

	commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		return this.delegate.commit(expectation, record, event)
	}

	listAttachedChildren(parent: {
		taskId: string
		generationId: string
		governance: "attached" | "detached"
	}): Promise<TaskLifecycleRecord[]> {
		return this.delegate.listAttachedChildren(parent)
	}
}

class MismatchedEventPersistence implements TaskLifecyclePersistence {
	constructor(private readonly delegate: InMemoryTaskLifecyclePersistence) {}

	load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		return this.delegate.load(taskId)
	}

	async loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		const event = await this.delegate.loadEvent(eventId)
		return event ? { ...event, taskId: "foreign-task" } : undefined
	}

	commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		return this.delegate.commit(expectation, record, event)
	}

	listAttachedChildren(parent: {
		taskId: string
		generationId: string
		governance: "attached" | "detached"
	}): Promise<TaskLifecycleRecord[]> {
		return this.delegate.listAttachedChildren(parent)
	}
}

class SuppressedChildDiscoveryPersistence implements TaskLifecyclePersistence {
	constructor(private readonly delegate: InMemoryTaskLifecyclePersistence) {}

	load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		return this.delegate.load(taskId)
	}

	loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		return this.delegate.loadEvent(eventId)
	}

	commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		return this.delegate.commit(expectation, record, event)
	}

	listAttachedChildren(): Promise<TaskLifecycleRecord[]> {
		return Promise.resolve([])
	}
}

class PairedLoadPersistence implements TaskLifecyclePersistence {
	private loadCount = 0
	private releaseLoads!: () => void
	private readonly loadsReady = new Promise<void>((resolve) => {
		this.releaseLoads = resolve
	})

	constructor(private readonly delegate: InMemoryTaskLifecyclePersistence) {}

	async load(taskId: string): Promise<TaskLifecycleRecord | undefined> {
		const snapshot = await this.delegate.load(taskId)
		this.loadCount++
		if (this.loadCount === 2) this.releaseLoads()
		await this.loadsReady
		return snapshot
	}

	loadEvent(eventId: string): Promise<TaskLifecycleEvent | undefined> {
		return this.delegate.loadEvent(eventId)
	}

	commit(
		expectation: LifecycleCommitExpectation,
		record: TaskLifecycleRecord,
		event: TaskLifecycleEvent,
	): Promise<LifecyclePersistenceCommitResult> {
		return this.delegate.commit(expectation, record, event)
	}

	listAttachedChildren(parent: {
		taskId: string
		generationId: string
		governance: "attached" | "detached"
	}): Promise<TaskLifecycleRecord[]> {
		return this.delegate.listAttachedChildren(parent)
	}
}

function expectExactlyOne(values: readonly string[], expected: string): void {
	assert.equal(
		values.filter((value) => value === expected).length,
		1,
		`Expected exactly one '${expected}' result, received ${JSON.stringify(values)}.`,
	)
}
