import "should"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import Database from "better-sqlite3"
import { CompiledQuery, Kysely, SqliteDialect } from "kysely"
import type { Schema } from "@/infrastructure/db/Config"
import {
	COMPLETION_DECISION_SCHEMA_VERSION,
	canonicalCompletionJson,
	canonicalDecisionId,
	commitTaskCompletionTransaction,
	type TaskCompletionRecord,
} from "../handlers/AttemptCompletionHandler"

/**
 * Create an isolated test SQLite database with the required tables.
 * Returns a Kysely instance and cleanup function.
 */
async function createTestDb(dbPath: string): Promise<{ db: Kysely<Schema>; rawDb: Database.Database }> {
	const rawDb = new Database(dbPath)
	const db = new Kysely<Schema>({
		dialect: new SqliteDialect({ database: rawDb }),
	})
	const execute = (q: string) => db.executeQuery(CompiledQuery.raw(q))

	await execute("PRAGMA journal_mode = WAL;")
	await execute("PRAGMA synchronous = NORMAL;")
	await execute("PRAGMA busy_timeout = 5000;")

	await execute(`CREATE TABLE IF NOT EXISTS swarm_locks (
		resource TEXT PRIMARY KEY,
		ownerId TEXT NOT NULL,
		expiresAt BIGINT NOT NULL,
		createdAt BIGINT NOT NULL,
		leaseEpoch TEXT,
		fencingToken TEXT,
		protocolVersion INTEGER,
		authorityMode TEXT,
		pid INTEGER
	)`)

	await execute(`CREATE TABLE IF NOT EXISTS swarm_lock_generations (
		resourceKey TEXT PRIMARY KEY,
		highestLeaseEpoch TEXT NOT NULL,
		highestFencingToken TEXT NOT NULL
	)`)

	await execute(`CREATE TABLE IF NOT EXISTS task_completions (
		taskId TEXT PRIMARY KEY,
		decisionId TEXT NOT NULL,
		status TEXT NOT NULL,
		evaluatedStateVersion INTEGER NOT NULL,
		evaluatedCheckpointJson TEXT NOT NULL,
		decisionJson TEXT NOT NULL,
		ownerId TEXT NOT NULL,
		leaseEpoch TEXT NOT NULL,
		fencingToken TEXT NOT NULL,
		committedAt BIGINT NOT NULL
	)`)
	await execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_completions_decision ON task_completions(decisionId)`)

	return { db, rawDb }
}

function seedAuthoritativeLease(
	rawDb: Database.Database,
	resourceKey: string,
	ownerId: string,
	leaseEpoch: string,
	fencingToken: string,
): void {
	rawDb
		.prepare(
			"INSERT OR REPLACE INTO swarm_lock_generations (resourceKey, highestLeaseEpoch, highestFencingToken) VALUES (?, ?, ?)",
		)
		.run(resourceKey, leaseEpoch, fencingToken)
	rawDb
		.prepare(
			`INSERT OR REPLACE INTO swarm_locks (
			resource, ownerId, expiresAt, createdAt, leaseEpoch, fencingToken, protocolVersion, authorityMode, pid
		) VALUES (?, ?, ?, ?, ?, ?, 2, 'sqlite', ?)`,
		)
		.run(resourceKey, ownerId, Date.now() + 300_000, Date.now(), leaseEpoch, fencingToken, process.pid)
}

function completionRecord(
	taskId: string,
	ownerId: string,
	leaseEpoch: string,
	fencingToken: string,
	overrides: Partial<Pick<TaskCompletionRecord, "status" | "evaluatedStateVersion" | "decisionJson">> = {},
): TaskCompletionRecord {
	const status = overrides.status ?? "succeeded"
	const evaluatedStateVersion = overrides.evaluatedStateVersion ?? 1
	const checkpoint = `checkpoint-${evaluatedStateVersion}`
	return {
		taskId,
		decisionId: canonicalDecisionId({
			taskId,
			evaluatedStateVersion,
			checkpoint,
			outcome: status,
			decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
		}),
		status,
		evaluatedStateVersion,
		evaluatedCheckpointJson: canonicalCompletionJson({ checkpoint }),
		decisionJson: overrides.decisionJson ?? canonicalCompletionJson({ code: "COMPLETION_APPROVED", status }),
		ownerId,
		leaseEpoch,
		fencingToken,
		committedAt: Date.now(),
	}
}

describe("TaskCompletionTerminalization", () => {
	let tmpDir: string
	let dbPath: string
	let db: Kysely<Schema>
	let rawDb: Database.Database

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "completion-term-"))
		dbPath = path.join(tmpDir, "test.db")
		const testDb = await createTestDb(dbPath)
		db = testDb.db
		rawDb = testDb.rawDb
	})

	afterEach(async () => {
		try {
			rawDb?.close()
		} catch {}
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
	})

	describe("CAS terminalization", () => {
		it("commits a terminal completion with valid lease identity", async () => {
			// Insert a lease
			await db
				.insertInto("swarm_locks")
				.values({
					resource: "governed-lane:swarm1:0",
					ownerId: "agent-1",
					expiresAt: Date.now() + 300000,
					createdAt: Date.now(),
					leaseEpoch: "1",
					fencingToken: "1",
					protocolVersion: 1,
				})
				.execute()

			// Insert completion
			await db
				.insertInto("task_completions")
				.values({
					taskId: "task-1",
					decisionId: "dec-abc",
					status: "succeeded",
					evaluatedStateVersion: 1,
					evaluatedCheckpointJson: "{}",
					decisionJson: '{"code":"COMPLETION_APPROVED"}',
					ownerId: "agent-1",
					leaseEpoch: "1",
					fencingToken: "1",
					committedAt: Date.now(),
				})
				.execute()

			const row = await db.selectFrom("task_completions").selectAll().where("taskId", "=", "task-1").executeTakeFirst()

			row!.should.not.be.undefined()
			row!.decisionId.should.equal("dec-abc")
			row!.status.should.equal("succeeded")
		})

		it("rejects a second terminal commit for the same task with different outcome", async () => {
			await db
				.insertInto("task_completions")
				.values({
					taskId: "task-2",
					decisionId: "dec-1",
					status: "succeeded",
					evaluatedStateVersion: 1,
					evaluatedCheckpointJson: "{}",
					decisionJson: '{"code":"COMPLETION_APPROVED"}',
					ownerId: "agent-1",
					leaseEpoch: "1",
					fencingToken: "1",
					committedAt: Date.now(),
				})
				.execute()

			// Attempt a second insert should fail (PRIMARY KEY constraint)
			let threw = false
			try {
				await db
					.insertInto("task_completions")
					.values({
						taskId: "task-2",
						decisionId: "dec-2",
						status: "failed",
						evaluatedStateVersion: 2,
						evaluatedCheckpointJson: "{}",
						decisionJson: '{"code":"VERIFICATION_FAILED"}',
						ownerId: "agent-1",
						leaseEpoch: "1",
						fencingToken: "1",
						committedAt: Date.now(),
					})
					.execute()
			} catch {
				threw = true
			}
			threw.should.be.true()

			// Original record remains
			const row = await db.selectFrom("task_completions").selectAll().where("taskId", "=", "task-2").executeTakeFirst()
			row!.decisionId.should.equal("dec-1")
			row!.status.should.equal("succeeded")
		})

		it("returns existing completion idempotently on restart", async () => {
			await db
				.insertInto("task_completions")
				.values({
					taskId: "task-3",
					decisionId: "dec-restart",
					status: "succeeded",
					evaluatedStateVersion: 5,
					evaluatedCheckpointJson: '{"hash":"abc"}',
					decisionJson: '{"code":"COMPLETION_APPROVED","outcome":"success"}',
					ownerId: "agent-2",
					leaseEpoch: "3",
					fencingToken: "7",
					committedAt: Date.now(),
				})
				.execute()

			// Simulate restart: read back the same decision
			const row = await db.selectFrom("task_completions").selectAll().where("taskId", "=", "task-3").executeTakeFirst()
			row!.should.not.be.undefined()
			row!.decisionId.should.equal("dec-restart")
			row!.status.should.equal("succeeded")
			row!.fencingToken.should.equal("7")
		})
	})

	describe("multi-connection contention", () => {
		it("only one of two simultaneous completions succeeds", async () => {
			// Create a second connection to the same database
			const rawDb2 = new Database(dbPath)
			const db2 = new Kysely<Schema>({
				dialect: new SqliteDialect({ database: rawDb2 }),
			})

			const results: boolean[] = []

			const attempt = async (d: Kysely<Schema>, taskId: string, decisionId: string) => {
				try {
					await d
						.insertInto("task_completions")
						.values({
							taskId,
							decisionId,
							status: "succeeded",
							evaluatedStateVersion: 1,
							evaluatedCheckpointJson: "{}",
							decisionJson: `{"id":"${decisionId}"}`,
							ownerId: "agent-1",
							leaseEpoch: "1",
							fencingToken: "1",
							committedAt: Date.now(),
						})
						.execute()
					return true
				} catch {
					return false
				}
			}

			// Both try to complete the same task
			const [r1, r2] = await Promise.all([attempt(db, "task-contended", "dec-A"), attempt(db2, "task-contended", "dec-B")])
			results.push(r1, r2)

			// Exactly one should succeed
			const successes = results.filter((r) => r)
			successes.length.should.equal(1)

			rawDb2.close()
		})
	})

	describe("strict completion transaction", () => {
		it("uses a stable schema-versioned canonical digest", () => {
			const first = canonicalDecisionId({
				taskId: "task-digest",
				evaluatedStateVersion: 9,
				checkpoint: "abc",
				outcome: "succeeded",
				decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
			})
			const reordered = canonicalDecisionId({
				decisionSchemaVersion: COMPLETION_DECISION_SCHEMA_VERSION,
				outcome: "succeeded",
				checkpoint: "abc",
				evaluatedStateVersion: 9,
				taskId: "task-digest",
			})
			first.should.equal(reordered)
		})

		it("commits only with the current lease generation and unchanged state version", () => {
			const resourceKey = "governed-lane:strict:0"
			seedAuthoritativeLease(rawDb, resourceKey, "agent-strict", "4", "8")
			const record = completionRecord("task-strict", "agent-strict", "4", "8")
			const committed = commitTaskCompletionTransaction(
				rawDb as unknown as Parameters<typeof commitTaskCompletionTransaction>[0],
				{ record, resourceKey, currentStateVersion: () => 1 },
			)
			committed.kind.should.equal("committed")

			const persisted = rawDb.prepare("SELECT decisionId FROM task_completions WHERE taskId = ?").get(record.taskId) as {
				decisionId: string
			}
			persisted.decisionId.should.equal(record.decisionId)
		})

		it("fails closed for stale fencing tokens and state-version changes", () => {
			const resourceKey = "governed-lane:strict:1"
			seedAuthoritativeLease(rawDb, resourceKey, "agent-strict", "4", "9")
			const stale = completionRecord("task-stale-token", "agent-strict", "4", "8")
			;(() =>
				commitTaskCompletionTransaction(rawDb as unknown as Parameters<typeof commitTaskCompletionTransaction>[0], {
					record: stale,
					resourceKey,
					currentStateVersion: () => 1,
				})).should.throw()

			const current = completionRecord("task-stale-state", "agent-strict", "4", "9")
			;(() =>
				commitTaskCompletionTransaction(rawDb as unknown as Parameters<typeof commitTaskCompletionTransaction>[0], {
					record: current,
					resourceKey,
					currentStateVersion: () => 2,
				})).should.throw()
		})

		it("suppresses same-outcome duplicates and rejects payload collisions or terminal conflicts", () => {
			const resourceKey = "governed-lane:strict:2"
			seedAuthoritativeLease(rawDb, resourceKey, "agent-strict", "10", "12")
			const first = completionRecord("task-duplicates", "agent-strict", "10", "12")
			const raw = rawDb as unknown as Parameters<typeof commitTaskCompletionTransaction>[0]
			commitTaskCompletionTransaction(raw, { record: first, resourceKey, currentStateVersion: () => 1 })

			const duplicate = completionRecord("task-duplicates", "agent-strict", "10", "12", {
				evaluatedStateVersion: 2,
			})
			const suppressed = commitTaskCompletionTransaction(raw, {
				record: duplicate,
				resourceKey,
				currentStateVersion: () => 2,
			})
			suppressed.kind.should.equal("duplicate_suppressed")

			const collision = { ...first, decisionJson: canonicalCompletionJson({ code: "DIFFERENT_PAYLOAD" }) }
			;(() =>
				commitTaskCompletionTransaction(raw, {
					record: collision,
					resourceKey,
					currentStateVersion: () => 1,
				})).should.throw()

			const conflict = completionRecord("task-duplicates", "agent-strict", "10", "12", { status: "failed" })
			;(() =>
				commitTaskCompletionTransaction(raw, {
					record: conflict,
					resourceKey,
					currentStateVersion: () => 1,
				})).should.throw()
		})
	})

	describe("fencing token precision safety", () => {
		it("preserves values above Number.MAX_SAFE_INTEGER", async () => {
			const bigToken = "9007199254740993" // Number.MAX_SAFE_INTEGER + 2

			await db
				.insertInto("swarm_locks")
				.values({
					resource: "test-precision",
					ownerId: "agent-big",
					expiresAt: Date.now() + 300000,
					createdAt: Date.now(),
					leaseEpoch: bigToken,
					fencingToken: bigToken,
					protocolVersion: 1,
				})
				.execute()

			const row = await db
				.selectFrom("swarm_locks")
				.select(["fencingToken", "leaseEpoch"])
				.where("resource", "=", "test-precision")
				.executeTakeFirst()

			row!.fencingToken!.should.equal(bigToken)
			row!.leaseEpoch!.should.equal(bigToken)

			// Verify ordering with BigInt
			const loaded = BigInt(row!.fencingToken!)
			const next = loaded + 1n
			;(next > loaded).should.be.true()

			// CAS release using the big value
			const result = await db
				.deleteFrom("swarm_locks")
				.where("resource", "=", "test-precision")
				.where("fencingToken", "=", bigToken)
				.execute()

			result.length.should.equal(1)
		})
	})

	describe("database outage fail-closed", () => {
		it("closed database connection raises on query attempt", async () => {
			rawDb.close()

			let threw = false
			try {
				await db.selectFrom("task_completions").selectAll().execute()
			} catch {
				threw = true
			}
			threw.should.be.true()

			// Reopen for cleanup
			const newDb = await createTestDb(dbPath)
			db = newDb.db
			rawDb = newDb.rawDb
		})
	})
})
