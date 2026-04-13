import * as fs from "fs"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

export interface LayerConfig {
	optimalLogicDensity: number
	maxIOEntropy: number
	maxComplexity: number
}

export interface SovereignConfig {
	layers: Record<string, LayerConfig>
	global: {
		maxPathDepth: number
		enforceKebabCase: boolean
		feverThreshold: number
		integrityAlertThreshold: number
	}
}

/**
 * SovereignPolicy: The architectural constitution.
 * Loads and provides structural thresholds from sovereign.config.json.
 */
export class SovereignPolicy {
	private static instance: SovereignPolicy
	private config: SovereignConfig

	private constructor(cwd: string) {
		const configPath = path.resolve(cwd, "sovereign.config.json")
		if (fs.existsSync(configPath)) {
			try {
				this.config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
			} catch (e) {
				Logger.error("[SovereignPolicy] Failed to parse config, using defaults:", e)
				this.config = this.getDefaults()
			}
		} else {
			this.config = this.getDefaults()
		}
	}

	public static getInstance(cwd: string): SovereignPolicy {
		if (!SovereignPolicy.instance) {
			SovereignPolicy.instance = new SovereignPolicy(cwd)
		}
		return SovereignPolicy.instance
	}

	public getLayerConfig(layer: string): LayerConfig {
		return this.config.layers[layer.toLowerCase()] || this.config.layers.plumbing
	}

	public getGlobalConfig() {
		return this.config.global
	}

	private getDefaults(): SovereignConfig {
		return {
			layers: {
				domain: { optimalLogicDensity: 0.15, maxIOEntropy: 0.0, maxComplexity: 5000 },
				core: { optimalLogicDensity: 0.05, maxIOEntropy: 0.0, maxComplexity: 3000 },
				infrastructure: { optimalLogicDensity: 0.05, maxIOEntropy: 1.0, maxComplexity: 10000 },
				plumbing: { optimalLogicDensity: 0.0, maxIOEntropy: 0.0, maxComplexity: 500 },
			},
			global: {
				maxPathDepth: 4,
				enforceKebabCase: true,
				feverThreshold: 5.0,
				integrityAlertThreshold: 70,
			},
		}
	}
}
