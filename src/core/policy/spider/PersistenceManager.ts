import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as v8 from "v8"
import { writeAtomic } from "../../../utils/fs.js"
import { MetricsEngine } from "./MetricsEngine.js"
import { SpiderNode, SpiderRegistryPayload, SpiderSnapshot } from "./types.js"

export class PersistenceManager {
	private saveTimeout: NodeJS.Timeout | null = null

	constructor(
		private cwd: string,
		private registryFile: string,
		private snapshotDir: string,
		private metrics: MetricsEngine,
	) {}

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

	public async saveRegistry(nodes: Map<string, SpiderNode>): Promise<void> {
		if (this.saveTimeout) return

		this.saveTimeout = setTimeout(async () => {
			const data = this.serialize(nodes)
			const binFile = this.registryFile.replace(".json", ".spiderbin")
			const dir = path.dirname(this.registryFile)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

			await writeAtomic(binFile, data)
			this.saveTimeout = null
		}, 500)
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

	public async takeSnapshot(nodes: Map<string, SpiderNode>): Promise<string> {
		const report = this.metrics.computeEntropy(nodes)
		const snapshot: SpiderSnapshot = {
			timestamp: new Date().toISOString(),
			entropyScore: report.score,
			nodes: Array.from(nodes.values()),
			components: report.components,
		}
		if (!fs.existsSync(this.snapshotDir)) await fs.promises.mkdir(this.snapshotDir, { recursive: true })
		const filePath = path.join(this.snapshotDir, `${Date.now()}.json`)
		await writeAtomic(filePath, JSON.stringify(snapshot, null, 2))
		return filePath
	}

	public async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		if (!fs.existsSync(this.snapshotDir)) return null
		const files = await fs.promises.readdir(this.snapshotDir)
		if (files.length === 0) return null
		const latest = files.sort().reverse()[0]
		if (!latest) return null
		const content = await fs.promises.readFile(path.join(this.snapshotDir, latest), "utf-8")
		return JSON.parse(content)
	}
}
