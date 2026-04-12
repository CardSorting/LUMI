import { getDb } from "../../infrastructure/db/Config"

/**
 * SwarmMutexService provides cross-agent synchronization using a database-backed
 * locking mechanism. This ensures that parallel sub-agents or separate agent
 * instances do not overwrite each other's work on shared resources.
 */
export class SwarmMutexService {
	/**
	 * Internal in-memory mutex for serializing database-level lock checks
	 * to prevent race conditions within the same process.
	 */
	private static inMemoryMutex = new Map<string, Promise<void>>()

	private static async waitInMemory(key: string): Promise<() => void> {
		const previous = SwarmMutexService.inMemoryMutex.get(key) || Promise.resolve()
		let release: () => void
		const current = new Promise<void>((resolve) => {
			release = resolve
		})
		SwarmMutexService.inMemoryMutex.set(
			key,
			previous.then(() => current),
		)
		await previous
		return () => {
			if (SwarmMutexService.inMemoryMutex.get(key) === current) {
				SwarmMutexService.inMemoryMutex.delete(key)
			}
			release()
		}
	}

	/**
	 * Acquires a persistent lock for a specific resource key.
	 * If the lock is held by another owner and not expired, it throws an error.
	 */
	static async claim(key: string, ownerId: string, timeoutMs = 300000): Promise<void> {
		const releaseInMemory = await SwarmMutexService.waitInMemory(key)
		try {
			const db = await getDb()
			const now = Date.now()
			const expiresAt = now + timeoutMs

			// Check for existing lock
			const existingLock = await db.selectFrom("swarm_locks").selectAll().where("resource", "=", key).executeTakeFirst()

			if (existingLock) {
				if (existingLock.expiresAt > now && existingLock.ownerId !== ownerId) {
					throw new Error(`Resource '${key}' is already claimed by agent '${existingLock.ownerId}'.`)
				}

				// Update existing (even if expired, we take it over)
				await db
					.updateTable("swarm_locks")
					.set({
						ownerId,
						expiresAt,
						createdAt: existingLock.createdAt, // Keep original
					})
					.where("resource", "=", key)
					.execute()
			} else {
				// Insert new lock
				await db
					.insertInto("swarm_locks")
					.values({
						resource: key,
						ownerId,
						expiresAt,
						createdAt: now,
					})
					.execute()
			}
		} finally {
			releaseInMemory()
		}
	}

	/**
	 * Releases a persistent lock if held by the specified owner.
	 */
	static async release(key: string, ownerId?: string): Promise<void> {
		const releaseInMemory = await SwarmMutexService.waitInMemory(key)
		try {
			const db = await getDb()
			let query = db.deleteFrom("swarm_locks").where("resource", "=", key)
			if (ownerId) {
				query = query.where("ownerId", "=", ownerId)
			}
			await query.execute()
		} finally {
			releaseInMemory()
		}
	}

	/**
	 * Cleans up expired locks. Should be called periodically or during initialization.
	 */
	static async pruneStaleLocks(): Promise<void> {
		const db = await getDb()
		const now = Date.now()
		await db.deleteFrom("swarm_locks").where("expiresAt", "<", now).execute()
	}

	/**
	 * Acquires a lock for a specific resource key and executes the provided function exclusively.
	 * Combines in-memory and DB-backed locking for maximum safety.
	 */
	static async runExclusive<T>(key: string, ownerId: string, fn: () => Promise<T>, timeoutMs = 60000): Promise<T> {
		await SwarmMutexService.claim(key, ownerId, timeoutMs)
		try {
			return await fn()
		} finally {
			await SwarmMutexService.release(key, ownerId)
		}
	}
}
