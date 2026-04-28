import * as crypto from "crypto"
import * as v8 from "v8"
import { MetricsEngine } from "./MetricsEngine.js"
import { SpiderNode, SpiderRegistryPayload, SpiderSnapshot } from "./types.js"

export class PersistenceManager {
	private snapshots: Buffer[] = [] // V190: Binary Snapshot Buffer (Industrial Fidelity)

	constructor(private metrics: MetricsEngine) {}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose() {
		this.snapshots = [] // Clear binary residual
	}

	public getSnapshots(): Buffer[] {
		return [...this.snapshots]
	}

	public serialize(nodes: Map<string, SpiderNode>, metadata: Record<string, unknown> = {}): Buffer {
		const payload: SpiderRegistryPayload = {
			layerFingerprints: this.computeAllLayerFingerprints(nodes),
			nodes: Array.from(nodes.entries()),
			...metadata,
		}
		return v8.serialize(payload)
	}

	public deserialize(data: Buffer): SpiderRegistryPayload {
		const result = v8.deserialize(data)
		if (!result || !result.nodes) {
			throw new Error("Invalid or corrupted structural payload.")
		}
		return result
	}

	/**
	 * V190: High-Fidelity Snapshotting.
	 * Preserves the entire structural state in a compressed V8 binary format.
	 */
	public async takeSnapshot(nodes: Map<string, SpiderNode>): Promise<SpiderSnapshot> {
		const report = this.metrics.computeEntropy(nodes)
		const snapshot: SpiderSnapshot = {
			timestamp: new Date().toISOString(),
			entropyScore: report.score,
			nodes: Array.from(nodes.values()),
			components: report.components,
		}

		// Preserve binary state for high-fidelity restoration if needed
		const binary = v8.serialize(snapshot)
		this.snapshots.push(binary)

		// V215: Buffer Saturation Guard (Max 5 snapshots)
		// Prevents indefinite memory growth in long-running metabolic sessions.
		if (this.snapshots.length > 5) {
			this.snapshots.shift()
		}

		return snapshot
	}

	/**
	 * V200: Single-Pass Industrial Fingerprinting.
	 * Eliminates O(N) temporary array allocations during the hashing turn.
	 */
	public computeAllLayerFingerprints(nodes: Map<string, SpiderNode>): Record<string, string> {
		const layers = ["domain", "core", "infrastructure", "ui", "plumbing"]
		const results: Record<string, string> = {}

		const hashers: Record<string, import("crypto").Hash> = {}
		for (const layer of layers) {
			hashers[layer] = crypto.createHash("sha256")
		}

		// Single-Pass iteration over the node map
		for (const node of nodes.values()) {
			const hasher = hashers[node.layer]
			if (hasher) {
				hasher.update(node.id)
				hasher.update(node.hash)
				// Imports are unique and pre-vetted during indexing
				for (const imp of node.imports) {
					hasher.update(imp)
				}
			}
		}

		for (const layer of layers) {
			results[layer] = hashers[layer].digest("hex")
		}

		return results
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		if (this.snapshots.length === 0) return null
		return v8.deserialize(this.snapshots[this.snapshots.length - 1])
	}

	/**
	 * V215: Industrial Checkpointing.
	 * Creates a long-lived binary checkpoint of the current substrate.
	 */
	public createCheckpoint(nodes: Map<string, SpiderNode>): Buffer {
		return this.serialize(nodes, { checkpoint: true, timestamp: Date.now() })
	}

	/**
	 * V215: Silent Drift Detection.
	 * Compares the live graph against a binary checkpoint to find non-session changes.
	 */
	public compareToCheckpoint(current: Map<string, SpiderNode>, checkpoint: Buffer): string[] {
		const baseline = this.deserialize(checkpoint)
		const drifts: string[] = []

		const oldNodes = new Map(baseline.nodes)
		for (const [id, node] of current) {
			const oldNode = oldNodes.get(id)
			if (!oldNode) {
				drifts.push(`[DRIFT] NEW MODULE DETECTED: ${id}`)
				continue
			}

			if (node.hash !== oldNode.hash) {
				drifts.push(`[DRIFT] CONTENT MUTATION: ${id}`)
			}

			if (node.layer !== oldNode.layer) {
				drifts.push(`[DRIFT] LAYER DISPLACEMENT: ${id} (${oldNode.layer} -> ${node.layer})`)
			}
		}

		return drifts
	}

	public getHistory(): number[] {
		return this.snapshots.map((s) => {
			const snap = v8.deserialize(s) as SpiderSnapshot
			return snap.entropyScore
		})
	}

	/**
	 * V215: Substrate Checksumming.
	 * Generates a single sha256 hash representing the entire structural graph.
	 */
	public computeSubstrateChecksum(nodes: Map<string, SpiderNode>): string {
		const hasher = crypto.createHash("sha256")
		const sortedIds = Array.from(nodes.keys()).sort()
		for (const id of sortedIds) {
			const node = nodes.get(id)
			if (node) {
				hasher.update(id)
				hasher.update(node.hash)
			}
		}
		return hasher.digest("hex")
	}
}
