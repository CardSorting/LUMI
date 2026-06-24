import type { LockClaim } from "./LockAuthority"

/**
 * Durable in-process registry pairing resource claims to LockClaim for release.
 * Scoped to task/session — not parent conversational memory.
 */
export class ClaimRegistry {
	private static readonly claims = new Map<string, LockClaim>()

	private static key(resourceKey: string, ownerId: string): string {
		return `${resourceKey}::${ownerId}`
	}

	static register(claim: LockClaim): void {
		ClaimRegistry.claims.set(ClaimRegistry.key(claim.resourceKey, claim.ownerId), claim)
	}

	static lookup(resourceKey: string, ownerId: string): LockClaim | undefined {
		return ClaimRegistry.claims.get(ClaimRegistry.key(resourceKey, ownerId))
	}

	static unregister(resourceKey: string, ownerId: string): void {
		ClaimRegistry.claims.delete(ClaimRegistry.key(resourceKey, ownerId))
	}

	static reset(): void {
		ClaimRegistry.claims.clear()
	}
}
