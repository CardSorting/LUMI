import { isE2ETestMode } from "@/shared/e2e-mode"
import { Logger } from "@/shared/services/Logger"

let disabled = false

export function disableSqlitePersistence(reason: string): void {
	if (!disabled) {
		disabled = true
		Logger.warn(`[sqlite] Persistence disabled: ${reason}`)
	}
}

/** True when sqlite should be skipped (E2E or native module ABI / load failure). */
export function isSqlitePersistenceBypassed(): boolean {
	return disabled || isE2ETestMode()
}

export function isNativeModuleVersionMismatch(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return message.includes("NODE_MODULE_VERSION")
}
