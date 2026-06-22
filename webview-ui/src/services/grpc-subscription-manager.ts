/**
 * @deprecated Import from grpc-subscription-runtime instead.
 * Kept only for backward compatibility during migration.
 */
/** @deprecated Use grpcSubscriptionRuntime */
export {
	DEFAULT_RECONNECT_POLICY,
	DEFAULT_STALE_AFTER_MS,
	type GrpcSubscriptionConsumerOptions,
	type GrpcSubscriptionDefinition,
	type GrpcSubscriptionSnapshot,
	grpcSubscriptionRuntime,
	grpcSubscriptionRuntime as grpcSubscriptionManager,
	isDegradedState,
	isHealthyState,
	type ReconnectPolicy,
	type ReconnectReason,
	type SubscriptionHealthState,
} from "./grpc-subscription-runtime"
