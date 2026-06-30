/**
 * Default gate registry — the set of gates known to the completion lifecycle.
 *
 * Gates not in this registry are unknown and treated as non-participating:
 * they neither block nor contribute to audit validity. This mirrors service
 * registry patterns (Consul, etcd) where deregistered services are
 * non-participating, not blocking.
 *
 * Retired gates are kept in the registry with status "retired" so the engine
 * can distinguish "never existed" from "was retired" for trace clarity.
 */

import type { GateRegistry, RegisteredGate } from "./CompletionLifecycleTypes"

const GATE_DEFINITIONS: RegisteredGate[] = [
	{ id: "audit", status: "active", version: 1 },
	{ id: "roadmap", status: "active", version: 1 },
	{ id: "focus_chain", status: "active", version: 1 },
	{ id: "double_check", status: "active", version: 1 },
	{ id: "quality", status: "active", version: 1 },
	{ id: "workspace_progress", status: "active", version: 1 },
	{ id: "duplicate", status: "active", version: 1 },
	{ id: "cooldown", status: "active", version: 1 },
	{ id: "demo_command", status: "active", version: 1 },
	// Retired gates — kept for trace clarity, never blocking
	{ id: "legacy_forensic", status: "retired", version: 0 },
]

/**
 * The default gate registry built from the static gate definitions.
 * Callers can provide a custom registry for testing or workspace-specific overrides.
 */
export const DEFAULT_GATE_REGISTRY: GateRegistry = new Map(GATE_DEFINITIONS.map((gate) => [gate.id, gate]))

/**
 * Build a custom gate registry — used for testing and workspace overrides.
 */
export function buildGateRegistry(gates: RegisteredGate[]): GateRegistry {
	return new Map(gates.map((gate) => [gate.id, gate]))
}

/**
 * Check if a gate is active in the registry.
 * Unknown gates (not in registry) are NOT active.
 * Retired gates are NOT active.
 */
export function isGateActive(registry: GateRegistry, gateId: string): boolean {
	const gate = registry.get(gateId)
	return gate?.status === "active"
}

/**
 * Check if a gate is known to the registry (active or retired).
 * Used in traces to distinguish "unknown" from "retired".
 */
export function isGateKnown(registry: GateRegistry, gateId: string): boolean {
	return registry.has(gateId)
}
