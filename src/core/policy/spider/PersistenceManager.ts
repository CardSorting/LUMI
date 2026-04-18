import * as crypto from "crypto"
import * as v8 from "v8"
import { MetricsEngine } from "./MetricsEngine.js"
import { SpiderNode, SpiderRegistryPayload, SpiderSnapshot } from "./types.js"

export class PersistenceManager {
	private snapshots: Buffer[] = [] // V190: Binary Snapshot Buffer (Industrial Fidelity)

	constructor(private metrics: MetricsEngine) {}

	public serialize(nodes: Map<string, SpiderNode>): Buffer {
		const payload: SpiderRegistryPayload = {
			layerFingerprints: this.computeAllLayerFingerprints(nodes),
			nodes: Array.from(nodes.entries()),
		}
		return v8.serialize(payload)
	}

	public deserialize(data: Buffer): SpiderRegistryPayload {
		return v8.deserialize(data)
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

		if (this.snapshots.length > 5) this.snapshots.shift() // Maintain tight metabolic window
		return snapshot
	}

	public computeAllLayerFingerprints(nodes: Map<string, SpiderNode>): Record<string, string> {
		const layers = ["domain", "core", "infrastructure", "ui", "plumbing"]
		const results: Record<string, string> = {}

		for (const layer of layers) {
			const hasher = crypto.createHash("sha256")
			const layerNodes = Array.from(nodes.values())
				.filter((n) => n.layer === layer)
				.sort((a, b) => a.id.localeCompare(b.id))

			for (const node of layerNodes) {
				hasher.update(node.id)
				hasher.update(node.hash)
				hasher.update(JSON.stringify(node.imports.sort()))
			}
			results[layer] = hasher.digest("hex")
		}
		return results
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		if (this.snapshots.length === 0) return null
		return v8.deserialize(this.snapshots[this.snapshots.length - 1])
	}
}
