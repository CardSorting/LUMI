import { useEffect, useRef } from "react"
import type { Callbacks } from "@/services/grpc-client-base"
import {
	type GrpcSubscriptionDefinition,
	grpcSubscriptionRuntime,
	type ReconnectPolicy,
	type SubscriptionHealthState,
} from "@/services/grpc-subscription-runtime"

type SubscribeFn<TRequest, TResponse> = (request: TRequest, callbacks: Callbacks<TResponse>) => () => void

export interface UseGrpcSubscriptionOptions<TRequest, TResponse> {
	key: string
	debugLabel?: string
	subscribe: SubscribeFn<TRequest, TResponse>
	request: TRequest
	onMessage: (response: TResponse) => void
	onError?: (error: Error) => void
	onHealthChange?: (state: SubscriptionHealthState) => void
	autoReconnect?: boolean
	reconnect?: Partial<ReconnectPolicy>
	staleAfterMs?: number | null
	enabled?: boolean
}

/**
 * Declarative React binding for a ref-counted persistent gRPC subscription.
 * Call sites describe what to subscribe to and how to handle events — transport lifecycle is owned by the runtime.
 */
export function useGrpcSubscription<TRequest, TResponse>({
	key,
	debugLabel,
	subscribe,
	request,
	onMessage,
	onError,
	onHealthChange,
	autoReconnect = true,
	reconnect,
	staleAfterMs,
	enabled = true,
}: UseGrpcSubscriptionOptions<TRequest, TResponse>): void {
	const onMessageRef = useRef(onMessage)
	const onErrorRef = useRef(onError)
	const onHealthChangeRef = useRef(onHealthChange)

	onMessageRef.current = onMessage
	onErrorRef.current = onError
	onHealthChangeRef.current = onHealthChange

	useEffect(() => {
		if (!enabled) {
			return
		}

		const definition: GrpcSubscriptionDefinition<TRequest, TResponse> = {
			key,
			debugLabel,
			subscribe,
			request,
			autoReconnect,
			reconnect,
			staleAfterMs,
		}

		return grpcSubscriptionRuntime.acquire(definition, {
			onMessage: (response) => onMessageRef.current(response),
			onError: (error) => onErrorRef.current?.(error),
			onHealthChange: (state) => onHealthChangeRef.current?.(state),
		})
	}, [key, enabled, debugLabel, autoReconnect, reconnect, staleAfterMs])
}

export { grpcSubscriptionRuntime, type SubscriptionHealthState }
