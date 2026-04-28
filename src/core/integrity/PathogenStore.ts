import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface Pathogen {
	id: string
	type: "FAILED_MOVE" | "AXIOM_VIOLATION" | "DRIFT_PATTERN" | "DIRECTORY_STRESS" | "PATTERN_ANTIGEN" | "LAYER_VIOLATION_PATTERN"
	signature: string // Now hashed for space efficiency
	originalSummary: string // Short human-readable summary
	timestamp: number
	severity: number
	hitCount: number
}

/**
 * PathogenStore: Optimized Immune Memory.
 * Implements LRU Pruning, Age-based Expiration, and Signature Compression.
 */
export class PathogenStore {
	private pathogens: Map<string, Pathogen> = new Map()
	private storePath: string
	private MAX_PATHOGENS = 500 // Cap to prevent bloat
	private EXPIRATION_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

	constructor(private cwd: string) {
		this.storePath = path.resolve(this.cwd, ".spider", "immune_memory.json")
		this.load()
	}

	public record(type: Pathogen["type"], originalSignature: string, severity = 1) {
		const hash = this.hashSignature(originalSignature)
		const existing = this.pathogens.get(hash)

		if (existing) {
			existing.hitCount++
			existing.timestamp = Date.now()
			existing.severity = Math.max(existing.severity, severity)
		} else {
			this.pathogens.set(hash, {
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

	public isPathogenic(signature: string): boolean {
		const hash = this.hashSignature(signature)
		const p = this.pathogens.get(hash)
		if (p) {
			p.hitCount++
			p.timestamp = Date.now()
			return true
		}

		// PRODUCTION HARDENING: Pattern-based sensing
		// If the file resides in a directory with "STRESS", it inherits pathogenicity.
		const dir = path.dirname(signature)
		const dirHash = this.hashSignature(`dir_stress:${dir}`)
		const dp = this.pathogens.get(dirHash)
		if (dp) {
			dp.hitCount++
			dp.timestamp = Date.now()
			return true
		}

		return false
	}

	/**
	 * V10: Harmonic Decay. Reduces the weight of a pathogen when integrity improves.
	 */
	public decay(signature: string, amount = 1) {
		const hash = this.hashSignature(signature)
		const p = this.pathogens.get(hash)
		if (p) {
			p.hitCount = Math.max(0, p.hitCount - amount)
			p.severity = Math.max(0, p.severity - 0.5)
			if (p.hitCount <= 0) {
				this.pathogens.delete(hash)
				Logger.info(`[PathogenStore] Forgiveness granted: Pathogen cleared for ${p.originalSummary}`)
			} else {
				p.timestamp = Date.now()
			}
			this.save()
		}
	}

	/**
	 * V10: Explicitly clears a pathogen.
	 */
	public clearPathogen(signature: string) {
		const hash = this.hashSignature(signature)
		if (this.pathogens.delete(hash)) {
			Logger.info(`[PathogenStore] Explicitly cleared pathogen for signature: ${signature.substring(0, 30)}...`)
			this.save()
		}
	}

	/**
	 * V18: Forcefully clears all pathogens related to a directory or file.
	 */
	public forceClear(target: string) {
		let cleared = 0
		const dirStressPrefix = this.hashSignature(`dir_stress:${target}`)
		const fileHash = this.hashSignature(target)

		if (this.pathogens.delete(dirStressPrefix)) cleared++
		if (this.pathogens.delete(fileHash)) cleared++

		// Pattern sweep
		for (const [hash, p] of this.pathogens.entries()) {
			if (p.originalSummary.includes(target)) {
				this.pathogens.delete(hash)
				cleared++
			}
		}

		if (cleared > 0) {
			Logger.info(`[PathogenStore] Force-cleared ${cleared} pathogens for ${target}`)
			this.save()
		}
	}

	/**
	 * PRODUCTION HARDENING: Predicts if an edit is likely to fail based on historical antigens.
	 */
	public predictFailure(filePath: string): { likely: boolean; reason?: string } {
		const dir = path.dirname(filePath)
		const dirHash = this.hashSignature(`dir_stress:${dir}`)
		const dp = this.pathogens.get(dirHash)

		if (dp && dp.hitCount > 3) {
			return {
				likely: true,
				reason: `Architectural Stress Zone detected in \`${dir}\`. Historic violations suggest high risk of regression.`,
			}
		}

		// Pattern-based Prediction (v12)
		for (const p of this.pathogens.values()) {
			if (p.type === "LAYER_VIOLATION_PATTERN" && p.hitCount > 5) {
				return {
					likely: true,
					reason: `Sovereign Antigen Alert: This move matches a historically failed architectural pattern.`,
				}
			}
		}

		return { likely: false }
	}

	/**
	 * PRODUCTION HARDENING: Records a failed architectural pattern.
	 */
	public recordPatternAntigen(originLayer: string, targetLayer: string) {
		const sig = `pattern:${originLayer}->${targetLayer}`
		this.record("LAYER_VIOLATION_PATTERN", sig, 3)
	}

	/**
	 * Records directory stress when multiple violations occur in the same folder.
	 */
	public recordDirectoryStress(directory: string) {
		const hash = this.hashSignature(`dir_stress:${directory}`)
		const existing = this.pathogens.get(hash)
		if (existing) {
			existing.hitCount++
			existing.timestamp = Date.now()
		} else {
			this.pathogens.set(hash, {
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
	 * 1. Removes expired antigens.
	 * 2. Enforces MAX_PATHOGENS cap using LRU (least recently used).
	 */
	private prune() {
		const now = Date.now()

		// 1. Age-based pruning
		for (const [hash, p] of this.pathogens.entries()) {
			if (now - p.timestamp > this.EXPIRATION_MS) {
				this.pathogens.delete(hash)
			}
		}

		// 2. Capacity-based pruning (LRU)
		if (this.pathogens.size > this.MAX_PATHOGENS) {
			const sorted = Array.from(this.pathogens.values()).sort((a, b) => a.timestamp - b.timestamp) // Oldest first

			const toRemove = sorted.slice(0, this.pathogens.size - this.MAX_PATHOGENS)
			for (const p of toRemove) {
				this.pathogens.delete(p.signature)
			}
		}
	}

	public getPathogens() {
		return Array.from(this.pathogens.values())
	}

	/**
	 * V34: Path-aware violation retrieval for Proactive Discovery.
	 */
	public getViolations(filePath: string): Pathogen[] {
		return this.getPathogens().filter((p) => p.originalSummary.includes(filePath))
	}

	private hashSignature(sig: string): string {
		return crypto.createHash("sha256").update(sig).digest("hex")
	}

	private load() {
		if (fs.existsSync(this.storePath)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.storePath, "utf-8"))
				if (Array.isArray(data)) {
					for (const p of data as Pathogen[]) {
						this.pathogens.set(p.signature, p)
					}
				}
			} catch (_e) {
				this.pathogens = new Map()
			}
		}
	}

	private save() {
		const dir = path.dirname(this.storePath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.storePath, JSON.stringify(this.getPathogens(), null, 2))
	}

	/**
	 * V200: Industrial Hygiene (Disposal).
	 */
	public dispose(): void {
		this.pathogens.clear()
		Logger.info("[PathogenStore] Pathogen substrate released.")
	}
}
