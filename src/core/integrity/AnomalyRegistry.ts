import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface Anomaly {
	id: string
	type:
		| "FAILED_MOVE"
		| "AXIOM_VIOLATION"
		| "DRIFT_PATTERN"
		| "DIRECTORY_STRESS"
		| "PATTERN_SIGNATURE"
		| "LAYER_VIOLATION_PATTERN"
	signature: string // Now hashed for space efficiency
	originalSummary: string // Short human-readable summary
	timestamp: number
	severity: number
	hitCount: number
}

/**
 * AnomalyRegistry: Optimized Diagnostic Memory.
 * Implements LRU Pruning, Age-based Expiration, and Signature Compression.
 */
export class AnomalyRegistry {
	private anomalies: Map<string, Anomaly> = new Map()
	private storePath: string
	private MAX_ANOMALIES = 500 // Cap to prevent bloat
	private EXPIRATION_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

	constructor(private cwd: string) {
		this.storePath = path.resolve(this.cwd, ".spider", "anomaly_registry.json")
		this.load()
	}

	public record(type: Anomaly["type"], originalSignature: string, severity = 1) {
		const hash = this.hashSignature(originalSignature)
		const existing = this.anomalies.get(hash)

		if (existing) {
			existing.hitCount++
			existing.timestamp = Date.now()
			existing.severity = Math.max(existing.severity, severity)
		} else {
			this.anomalies.set(hash, {
				id: Math.random().toString(36).substring(7),
				type,
				signature: hash,
				originalSummary: `${originalSignature.substring(0, 50)}...`,
				timestamp: Date.now(),
				severity,
				hitCount: 1,
			})
		}

		this.prune()
		this.save()
	}

	public hasAnomaly(signature: string): boolean {
		const hash = this.hashSignature(signature)
		const p = this.anomalies.get(hash)
		if (p) {
			p.hitCount++
			p.timestamp = Date.now()
			return true
		}

		// PRODUCTION HARDENING: Pattern-based sensing
		// If the file resides in a directory with "STRESS", it inherits the anomaly state.
		const dir = path.dirname(signature)
		const dirHash = this.hashSignature(`dir_stress:${dir}`)
		const dp = this.anomalies.get(dirHash)
		if (dp) {
			dp.hitCount++
			dp.timestamp = Date.now()
			return true
		}

		return false
	}

	/**
	 * V10: Harmonic Decay. Reduces the weight of an anomaly when integrity improves.
	 */
	public decay(signature: string, amount = 1) {
		const hash = this.hashSignature(signature)
		const p = this.anomalies.get(hash)
		if (p) {
			p.hitCount = Math.max(0, p.hitCount - amount)
			p.severity = Math.max(0, p.severity - 0.5)
			if (p.hitCount <= 0) {
				this.anomalies.delete(hash)
				Logger.info(`[AnomalyRegistry] Forgiveness granted: Anomaly cleared for ${p.originalSummary}`)
			} else {
				p.timestamp = Date.now()
			}
			this.save()
		}
	}

	/**
	 * V10: Explicitly clears an anomaly.
	 */
	public clearAnomaly(signature: string) {
		const hash = this.hashSignature(signature)
		if (this.anomalies.delete(hash)) {
			Logger.info(`[AnomalyRegistry] Explicitly cleared anomaly for signature: ${signature.substring(0, 30)}...`)
			this.save()
		}
	}

	/**
	 * V18: Forcefully clears all anomalies related to a directory or file.
	 */
	public forceClear(target: string) {
		let cleared = 0
		const dirStressPrefix = this.hashSignature(`dir_stress:${target}`)
		const fileHash = this.hashSignature(target)

		if (this.anomalies.delete(dirStressPrefix)) cleared++
		if (this.anomalies.delete(fileHash)) cleared++

		// Pattern sweep
		for (const [hash, p] of this.anomalies.entries()) {
			if (p.originalSummary.includes(target)) {
				this.anomalies.delete(hash)
				cleared++
			}
		}

		if (cleared > 0) {
			Logger.info(`[AnomalyRegistry] Force-cleared ${cleared} anomalies for ${target}`)
			this.save()
		}
	}

	/**
	 * PRODUCTION HARDENING: Predicts if an edit is likely to fail based on historical anomalies.
	 */
	public predictAnomaly(filePath: string): { likely: boolean; reason?: string } {
		const dir = path.dirname(filePath)
		const dirHash = this.hashSignature(`dir_stress:${dir}`)
		const dp = this.anomalies.get(dirHash)

		if (dp && dp.hitCount > 3) {
			return {
				likely: true,
				reason: `Architectural Stress Zone detected in \`${dir}\`. Historic violations suggest high risk of regression.`,
			}
		}

		// Pattern-based Prediction (v12)
		for (const p of this.anomalies.values()) {
			if (p.type === "LAYER_VIOLATION_PATTERN" && p.hitCount > 5) {
				return {
					likely: true,
					reason: `Stability Protocol Alert: This move matches a historically failed architectural pattern.`,
				}
			}
		}

		return { likely: false }
	}

	/**
	 * PRODUCTION HARDENING: Records a failed architectural pattern.
	 */
	public recordPatternSignature(originLayer: string, targetLayer: string) {
		const sig = `pattern:${originLayer}->${targetLayer}`
		this.record("LAYER_VIOLATION_PATTERN", sig, 3)
	}

	/**
	 * Records directory stress when multiple violations occur in the same folder.
	 */
	public recordDirectoryStress(directory: string) {
		const hash = this.hashSignature(`dir_stress:${directory}`)
		const existing = this.anomalies.get(hash)
		if (existing) {
			existing.hitCount++
			existing.timestamp = Date.now()
		} else {
			this.anomalies.set(hash, {
				id: Math.random().toString(36).substring(7),
				type: "DIRECTORY_STRESS",
				signature: hash,
				originalSummary: `Stress in ${directory}`,
				timestamp: Date.now(),
				severity: 2,
				hitCount: 1,
			})
		}
		this.save()
	}

	/**
	 * Prunes the store to prevent .json bloat.
	 * 1. Removes expired anomalies.
	 * 2. Enforces MAX_ANOMALIES cap using LRU (least recently used).
	 */
	private prune() {
		const now = Date.now()

		// 1. Age-based pruning
		for (const [hash, p] of this.anomalies.entries()) {
			if (now - p.timestamp > this.EXPIRATION_MS) {
				this.anomalies.delete(hash)
			}
		}

		// 2. Capacity-based pruning (LRU)
		if (this.anomalies.size > this.MAX_ANOMALIES) {
			const sorted = Array.from(this.anomalies.values()).sort((a, b) => a.timestamp - b.timestamp) // Oldest first

			const toRemove = sorted.slice(0, this.anomalies.size - this.MAX_ANOMALIES)
			for (const p of toRemove) {
				this.anomalies.delete(p.signature)
			}
		}
	}

	public getAnomalies() {
		return Array.from(this.anomalies.values())
	}

	/**
	 * V34: Path-aware violation retrieval for Proactive Discovery.
	 */
	public getViolations(filePath: string): Anomaly[] {
		return this.getAnomalies().filter((p) => p.originalSummary.includes(filePath))
	}

	private hashSignature(sig: string): string {
		return crypto.createHash("sha256").update(sig).digest("hex")
	}

	private load() {
		if (fs.existsSync(this.storePath)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
				if (Array.isArray(data)) {
					for (const p of data as Anomaly[]) {
						this.anomalies.set(p.signature, p)
					}
				}
			} catch (_e) {
				this.anomalies = new Map()
			}
		}
	}

	private save() {
		const dir = path.dirname(this.storePath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.storePath, JSON.stringify(this.getAnomalies(), null, 2))
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		this.anomalies.clear()
		Logger.info("[AnomalyRegistry] Anomaly substrate released.")
	}
}
