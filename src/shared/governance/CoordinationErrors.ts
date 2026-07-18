export enum CoordinationErrorCode {
	LOCK_BUSY = "LOCK_BUSY",
	LEASE_BUSY = "LEASE_BUSY",
	LEASE_EXPIRED = "LEASE_EXPIRED",
	LEASE_RECLAIMED = "LEASE_RECLAIMED",
	ADMISSION_PRESSURE = "ADMISSION_PRESSURE",
	CAPACITY_UNAVAILABLE = "CAPACITY_UNAVAILABLE",

	OWNERSHIP_CHANGED = "OWNERSHIP_CHANGED",
	FENCING_TOKEN_REJECTED = "FENCING_TOKEN_REJECTED",
	OWNERSHIP_AMBIGUOUS = "OWNERSHIP_AMBIGUOUS",
	SPLIT_BRAIN_DETECTED = "SPLIT_BRAIN_DETECTED",
	COORDINATION_STATE_CORRUPT = "COORDINATION_STATE_CORRUPT",

	LOCK_RELEASE_FAILED = "LOCK_RELEASE_FAILED",
	LEASE_RENEWAL_FAILED = "LEASE_RENEWAL_FAILED",
	RETRY_BUDGET_EXHAUSTED = "RETRY_BUDGET_EXHAUSTED",
	DATABASE_AUTHORITY_UNAVAILABLE = "DATABASE_AUTHORITY_UNAVAILABLE",
	AUTHORITY_MODE_MISMATCH = "AUTHORITY_MODE_MISMATCH",
}

export type CoordinationRetryClass = "retry" | "reconcile_then_retry" | "abort_owner" | "fail_closed"

export const RETRY_POLICY: Record<CoordinationErrorCode, CoordinationRetryClass> = {
	[CoordinationErrorCode.LOCK_BUSY]: "retry",
	[CoordinationErrorCode.LEASE_BUSY]: "retry",
	[CoordinationErrorCode.LEASE_EXPIRED]: "reconcile_then_retry",
	[CoordinationErrorCode.LEASE_RECLAIMED]: "reconcile_then_retry",
	[CoordinationErrorCode.ADMISSION_PRESSURE]: "retry",
	[CoordinationErrorCode.CAPACITY_UNAVAILABLE]: "retry",
	[CoordinationErrorCode.OWNERSHIP_CHANGED]: "abort_owner",
	[CoordinationErrorCode.FENCING_TOKEN_REJECTED]: "abort_owner",
	[CoordinationErrorCode.OWNERSHIP_AMBIGUOUS]: "fail_closed",
	[CoordinationErrorCode.SPLIT_BRAIN_DETECTED]: "fail_closed",
	[CoordinationErrorCode.COORDINATION_STATE_CORRUPT]: "fail_closed",
	[CoordinationErrorCode.LOCK_RELEASE_FAILED]: "fail_closed",
	[CoordinationErrorCode.LEASE_RENEWAL_FAILED]: "fail_closed",
	[CoordinationErrorCode.RETRY_BUDGET_EXHAUSTED]: "fail_closed",
	[CoordinationErrorCode.DATABASE_AUTHORITY_UNAVAILABLE]: "retry",
	[CoordinationErrorCode.AUTHORITY_MODE_MISMATCH]: "fail_closed",
}

export class CoordinationError extends Error {
	constructor(
		public readonly code: CoordinationErrorCode,
		message: string,
		public readonly retryClass: CoordinationRetryClass = "fail_closed",
		public readonly details?: Record<string, unknown>,
		public override readonly cause?: unknown,
	) {
		super(message)
		this.name = "CoordinationError"
		Object.setPrototypeOf(this, CoordinationError.prototype)
	}
}
