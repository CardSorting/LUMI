import { computeFastIoReservedSlots } from "../executionAuthority"
import { AuthorityAwareExecutionPool } from "../subagent/ParentAgentFlowControl"

/** Default parent parallel I/O concurrency when parallel tool calling is enabled. */
export const PARENT_IO_BULKHEAD_CAPACITY = 4

let parentIoPool: AuthorityAwareExecutionPool | undefined

export function getParentIoBulkhead(): AuthorityAwareExecutionPool {
	if (!parentIoPool) {
		parentIoPool = new AuthorityAwareExecutionPool(
			PARENT_IO_BULKHEAD_CAPACITY,
			computeFastIoReservedSlots(PARENT_IO_BULKHEAD_CAPACITY),
		)
	}
	return parentIoPool
}

export function resetParentIoBulkheadForTests(): void {
	parentIoPool = undefined
}

/** Acquire a parent I/O slot — fast-I/O priority when swarm lanes are active. */
export async function acquireParentIoSlot(isFastIo: boolean, swarmInFlight: boolean): Promise<() => void> {
	const pool = getParentIoBulkhead()
	const priority = swarmInFlight && isFastIo ? 2 : isFastIo ? 1 : 0
	return pool.acquire(priority, isFastIo)
}
