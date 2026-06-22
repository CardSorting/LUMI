import { useEffect, useState } from "react"
import {
	type GrpcSubscriptionSnapshot,
	grpcSubscriptionRuntime,
	type SubscriptionHealthState,
} from "@/services/grpc-subscription-runtime"

/** Observe aggregate gRPC subscription health (for debug UI). */
export function useGrpcConnectionStates(): ReadonlyMap<string, GrpcSubscriptionSnapshot> {
	const [snapshots, setSnapshots] = useState(() => grpcSubscriptionRuntime.getSnapshots())

	useEffect(() => grpcSubscriptionRuntime.onHealthChange(setSnapshots), [])

	return snapshots
}

export function useGrpcConnectionState(key: string): SubscriptionHealthState {
	const [state, setState] = useState(() => grpcSubscriptionRuntime.getHealthState(key))

	useEffect(() => {
		return grpcSubscriptionRuntime.onHealthChange((snapshots) => {
			setState(snapshots.get(key)?.state ?? "idle")
		})
	}, [key])

	return state
}

export function useGrpcSubscriptionSnapshot(key: string): GrpcSubscriptionSnapshot | undefined {
	const [snapshot, setSnapshot] = useState(() => grpcSubscriptionRuntime.getSnapshot(key))

	useEffect(() => {
		return grpcSubscriptionRuntime.onHealthChange((snapshots) => {
			setSnapshot(snapshots.get(key))
		})
	}, [key])

	return snapshot
}
