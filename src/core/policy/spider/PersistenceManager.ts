import * as crypto from "crypto"
import * as v8 from "v8"
import { MetricsEngine } from "./MetricsEngine.js"
import { SpiderNode, SpiderRegistryPayload, SpiderSnapshot } from "./types.js"

export class PersistenceManager {
	private snapshots: SpiderSnapshot[] = []

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

	public async saveRegistry(_nodes: Map<string, SpiderNode>): Promise<void> {
		// V150: Memory-Only Substrate.
		// Substrate persistence is now managed by the FluidPolicyEngine via the Ghost Memory layer.
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

	public async takeSnapshot(nodes: Map<string, SpiderNode>): Promise<SpiderSnapshot> {
		const report = this.metrics.computeEntropy(nodes)
		const snapshot: SpiderSnapshot = {
			timestamp: new Date().toISOString(),
			entropyScore: report.score,
			nodes: Array.from(nodes.values()),
			components: report.components,
		}
		this.snapshots.push(snapshot)
		if (this.snapshots.length > 10) this.snapshots.shift() // Maintain rolling buffer
		return snapshot
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		return this.snapshots[this.snapshots.length - 1] || null
	}
}
