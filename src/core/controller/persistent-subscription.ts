import type { StreamingResponseHandler } from "./grpc-handler-types"
import { getRequestRegistry } from "./grpc-request-registry"

export { type FanoutResult, PersistentSubscriptionHub } from "./persistent-subscription-hub"

/**
 * @deprecated Prefer PersistentSubscriptionHub for new persistent streams.
 */
export function registerPersistentStreamSubscription<T>(
	subscriptions: Set<StreamingResponseHandler<T>>,
	responseStream: StreamingResponseHandler<T>,
	requestId: string | undefined,
	metadata?: unknown,
): void {
	subscriptions.add(responseStream)
	const cleanup = () => subscriptions.delete(responseStream)
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, metadata, responseStream as StreamingResponseHandler)
	}
}
