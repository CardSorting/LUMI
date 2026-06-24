/**
 * Single public mutation-ownership surface for governed execution.
 * All lane claims, mem_claim, and mem_release must route through this module.
 */
import { ClaimRegistry } from "./ClaimRegistry"
import {
	createLockAuthority,
	type LockAcquireResult,
	type LockAuthority,
	type LockClaim,
	type LockReleaseResult,
} from "./LockAuthority"

export type {
	LockAcquireResult,
	LockAuthority,
	LockClaim,
	LockFailureReason,
	LockReleaseResult,
	StaleRecoveryReport,
} from "./LockAuthority"
export { ClaimRegistry }

export function createGovernedLockAuthority(options?: { inMemory?: boolean }): LockAuthority {
	return createLockAuthority(options)
}

export async function acquireGovernedClaim(
	authority: LockAuthority,
	resourceKey: string,
	ownerId: string,
	options?: Parameters<LockAuthority["acquire"]>[2],
): Promise<LockAcquireResult> {
	return authority.acquire(resourceKey, ownerId, options)
}

export async function releaseGovernedClaim(authority: LockAuthority, claim: LockClaim): Promise<LockReleaseResult> {
	return authority.release(claim)
}

export function registerMemClaim(claim: LockClaim): void {
	ClaimRegistry.register(claim)
}

export function lookupMemClaim(resourceKey: string, ownerId: string): LockClaim | undefined {
	return ClaimRegistry.lookup(resourceKey, ownerId)
}

export function unregisterMemClaim(resourceKey: string, ownerId: string): void {
	ClaimRegistry.unregister(resourceKey, ownerId)
}
