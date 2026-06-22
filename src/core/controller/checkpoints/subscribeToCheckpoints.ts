import type { IController as Controller } from "@core/controller/types"
import { CheckpointEvent, CheckpointEvent_OperationType, CheckpointSubscriptionRequest } from "@shared/proto/dietcode/checkpoints"
import { Timestamp } from "@shared/proto/google/protobuf/timestamp"
import { StreamingResponseHandler } from "../grpc-handler"
import { PersistentSubscriptionHub } from "../persistent-subscription-hub"

/**
 * Parameters for creating a checkpoint event
 */
export interface CheckpointEventData {
	operation: keyof typeof CheckpointEvent_OperationType
	cwdHash: string
	isActive: boolean
	taskId?: string
	commitHash?: string
}

const checkpointHubs = new Map<string, PersistentSubscriptionHub<CheckpointEvent>>()

function getCheckpointHub(cwdHash: string): PersistentSubscriptionHub<CheckpointEvent> {
	let hub = checkpointHubs.get(cwdHash)
	if (!hub) {
		hub = new PersistentSubscriptionHub<CheckpointEvent>(`checkpoints:${cwdHash}`)
		checkpointHubs.set(cwdHash, hub)
	}
	return hub
}

/**
 * Subscribe to checkpoint events for a specific workspace.
 *
 * Clients receive real-time notifications about checkpoint operations:
 * - Shadow git initialization
 * - Commit creation
 * - Checkpoint restoration
 *
 * Each operation generates two events (start and completion).
 *
 * @param controller The controller instance
 * @param request The subscription request containing cwdHash
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToCheckpoints(
	_controller: Controller,
	request: CheckpointSubscriptionRequest,
	responseStream: StreamingResponseHandler<CheckpointEvent>,
	requestId?: string,
): Promise<void> {
	const { cwdHash } = request
	getCheckpointHub(cwdHash).register(responseStream, requestId, { type: "checkpoint_subscription", cwdHash })
}

/**
 * Send a checkpoint event to all subscribers of the specified workspace.
 *
 * @param eventData The checkpoint event to send
 */
export async function sendCheckpointEvent(eventData: CheckpointEventData): Promise<void> {
	const { cwdHash } = eventData
	const hub = checkpointHubs.get(cwdHash)
	if (!hub || hub.size === 0) {
		return
	}

	const now = new Date()
	const timestamp: Timestamp = {
		seconds: Math.trunc(now.getTime() / 1_000),
		nanos: (now.getTime() % 1_000) * 1_000_000,
	}

	const event: CheckpointEvent = {
		operation: CheckpointEvent_OperationType[eventData.operation],
		cwdHash: eventData.cwdHash,
		isActive: eventData.isActive,
		timestamp,
		taskId: eventData.taskId,
		commitHash: eventData.commitHash,
	}

	await hub.broadcast(event)
}
